// =============================================================================
// POST /api/nuvemshop/webhook
//
// Receiver de webhooks Nuvemshop.
//
// Fluxo (deve ser o mais rápido possível):
//   1. Ler raw body (necessário para HMAC)
//   2. Verificar assinatura HMAC (rejeitar imediatamente se inválida)
//   3. Parsear payload { store_id, event, id }
//   4. Validar loja contra nuvemshop_connections (company_id lookup)
//   5. Gerar idempotency_key determinístico: "{store_id}:{event}:{id}"
//   6. Enfileirar via RPC enqueue_nuvemshop_event (idempotente)
//   7. Atualizar last_webhook_at na conexão (best-effort, não bloqueia 200)
//   8. Responder HTTP 200 IMEDIATAMENTE
//
// NUNCA executar regra de negócio neste handler.
// Todo processamento ocorre no worker (api/cron/nuvemshop-process-events.js).
//
// Segurança:
//   - HMAC verificado ANTES de qualquer acesso ao banco
//   - Lookup de company_id validado contra conexão ativa
//   - Nenhum dado sensível logado (payload pode conter dados de clientes)
//   - Responde 200 mesmo quando já enfileirado (idempotência)
// =============================================================================

import { verifyNuvemshopHmac } from '../lib/nuvemshop/webhookVerifier.js';
import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js';
import { randomBytes }         from 'crypto';

// CRÍTICO: desabilitar body parser da Vercel para manter raw body intacto.
// O HMAC é calculado sobre o payload exato enviado pela Nuvemshop.
// Qualquer re-serialização (JSON.stringify do objeto parseado) quebra a assinatura.
export const config = {
  api: { bodyParser: false },
};

/** Lê o raw body do stream como string UTF-8. */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  ()    => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Extrai resource_type a partir do topic (ex: 'customer/created' → 'customer').
 * Usado para geração de idempotency_key e logs.
 */
function extractResourceType(topic) {
  if (!topic || typeof topic !== 'string') return 'unknown';
  return topic.split('/')[0] ?? 'unknown';
}

export default async function handler(req, res) {
  // Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Ler raw body (stream — body parser desabilitado) ───────────────────
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('[nuvemshop/webhook] raw_body_read_failed err=%s', err?.message);
    return res.status(500).json({ error: 'Body read error' });
  }

  // ── 2. Verificar assinatura HMAC ────────────────────────────────────────────
  const hmacResult = verifyNuvemshopHmac(rawBody, req.headers);
  if (!hmacResult.ok) {
    console.warn('[nuvemshop/webhook] hmac_failed reason=%s ip=%s',
      hmacResult.error, req.headers['x-forwarded-for'] ?? 'unknown');
    // 401 para assinatura inválida — 200 seria aceitar evento malicioso
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 3. Parsear payload ─────────────────────────────────────────────────────
  // Payload Nuvemshop (thin): { store_id: number, event: string, id: number }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn('[nuvemshop/webhook] invalid_json');
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const storeId    = String(payload?.store_id ?? '');
  const topic      = String(payload?.event    ?? '');
  const resourceId = String(payload?.id       ?? '');

  if (!storeId || !topic) {
    console.warn('[nuvemshop/webhook] missing_fields storeId=%s topic=%s', storeId, topic);
    return res.status(200).json({ ok: true, queued: false, reason: 'missing_fields' });
  }

  // correlation_id: rastreabilidade end-to-end
  const correlationId = req.headers['x-correlation-id']
    ?? `nvwh-${randomBytes(6).toString('hex')}`;

  const svc = getSupabaseAdmin();

  // ── 4. Validar loja e obter company_id ────────────────────────────────────
  // Tópicos LGPD chegam DEPOIS da desconexão (ex: store/redact após uninstall).
  // Para esses tópicos, aceitar conexões 'disconnected' também — nunca descartar.
  const LGPD_TOPICS = new Set(['store/redact', 'customers/redact', 'customers/data_request']);
  const isLgpdTopic = LGPD_TOPICS.has(topic);

  const connectionQuery = svc
    .from('nuvemshop_connections')
    .select('id, company_id, status')
    .eq('nuvemshop_store_id', storeId)
    .order('connected_at', { ascending: false })
    .limit(1);

  if (isLgpdTopic) {
    connectionQuery.in('status', ['active', 'disconnected']);
  } else {
    connectionQuery.eq('status', 'active');
  }

  const { data: connection } = await connectionQuery.maybeSingle();

  if (!connection) {
    // Loja desconhecida — responder 200 para não gerar retries da Nuvemshop
    console.warn('[nuvemshop/webhook] unknown_store storeId=%s topic=%s lgpd=%s',
      storeId, topic, isLgpdTopic);
    return res.status(200).json({ ok: true, queued: false, reason: 'unknown_store' });
  }

  const companyId = connection.company_id;

  // ── 5. Gerar idempotency_key determinístico ───────────────────────────────
  // Formato: "{store_id}:{topic}:{resource_id}"
  // Se resource_id estiver ausente (evento de app/store), usa 'na'
  const idempotencyKey = `${storeId}:${topic}:${resourceId || 'na'}`;

  // ── 6. Enfileirar via RPC (idempotente) ───────────────────────────────────
  const { data: enqueueResult, error: enqueueErr } = await svc.rpc(
    'enqueue_nuvemshop_event',
    {
      p_company_id:      companyId,
      p_store_id:        storeId,
      p_topic:           topic,
      p_idempotency_key: idempotencyKey,
      p_payload:         payload,
      p_correlation_id:  correlationId,
      p_event_id:        resourceId || null,
    },
  );

  if (enqueueErr) {
    console.error('[nuvemshop/webhook] enqueue_failed storeId=%s topic=%s corr=%s err=%s',
      storeId, topic, correlationId, enqueueErr.message);
    // 200: não expor erro interno — a Nuvemshop não deve fazer retry desnecessário
    return res.status(200).json({ ok: true, queued: false, reason: 'enqueue_error' });
  }

  const queued = enqueueResult?.queued ?? false;

  // Nota: last_webhook_at é atualizado atomicamente DENTRO do RPC enqueue_nuvemshop_event.
  // Não é necessário nenhum UPDATE adicional aqui.

  // ── 8. HTTP 200 imediato ──────────────────────────────────────────────────
  console.log('[nuvemshop/webhook] received storeId=%s topic=%s resource=%s queued=%s corr=%s',
    storeId, topic, resourceId, queued, correlationId);

  return res.status(200).json({ ok: true, queued });
}
