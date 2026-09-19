// =============================================================================
// GET|POST /api/whatsapp/meta/webhook
//
// GET  → Verificação do challenge Meta (setup do webhook no App Dashboard)
// POST → Recebimento de eventos de status outbound (MVP2 2C.4)
//
// Segurança:
//   - GET: timing-safe comparison do verify token (nunca logar)
//   - POST: HMAC SHA-256 validado ANTES de qualquer processamento (fail-closed)
//   - JSON.parse SOMENTE após HMAC válido
//   - getSupabaseAdmin() SOMENTE após HMAC válido
//   - company_id/instance_id NUNCA extraídos do payload — resolvidos via DB
//   - phone_number_id é o único identificador externo aceito para tenant resolution
//
// Idempotência:
//   - State machine explícita (TRANSITION_MATRIX) com NOOP para regressão/duplicata
//   - SELECT antes do UPDATE (read-before-update) para detectar unknown wamid
//   - Retry Meta em 5xx é seguro: NOOPs garantem idempotência do batch
//
// MVP2 escopo (fase 2C.4):
//   - Somente statuses[] outbound processados (sent/delivered/read/failed)
//   - messages[] inbound ignorados nesta fase
//   - played ignorado silenciosamente
//
// Decisão UNKNOWN_WAMID (B1):
//   - Meta retenta não-200 por até 7 dias (documentado oficialmente)
//   - Wamids não encontrados são mais provavelmente de mensagens externas ao Lovoo
//   - Retornar 200 + log seguro evita retry storm de 7 dias
// =============================================================================

import { timingSafeEqual } from 'crypto';
import { getSupabaseAdmin }            from '../../lib/automation/supabaseAdmin.js';
import {
  readRawBody,
  verifyMetaWebhookSignature,
}                                      from '../../lib/meta-whatsapp/verifyWebhookSignature.js';
import {
  getMetaServerConfig,
  getMetaWebhookConfig,
}                                      from '../../lib/meta-whatsapp/config.js';

// CRÍTICO: desabilitar body parser do Vercel — obrigatório para HMAC validation.
// Qualquer re-serialização do body invalida a assinatura.
export const config = { api: { bodyParser: false } };

// Statuses outbound suportados nesta fase (MVP2 2C.4).
// 'played' não está incluído — ignorado silenciosamente.
const SUPPORTED_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

// =============================================================================
// State machine — matriz de transições explícita
//
// Linha  = status ATUAL  na tabela meta_whatsapp_messages
// Coluna = status NOVO   recebido do webhook
//
// true  → APPLY: executar UPDATE no banco
// false → NOOP:  ignorar (duplicata ou regressão não permitida)
//
// Regras aplicadas:
//   accepted → qualquer → APPLY (primeira notificação)
//   sent     → delivered/read/failed → APPLY (progressão)
//   sent     → sent → NOOP (duplicata)
//   delivered → read → APPLY (única progressão possível)
//   delivered → failed → NOOP (S7 Meta: delivered = entregue em pelo menos 1 device)
//   read     → qualquer → NOOP (estado máximo de progressão)
//   failed   → qualquer → NOOP (terminal)
// =============================================================================
const TRANSITION_MATRIX = {
  accepted:  { sent: true,  delivered: true,  read: true,  failed: true  },
  sent:      { sent: false, delivered: true,  read: true,  failed: true  },
  delivered: { sent: false, delivered: false, read: true,  failed: false },
  read:      { sent: false, delivered: false, read: false, failed: false },
  failed:    { sent: false, delivered: false, read: false, failed: false },
};

// =============================================================================
// Handler principal
// =============================================================================

export default async function handler(req, res) {
  if (req.method === 'GET')  return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

// =============================================================================
// GET — Challenge verification
// =============================================================================

function handleGet(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Fail-closed: se ENV ausente, retornar 403 sem expor motivo
  let verifyToken;
  try {
    ({ verifyToken } = getMetaWebhookConfig());
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (mode !== 'subscribe') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Timing-safe comparison — comprimentos diferentes → false (nunca chega ao timingSafeEqual)
  // Nunca logar o token fornecido nem o token esperado
  const provided = typeof token === 'string' ? token : '';
  if (!timingSafeTokenEqual(provided, verifyToken)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Retornar challenge como string — formato exigido pela Meta
  return res.status(200).send(challenge);
}

/**
 * Comparação timing-safe de dois tokens.
 * Comprimentos diferentes → false imediato (sem execução de timingSafeEqual).
 * Tokens vazios → false (token vazio não é válido).
 * Nunca lança exceção — fail-closed.
 *
 * @param {string} a — token fornecido pelo solicitante
 * @param {string} b — token esperado (do ENV)
 * @returns {boolean}
 */
function timingSafeTokenEqual(a, b) {
  try {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    // Token vazio nunca é válido
    if (aBuf.length === 0) return false;
    // Comprimentos diferentes → false (sem timing leak)
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

// =============================================================================
// POST — Webhook event processing
// =============================================================================

async function handlePost(req, res) {
  // ── 1. Ler raw body com limite (1 MB) — antes de QUALQUER processamento ───
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    if (err?.code === 'body_too_large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    return res.status(500).json({ error: 'Body read error' });
  }

  // ── 2. Obter appSecret — fail-closed sem ENV ──────────────────────────────
  let appSecret;
  try {
    ({ appSecret } = getMetaServerConfig());
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── 3. Validar HMAC — ZERO DB antes deste ponto ───────────────────────────
  // Nunca logar signature, appSecret ou rawBody
  const signature = req.headers['x-hub-signature-256'] ?? '';
  if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── 4. Parse JSON — somente após HMAC válido ──────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // ── 5. Validar objeto raiz — skip silencioso se não for WhatsApp ──────────
  if (payload.object !== 'whatsapp_business_account') {
    return res.status(200).json({ received: true });
  }

  // ── 6. Inicializar Supabase — somente após HMAC válido ───────────────────
  const svc = getSupabaseAdmin();

  // ── 7. Iterar defensivamente sobre entries e changes ─────────────────────
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      // Somente campo 'messages' nesta fase
      if (change.field !== 'messages') continue;

      const value    = change.value ?? {};
      const statuses = value.statuses;

      // Ignorar changes sem statuses (inbound messages[], contacts[], etc.)
      if (!Array.isArray(statuses) || statuses.length === 0) continue;

      // ── 8. Tenant resolution ─────────────────────────────────────────────
      // phone_number_id é o único identificador externo aceito
      // company_id/instance_id NUNCA extraídos do payload
      const phoneNumberId = value.metadata?.phone_number_id;
      if (typeof phoneNumberId !== 'string' || phoneNumberId.length === 0) continue;

      const { data: instance, error: instErr } = await svc
        .from('meta_whatsapp_instances')
        .select('id, company_id')
        .eq('phone_number_id', phoneNumberId)
        .is('deleted_at', null)
        .maybeSingle();

      if (instErr) {
        // Erro de DB real — retornar 500 para retry Meta
        console.error('[meta/webhook] instance_lookup_failed db_error=true');
        return res.status(500).json({ error: 'Internal error' });
      }

      if (!instance) {
        // phone_number_id desconhecido — instância removida/inexistente
        console.log('[meta/webhook] event_type=status instance_resolved=false');
        continue;
      }

      // ── 9. Processar statuses ────────────────────────────────────────────
      for (const statusItem of statuses) {
        const wamid     = statusItem.id;
        const newStatus = statusItem.status;

        // Validar wamid
        if (typeof wamid !== 'string' || wamid.length === 0) continue;

        // Ignorar statuses fora do escopo (played, outros)
        if (!SUPPORTED_STATUSES.has(newStatus)) continue;

        const effectiveTimestamp = parseMetaTimestamp(statusItem.timestamp);

        // ── 10. SELECT row atual (read-before-update) ──────────────────────
        // Correlação: (instance_id, meta_message_id) — nunca apenas por wamid
        const { data: row, error: selectErr } = await svc
          .from('meta_whatsapp_messages')
          .select('id, status')
          .eq('instance_id', instance.id)
          .eq('meta_message_id', wamid)
          .maybeSingle();

        if (selectErr) {
          console.error('[meta/webhook] select_failed db_error=true');
          return res.status(500).json({ error: 'Internal error' });
        }

        if (!row) {
          // Unknown wamid — decisão B1: 200 + log seguro, continuar batch
          // Não logar wamid completo nem phone_number_id
          console.log('[meta/webhook] event_type=status instance_resolved=true wamid_found=false');
          continue;
        }

        // ── 11. Consultar state machine ────────────────────────────────────
        if (!shouldApply(row.status, newStatus)) {
          // NOOP: duplicata ou regressão não permitida
          console.log('[meta/webhook] event_type=status transition_blocked=true status=%s', newStatus);
          continue;
        }

        // ── 12. Executar UPDATE ────────────────────────────────────────────
        const updatePayload = buildUpdatePayload(newStatus, effectiveTimestamp, statusItem);

        const { error: updateErr } = await svc
          .from('meta_whatsapp_messages')
          .update(updatePayload)
          .eq('id', row.id);

        if (updateErr) {
          console.error('[meta/webhook] update_failed db_error=true');
          return res.status(500).json({ error: 'Internal error' });
        }

        console.log('[meta/webhook] event_type=status status=%s transition_applied=true', newStatus);
      }
    }
  }

  return res.status(200).json({ received: true });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Consulta a matriz de transições explícita.
 * Não usa ranking numérico — cada célula é declarada explicitamente.
 *
 * @param {string} currentStatus — status atual no banco
 * @param {string} newStatus     — status recebido do webhook
 * @returns {boolean} true = APPLY, false = NOOP
 */
function shouldApply(currentStatus, newStatus) {
  return TRANSITION_MATRIX[currentStatus]?.[newStatus] === true;
}

/**
 * Parseia o timestamp Meta (string Unix epoch em segundos).
 *
 * Aceita somente string composta exclusivamente de dígitos decimais,
 * representando um inteiro seguro e positivo.
 * Sem janela arbitrária de validade (Meta não documenta restrição de validade).
 *
 * @param {unknown} raw — valor bruto de statuses[].timestamp
 * @returns {string|null} ISO 8601 string ou null se inválido
 */
function parseMetaTimestamp(raw) {
  if (typeof raw !== 'string') return null;
  if (!/^[0-9]+$/.test(raw))  return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Extrai error_code numérico de statuses[].errors[].
 * Aceita somente inteiros — nunca string ou float.
 * Nunca persiste title, message, details, href.
 * error_subcode: sempre null (campo deprecated/inexistente em webhooks v16.0+).
 *
 * @param {object} statusItem — item de statuses[]
 * @returns {number|null}
 */
function extractErrorCode(statusItem) {
  const errors = Array.isArray(statusItem.errors) ? statusItem.errors : [];
  const first  = errors[0] ?? {};
  const code   = first.code;
  if (typeof code === 'number' && Number.isInteger(code)) return code;
  return null;
}

/**
 * Constrói o payload de UPDATE para meta_whatsapp_messages.
 * Persiste somente campos seguros — sem texto livre, sem dados de usuário.
 *
 * @param {string}      newStatus        — status de destino
 * @param {string|null} timestamp        — ISO 8601 ou null (usa now())
 * @param {object}      statusItem       — item completo de statuses[]
 * @returns {object} objeto de update compatível com Supabase
 */
function buildUpdatePayload(newStatus, timestamp, statusItem) {
  const now = new Date().toISOString();
  const ts  = timestamp ?? now;

  switch (newStatus) {
    case 'sent':
      return { status: 'sent',      sent_at:      ts, updated_at: now };
    case 'delivered':
      return { status: 'delivered', delivered_at: ts, updated_at: now };
    case 'read':
      return { status: 'read',      read_at:      ts, updated_at: now };
    case 'failed':
      return {
        status:        'failed',
        failed_at:     ts,
        error_code:    extractErrorCode(statusItem),
        error_subcode: null,   // deprecated/inexistente em webhooks v16.0+
        updated_at:    now,
      };
    default:
      // Nunca atingido com SUPPORTED_STATUSES guard antes desta função
      return { updated_at: now };
  }
}
