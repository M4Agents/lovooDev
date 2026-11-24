// =============================================================================
// Tracking outbound Meta — compare-and-swap e toque Realtime.
//
// Recebe o cliente e a instância já resolvidos pelo chamador.
// Não cria cliente administrativo, não valida HMAC e não resolve phone_number_id.
// =============================================================================

// Statuses outbound suportados nesta fase (MVP2 2C.4).
// 'played' não está incluído — ignorado silenciosamente.
export const SUPPORTED_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

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

// Tentativas do compare-and-swap quando outra escrita ganhou a linha.
// Cada tentativa relê o status. Esgotar o limite com a transição ainda
// válida devolve 500 para o retry da Meta. Não é um loop aberto.
const STATUS_CAS_ATTEMPT_LIMIT = 3;

/**
 * @param {string} currentStatus — status atual no banco
 * @param {string} newStatus     — status recebido do webhook
 * @returns {boolean} true = APPLY, false = NOOP
 */
function shouldApply(currentStatus, newStatus) {
  return TRANSITION_MATRIX[currentStatus]?.[newStatus] === true;
}

/**
 * Escopo da linha lida. company_id e instance_id precisam ser os da
 * instância já resolvida. Status nulo ou vazio não entra na matriz:
 * o schema declara status NOT NULL e um valor ausente não autoriza escrita.
 *
 * @returns {{ kind: 'ok', row: { id: string, companyId: string, instanceId: string, status: string } }|{ kind: 'mismatch' }|{ kind: 'invalid_status' }}
 */
function classifyTrackingRow(row, instance) {
  if (!row || typeof row.id !== 'string' || row.id.length === 0) return { kind: 'mismatch' };
  const companyId  = typeof row.company_id === 'string' ? row.company_id : instance.company_id;
  const instanceId = typeof row.instance_id === 'string' ? row.instance_id : instance.id;
  if (companyId !== instance.company_id || instanceId !== instance.id) return { kind: 'mismatch' };
  if (typeof row.status !== 'string' || row.status.length === 0) return { kind: 'invalid_status' };
  return { kind: 'ok', row: { id: row.id, companyId, instanceId, status: row.status } };
}

/**
 * Lê o tracking no escopo da instância resolvida.
 * Nunca correlaciona só pelo wamid.
 */
async function loadOutboundTracking(svc, instance, wamid) {
  const { data, error } = await svc
    .from('meta_whatsapp_messages')
    .select('id, company_id, instance_id, status')
    .eq('company_id', instance.company_id)
    .eq('instance_id', instance.id)
    .eq('meta_message_id', wamid)
    .maybeSingle();

  if (error) return { error: true, kind: 'db_error', row: null };
  if (!data) return { error: false, kind: 'missing', row: null };

  const classified = classifyTrackingRow(data, instance);
  if (classified.kind !== 'ok') return { error: false, kind: classified.kind, row: null };
  return { error: false, kind: 'ok', row: classified.row };
}

/**
 * UPDATE condicional. Ausência de erro não prova gravação:
 * só uma linha devolvida por select('id') conta como aplicada.
 * O predicado de status é o valor lido, não o destino.
 */
async function casUpdateOutboundStatus(svc, tracked, payload) {
  const { data, error } = await svc
    .from('meta_whatsapp_messages')
    .update(payload)
    .eq('id', tracked.id)
    .eq('company_id', tracked.companyId)
    .eq('instance_id', tracked.instanceId)
    .eq('status', tracked.status)
    .select('id');

  if (error) return { error: true, applied: false };
  return { error: false, applied: Array.isArray(data) && data.length > 0 };
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
export function parseMetaTimestamp(raw) {
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

/**
 * Aplica uma transição de status com compare-and-swap.
 *
 * @returns {'applied'|'duplicate'|'noop'|'unknown'|'mismatch'|'db_error'|'exhausted'}
 */
export async function applyOutboundStatus(svc, instance, wamid, newStatus, statusItem) {
  const effectiveTimestamp = parseMetaTimestamp(statusItem.timestamp);
  let loaded = await loadOutboundTracking(svc, instance, wamid);
  if (loaded.error) return 'db_error';
  if (loaded.kind === 'mismatch') return 'mismatch';
  if (loaded.kind === 'invalid_status') return 'noop';
  if (!loaded.row) return 'unknown';

  let tracked = loaded.row;
  for (let attempt = 1; attempt <= STATUS_CAS_ATTEMPT_LIMIT; attempt += 1) {
    if (tracked.status === newStatus) return 'duplicate';
    if (!shouldApply(tracked.status, newStatus)) return 'noop';

    const written = await casUpdateOutboundStatus(
      svc,
      tracked,
      buildUpdatePayload(newStatus, effectiveTimestamp, statusItem),
    );
    if (written.error) return 'db_error';
    if (written.applied) return 'applied';

    loaded = await loadOutboundTracking(svc, instance, wamid);
    if (loaded.error) return 'db_error';
    if (loaded.kind === 'mismatch') return 'mismatch';
    if (loaded.kind === 'invalid_status') return 'noop';
    if (!loaded.row) return 'unknown';
    tracked = loaded.row;
  }

  if (tracked.status === newStatus) return 'duplicate';
  return shouldApply(tracked.status, newStatus) ? 'exhausted' : 'noop';
}

/**
 * MVP5.B1.2 — toca meta_messages.updated_at para emitir UPDATE no Realtime.
 *
 * Filtros: company_id da instância resolvida no banco, instance_id validado,
 * meta_message_id do evento, direction outbound.
 * Não altera body, direção, timestamp original nem mídia.
 * Não cria linha se a mensagem ainda não existir.
 *
 * @returns {Promise<'ok'|'missing'|'error'>}
 */
export async function touchOutboundChatMessage(svc, instance, wamid) {
  const { data, error } = await svc
    .from('meta_messages')
    .update({ updated_at: new Date().toISOString() })
    .eq('company_id', instance.company_id)
    .eq('instance_id', instance.id)
    .eq('meta_message_id', wamid)
    .eq('direction', 'outbound')
    .select('id');

  if (error) {
    console.error('[meta/webhook] event_type=status chat_touch_failed db_error=true');
    return 'error';
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.log('[meta/webhook] event_type=status chat_touch_skipped rows=0');
    return 'missing';
  }

  return 'ok';
}
