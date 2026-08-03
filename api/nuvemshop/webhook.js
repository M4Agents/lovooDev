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

  // ── 1. Ler raw body ────────────────────────────────────────────────────────
  // Vercel disponibiliza o raw body em req.body como string quando content-type
  // é application/json (sem bodyParser customizado). Se vier parseado, serializar.
  let rawBody;
  if (typeof req.body === 'string') {
    rawBody = req.body;
  } else if (req.body && typeof req.body === 'object') {
    rawBody = JSON.stringify(req.body);
  } else {
    rawBody = '';
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
    payload = typeof req.body === 'object' ? req.body : JSON.parse(rawBody);
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
  const { data: connection } = await svc
    .from('nuvemshop_connections')
    .select('id, company_id, status')
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();

  if (!connection) {
    // Loja desconhecida ou inativa — responder 200 para não gerar retries da Nuvemshop
    console.warn('[nuvemshop/webhook] unknown_store storeId=%s topic=%s', storeId, topic);
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
