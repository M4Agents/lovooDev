// =============================================================================
// Tracking outbound Meta — compare-and-swap, pendência antecipada e Realtime.
//
// Recebe o cliente e a instância já resolvidos pelo chamador.
// Não cria cliente administrativo, não valida HMAC e não resolve phone_number_id.
// Não envia mensagens à Meta.
// =============================================================================

// Statuses outbound suportados nesta fase (MVP2 2C.4).
// 'played' não está incluído — ignorado silenciosamente.
export const SUPPORTED_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

// Orçamento oportunista por empresa e instância, por request.
// A unidade é uma decisão de pendência (CAS) ou um toque de marcador.
// O wamid corrente não consome este orçamento.
export const OPPORTUNISTIC_PENDING_RESERVE = 3;
export const OPPORTUNISTIC_MARKER_RESERVE = 2;
export const OPPORTUNISTIC_WORK_BUDGET = 5;

const CURRENT_WAMID_PENDING_LIMIT = 4;
const PENDING_UNIQUE = 'mesp_instance_message_status_unique';

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

function hasScope(instance) {
  return typeof instance?.company_id === 'string'
    && instance.company_id.length > 0
    && typeof instance?.id === 'string'
    && instance.id.length > 0;
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
  const errors = Array.isArray(statusItem?.errors) ? statusItem.errors : [];
  const first  = errors[0] ?? {};
  const code   = first.code;
  if (typeof code === 'number' && Number.isInteger(code)) return code;
  return null;
}

/**
 * Constrói o payload de UPDATE para meta_whatsapp_messages.
 * O marcador Realtime entra na mesma sentença que avança o status.
 * Persiste somente campos seguros — sem texto livre, sem dados de usuário.
 *
 * @param {string}      newStatus        — status de destino
 * @param {string|null} timestamp        — ISO 8601 ou null (usa now() no evento ao vivo)
 * @param {object}      statusItem       — item completo de statuses[]
 * @returns {object} objeto de update compatível com Supabase
 */
function buildUpdatePayload(newStatus, timestamp, statusItem) {
  const now = new Date().toISOString();
  const ts  = timestamp ?? now;
  const marker = { realtime_notify_pending: true };

  switch (newStatus) {
    case 'sent':
      return { status: 'sent',      sent_at:      ts, updated_at: now, ...marker };
    case 'delivered':
      return { status: 'delivered', delivered_at: ts, updated_at: now, ...marker };
    case 'read':
      return { status: 'read',      read_at:      ts, updated_at: now, ...marker };
    case 'failed':
      return {
        status:        'failed',
        failed_at:     ts,
        error_code:    extractErrorCode(statusItem),
        error_subcode: null,   // deprecated/inexistente em webhooks v16.0+
        updated_at:    now,
        ...marker,
      };
    default:
      // Nunca atingido com SUPPORTED_STATUSES guard antes desta função
      return { updated_at: now };
  }
}

function describeApply(outcome, newStatus, tracked) {
  return {
    outcome,
    trackingId: tracked?.id ?? null,
    statusForNotify: outcome === 'applied'
      ? newStatus
      : (tracked?.status ?? null),
  };
}

/**
 * Aplica uma transição. storedTimestamp undefined preserva o relógio ao vivo:
 * timestamp inválido cai em now() dentro do payload. String ISO usa o relógio
 * informado e não substitui por now().
 */
async function applyResolved(svc, instance, wamid, newStatus, statusItem, storedTimestamp) {
  const effectiveTimestamp = storedTimestamp === undefined
    ? parseMetaTimestamp(statusItem?.timestamp)
    : storedTimestamp;
  let loaded = await loadOutboundTracking(svc, instance, wamid);
  if (loaded.error) return describeApply('db_error', newStatus, null);
  if (loaded.kind === 'mismatch') return describeApply('mismatch', newStatus, null);
  if (loaded.kind === 'invalid_status') return describeApply('noop', newStatus, null);
  if (!loaded.row) return describeApply('unknown', newStatus, null);

  let tracked = loaded.row;
  for (let attempt = 1; attempt <= STATUS_CAS_ATTEMPT_LIMIT; attempt += 1) {
    if (tracked.status === newStatus) return describeApply('duplicate', newStatus, tracked);
    if (!shouldApply(tracked.status, newStatus)) return describeApply('noop', newStatus, tracked);

    const written = await casUpdateOutboundStatus(
      svc,
      tracked,
      buildUpdatePayload(newStatus, effectiveTimestamp, statusItem),
    );
    if (written.error) return describeApply('db_error', newStatus, tracked);
    if (written.applied) return describeApply('applied', newStatus, tracked);

    loaded = await loadOutboundTracking(svc, instance, wamid);
    if (loaded.error) return describeApply('db_error', newStatus, null);
    if (loaded.kind === 'mismatch') return describeApply('mismatch', newStatus, null);
    if (loaded.kind === 'invalid_status') return describeApply('noop', newStatus, null);
    if (!loaded.row) return describeApply('unknown', newStatus, null);
    tracked = loaded.row;
  }

  if (tracked.status === newStatus) return describeApply('duplicate', newStatus, tracked);
  return describeApply(
    shouldApply(tracked.status, newStatus) ? 'exhausted' : 'noop',
    newStatus,
    tracked,
  );
}

/**
 * Aplica uma transição de status com compare-and-swap.
 *
 * @returns {'applied'|'duplicate'|'noop'|'unknown'|'mismatch'|'db_error'|'exhausted'}
 */
export async function applyOutboundStatus(svc, instance, wamid, newStatus, statusItem) {
  const result = await applyResolved(svc, instance, wamid, newStatus, statusItem, undefined);
  return result.outcome;
}

/**
 * Mesma matriz e o mesmo CAS, com relógio já resolvido do registro armazenado.
 * timestamp nulo não é aceito: o chamador usa received_at no lugar.
 *
 * @returns {Promise<{ outcome: string, trackingId: string|null, statusForNotify: string|null }>}
 */
export async function applyStoredOutboundStatus(svc, instance, wamid, newStatus, stored) {
  const statusItem = {
    errors: Number.isInteger(stored?.errorCode) ? [{ code: stored.errorCode }] : [],
  };
  return applyResolved(svc, instance, wamid, newStatus, statusItem, stored?.timestamp ?? null);
}

const PENDING_CONFLICT_COLUMNS = 'instance_id,meta_message_id,status';

/**
 * 23505 só autoriza uma confirmação no escopo quando a constraint é a
 * unicidade da pendência ou quando o driver não nomeia outra constraint.
 * PK, FK e qualquer outro nome continuam erro. A confirmação é que decide
 * a duplicata; o código sozinho não é sucesso.
 */
function canConfirmPendingDuplicate(error) {
  if (!error || error.code !== '23505') return false;
  if (typeof error.constraint === 'string' && error.constraint.length > 0) {
    return error.constraint === PENDING_UNIQUE;
  }
  const text = `${error.message ?? ''}\n${error.details ?? ''}`;
  const named = text.match(/[a-z][a-z0-9_]*(?:_pkey|_key)/gi) ?? [];
  if (named.length === 0) return true;
  return named.every((name) => name === PENDING_UNIQUE);
}

async function confirmEarlyPendingExists(svc, instance, wamid, newStatus) {
  const { data, error } = await svc
    .from('meta_early_status_pendings')
    .select('id')
    .eq('company_id', instance.company_id)
    .eq('instance_id', instance.id)
    .eq('meta_message_id', wamid)
    .eq('status', newStatus)
    .limit(1);

  if (error || !Array.isArray(data)) return 'unavailable';
  return data.length > 0 ? 'present' : 'absent';
}

/**
 * Insere o primeiro status antecipado. received_at fica com o default do banco.
 * O conflito é só da chave (instance_id, meta_message_id, status), com
 * resolution=ignore-duplicates: o cliente PostgREST 2.79 traduz isso para
 * ON CONFLICT DO NOTHING, não para DO UPDATE.
 *
 * @returns {Promise<'inserted'|'duplicate'|'db_error'>}
 */
export async function persistEarlyOutboundStatus(svc, instance, wamid, newStatus, statusItem) {
  if (!hasScope(instance) || !SUPPORTED_STATUSES.has(newStatus)) {
    console.error('[meta/webhook] event_type=status early_status_persist_failed db_error=true');
    return 'db_error';
  }

  const providerTimestamp = parseMetaTimestamp(statusItem?.timestamp);
  const errorCode = newStatus === 'failed' ? extractErrorCode(statusItem) : null;
  const { data, error } = await svc
    .from('meta_early_status_pendings')
    .upsert({
      company_id:         instance.company_id,
      instance_id:        instance.id,
      meta_message_id:    wamid,
      status:             newStatus,
      provider_timestamp: providerTimestamp,
      error_code:         errorCode,
    }, {
      onConflict: PENDING_CONFLICT_COLUMNS,
      ignoreDuplicates: true,
    })
    .select('id');

  if (!error) {
    if (Array.isArray(data) && data.some((row) => row?.id != null)) return 'inserted';
    if (Array.isArray(data) && data.length === 0) return 'duplicate';
    console.error('[meta/webhook] event_type=status early_status_persist_failed db_error=true');
    return 'db_error';
  }

  if (canConfirmPendingDuplicate(error)) {
    const confirmed = await confirmEarlyPendingExists(svc, instance, wamid, newStatus);
    if (confirmed === 'present') return 'duplicate';
  }
  console.error('[meta/webhook] event_type=status early_status_persist_failed db_error=true');
  return 'db_error';
}

/**
 * Pendências do wamid corrente. Lista vazia e erro operacional não se confundem.
 *
 * @returns {Promise<{ error: true, rows: null }|{ error: false, rows: object[] }>}
 */
export async function loadCurrentOutboundPendings(svc, instance, wamid) {
  if (!hasScope(instance) || typeof wamid !== 'string' || wamid.length === 0) {
    return { error: true, rows: null };
  }

  const { data, error } = await svc
    .from('meta_early_status_pendings')
    .select('id, company_id, instance_id, meta_message_id, status, provider_timestamp, received_at, error_code')
    .eq('company_id', instance.company_id)
    .eq('instance_id', instance.id)
    .eq('meta_message_id', wamid)
    .order('received_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(CURRENT_WAMID_PENDING_LIMIT);

  if (error || !Array.isArray(data)) return { error: true, rows: null };
  return { error: false, rows: data };
}

function storedClock(row) {
  const provider = clockFromValue(row?.provider_timestamp);
  if (provider) return provider;
  return clockFromValue(row?.received_at);
}

function clockFromValue(value) {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    return null;
  }
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return null;
}

function compareReceivedAt(left, right) {
  const leftMs = Date.parse(left ?? '');
  const rightMs = Date.parse(right ?? '');
  const leftOk = !Number.isNaN(leftMs);
  const rightOk = !Number.isNaN(rightMs);
  if (leftOk && rightOk && leftMs !== rightMs) return leftMs - rightMs;
  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function comparePendingId(left, right) {
  const leftText = String(left ?? '');
  const rightText = String(right ?? '');
  if (leftText.length !== rightText.length) return leftText.length - rightText.length;
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function sortPendings(rows) {
  return [...rows].sort((left, right) => {
    const byTime = compareReceivedAt(left?.received_at, right?.received_at);
    if (byTime !== 0) return byTime;
    return comparePendingId(left?.id, right?.id);
  });
}

async function stampPendingClaimFailure(svc, instance, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 'ok';
  const { error } = await svc
    .from('meta_early_status_pendings')
    .update({ last_claim_failed_at: new Date().toISOString() })
    .eq('company_id', instance.company_id)
    .eq('instance_id', instance.id)
    .in('id', ids);
  if (error) {
    console.error('[meta/webhook] event_type=status pending_claim_stamp_failed db_error=true');
    return 'error';
  }
  return 'ok';
}

/**
 * Remove somente ids já decididos, no escopo da instância.
 *
 * @returns {Promise<'ok'|'error'>}
 */
async function deleteDecidedPendings(svc, instance, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 'ok';
  const { error } = await svc
    .from('meta_early_status_pendings')
    .delete()
    .eq('company_id', instance.company_id)
    .eq('instance_id', instance.id)
    .in('id', ids)
    .select('id');
  if (error) {
    console.error('[meta/webhook] event_type=status pending_delete_failed db_error=true');
    return 'error';
  }
  return 'ok';
}

/**
 * Limpa o marcador somente se o status observado antes do toque ainda for o atual.
 * Zero linhas não é erro: outro CAS pode ter avançado o tracking.
 *
 * @returns {Promise<'cleared'|'unchanged'|'error'>}
 */
export async function clearOutboundNotifyMarker(svc, instance, trackingId, observedStatus) {
  if (!hasScope(instance) || typeof trackingId !== 'string' || trackingId.length === 0) {
    console.error('[meta/webhook] event_type=status notify_marker_clear_failed db_error=true');
    return 'error';
  }
  if (typeof observedStatus !== 'string' || observedStatus.length === 0) {
    console.error('[meta/webhook] event_type=status notify_marker_clear_failed db_error=true');
    return 'error';
  }

  const { data, error } = await svc
    .from('meta_whatsapp_messages')
    .update({ realtime_notify_pending: false })
    .eq('company_id', instance.company_id)
    .eq('instance_id', instance.id)
    .eq('id', trackingId)
    .eq('status', observedStatus)
    .eq('realtime_notify_pending', true)
    .select('id');

  if (error || !Array.isArray(data)) {
    console.error('[meta/webhook] event_type=status notify_marker_clear_failed db_error=true');
    return 'error';
  }
  if (data.length === 0) return 'unchanged';
  return 'cleared';
}

/**
 * Reconcilia pendências já ordenáveis de um wamid.
 * A ordem efetiva é received_at, id. last_claim_failed_at não define a sequência.
 * db_error e exhausted não são decisão da matriz: a reconciliação daquele
 * wamid para, e os eventos ainda não julgados permanecem.
 */
export async function reconcileOutboundPendings(svc, instance, rows) {
  const ordered = sortPendings(Array.isArray(rows) ? rows : []);
  const retainedIds = [];
  let transient = false;
  let halted = false;
  let shouldNotify = false;
  let trackingId = null;
  let statusForNotify = null;

  for (const row of ordered) {
    if (row?.company_id !== instance.company_id || row?.instance_id !== instance.id) {
      console.log('[meta/webhook] event_type=status status_scope_mismatch=true');
      continue;
    }

    const clock = storedClock(row);
    if (!clock || !SUPPORTED_STATUSES.has(row.status)) {
      transient = true;
      halted = true;
      await stampPendingClaimFailure(svc, instance, [row.id]);
      console.error('[meta/webhook] event_type=status status_persist_failed db_error=true');
      break;
    }

    const applied = await applyStoredOutboundStatus(svc, instance, row.meta_message_id, row.status, {
      timestamp: clock,
      errorCode: row.status === 'failed' ? row.error_code : null,
    });

    if (applied.outcome === 'applied' || applied.outcome === 'duplicate') {
      retainedIds.push(row.id);
      shouldNotify = true;
      trackingId = applied.trackingId;
      statusForNotify = applied.statusForNotify;
      if (applied.outcome === 'applied') {
        console.log('[meta/webhook] event_type=status status=%s transition_applied=true', row.status);
      }
      continue;
    }

    if (applied.outcome === 'noop') {
      const removed = await deleteDecidedPendings(svc, instance, [row.id]);
      if (removed === 'error') await stampPendingClaimFailure(svc, instance, [row.id]);
      console.log('[meta/webhook] event_type=status transition_blocked=true status=%s', row.status);
      continue;
    }

    if (applied.outcome === 'db_error' || applied.outcome === 'exhausted') {
      transient = true;
      halted = true;
      await stampPendingClaimFailure(svc, instance, [row.id]);
      console.error('[meta/webhook] event_type=status status_persist_failed db_error=true');
      break;
    }

    if (applied.outcome === 'mismatch') {
      transient = true;
      halted = true;
      console.log('[meta/webhook] event_type=status status_scope_mismatch=true');
      break;
    }

    transient = true;
    halted = true;
    console.log(
      '[meta/webhook] event_type=status instance_resolved=true wamid_found=false correlated=false status=%s',
      row.status,
    );
    break;
  }

  return { transient, halted, shouldNotify, retainedIds, trackingId, statusForNotify };
}

async function notifyRetained(svc, instance, wamid, retainedIds, trackingId, statusForNotify) {
  if (!trackingId || !statusForNotify) {
    if (retainedIds.length > 0) await stampPendingClaimFailure(svc, instance, retainedIds);
    return { transient: retainedIds.length > 0 };
  }

  const touch = await touchOutboundChatMessage(svc, instance, wamid);
  if (touch === 'error') {
    await stampPendingClaimFailure(svc, instance, retainedIds);
    return { transient: true };
  }

  const cleared = await clearOutboundNotifyMarker(svc, instance, trackingId, statusForNotify);
  if (cleared === 'error') {
    await stampPendingClaimFailure(svc, instance, retainedIds);
    return { transient: true };
  }

  const removed = await deleteDecidedPendings(svc, instance, retainedIds);
  if (removed === 'error') {
    await stampPendingClaimFailure(svc, instance, retainedIds);
    return { transient: false };
  }
  return { transient: false };
}

function logLiveOutcome(outcome, newStatus) {
  if (outcome === 'db_error' || outcome === 'exhausted') {
    console.error('[meta/webhook] event_type=status status_persist_failed db_error=true');
    return;
  }
  if (outcome === 'mismatch') {
    console.log('[meta/webhook] event_type=status status_scope_mismatch=true');
    return;
  }
  if (outcome === 'applied') {
    console.log('[meta/webhook] event_type=status status=%s transition_applied=true', newStatus);
    return;
  }
  if (outcome === 'duplicate' || outcome === 'unknown') return;
  console.log('[meta/webhook] event_type=status transition_blocked=true status=%s', newStatus);
}

/**
 * Decide um status ao vivo. Pendências do mesmo wamid entram antes do evento.
 * unknown persiste a pendência e não reaplica o evento se o tracking surgir.
 *
 * @returns {Promise<{ transient: boolean }>}
 */
export async function handleLiveOutboundStatus(svc, instance, wamid, newStatus, statusItem) {
  if (!hasScope(instance)) {
    console.error('[meta/webhook] event_type=status status_persist_failed db_error=true');
    return { transient: true };
  }

  const pendings = await loadCurrentOutboundPendings(svc, instance, wamid);
  if (pendings.error) {
    console.error('[meta/webhook] event_type=status status_persist_failed db_error=true');
    await persistEarlyOutboundStatus(svc, instance, wamid, newStatus, statusItem);
    return { transient: true };
  }

  let transient = false;
  let retainedIds = [];
  let trackingId = null;
  let statusForNotify = null;
  let shouldNotify = false;

  if (pendings.rows.length > 0) {
    const earlier = await reconcileOutboundPendings(svc, instance, pendings.rows);
    transient = earlier.transient;
    retainedIds = earlier.retainedIds;
    if (earlier.shouldNotify) {
      shouldNotify = true;
      trackingId = earlier.trackingId;
      statusForNotify = earlier.statusForNotify;
    }
    if (earlier.halted) {
      if (shouldNotify) {
        const notify = await notifyRetained(
          svc,
          instance,
          wamid,
          retainedIds,
          trackingId,
          statusForNotify,
        );
        if (notify.transient) transient = true;
      }
      const persisted = await persistEarlyOutboundStatus(svc, instance, wamid, newStatus, statusItem);
      if (persisted === 'db_error') transient = true;
      return { transient: true };
    }
  }

  const live = await applyResolved(svc, instance, wamid, newStatus, statusItem, undefined);

  if (live.outcome === 'unknown') {
    if (shouldNotify) {
      const notify = await notifyRetained(
        svc,
        instance,
        wamid,
        retainedIds,
        trackingId,
        statusForNotify,
      );
      if (notify.transient) transient = true;
    }
    const persisted = await persistEarlyOutboundStatus(svc, instance, wamid, newStatus, statusItem);
    if (persisted === 'db_error') return { transient: true };
    const reread = await loadOutboundTracking(svc, instance, wamid);
    if (reread.error) {
      console.error('[meta/webhook] event_type=status status_persist_failed db_error=true');
      return { transient: true };
    }
    if (!reread.row) {
      console.log(
        '[meta/webhook] event_type=status instance_resolved=true wamid_found=false correlated=false status=%s',
        newStatus,
      );
      return { transient };
    }
    const again = await loadCurrentOutboundPendings(svc, instance, wamid);
    if (again.error) {
      console.error('[meta/webhook] event_type=status status_persist_failed db_error=true');
      return { transient: true };
    }
    const raced = await reconcileOutboundPendings(svc, instance, again.rows);
    const notify = raced.shouldNotify
      ? await notifyRetained(
        svc,
        instance,
        wamid,
        raced.retainedIds,
        raced.trackingId,
        raced.statusForNotify,
      )
      : { transient: false };
    return { transient: transient || raced.transient || notify.transient };
  }

  logLiveOutcome(live.outcome, newStatus);
  if (live.outcome === 'db_error' || live.outcome === 'exhausted') transient = true;
  if (live.outcome === 'applied' || live.outcome === 'duplicate') {
    shouldNotify = true;
    trackingId = live.trackingId;
    statusForNotify = live.statusForNotify;
  }

  if (shouldNotify) {
    const notify = await notifyRetained(
      svc,
      instance,
      wamid,
      retainedIds,
      trackingId,
      statusForNotify,
    );
    if (notify.transient) transient = true;
  }
  return { transient };
}

/**
 * Reparte o orçamento de cinco unidades. Sobra de uma categoria vai para a outra.
 */
export function allocateOpportunisticSlots(pendingAvailable, markerAvailable) {
  const pending = Math.max(0, Number(pendingAvailable) || 0);
  const markers = Math.max(0, Number(markerAvailable) || 0);
  let pendingSlots = Math.min(OPPORTUNISTIC_PENDING_RESERVE, pending);
  let markerSlots = Math.min(OPPORTUNISTIC_MARKER_RESERVE, markers);
  let rest = OPPORTUNISTIC_WORK_BUDGET - pendingSlots - markerSlots;
  const pendingUnmet = pending - pendingSlots;
  const markerUnmet = markers - markerSlots;
  if (rest > 0 && pendingUnmet > 0) {
    const give = Math.min(rest, pendingUnmet);
    pendingSlots += give;
    rest -= give;
  }
  if (rest > 0 && markerUnmet > 0) {
    const give = Math.min(rest, markerUnmet);
    markerSlots += give;
  }
  return { pendingSlots, markerSlots };
}

async function loadNotifyMarkers(svc, instance) {
  const { data, error } = await svc
    .from('meta_whatsapp_messages')
    .select('id, meta_message_id, status')
    .eq('company_id', instance.company_id)
    .eq('instance_id', instance.id)
    .eq('realtime_notify_pending', true)
    .limit(OPPORTUNISTIC_WORK_BUDGET);

  if (error || !Array.isArray(data)) return { error: true, rows: null };
  return { error: false, rows: data };
}

async function cleanupExpiredPendings(svc, instance) {
  const result = await svc.rpc('delete_expired_meta_early_status_pendings', {
    p_company_id:  instance.company_id,
    p_instance_id: instance.id,
  });
  if (!result || result.error) {
    console.error('[meta/webhook] event_type=status expired_pending_cleanup_failed db_error=true');
  }
}

/**
 * Recuperação dos outros wamids da instância, uma vez por request.
 * A seleção SQL só escolhe candidatos. A aplicação de cada wamid começa
 * pelo mais antigo e para no prefixo que cabe no orçamento.
 * Não há rotação persistente de marcador: o schema não tem coluna para isso.
 *
 * @returns {Promise<{ transient: boolean }>}
 */
export async function recoverOutboundStatusBacklog(svc, instance, handledWamids) {
  if (!hasScope(instance)) return { transient: false };
  const handled = handledWamids instanceof Set ? handledWamids : new Set(handledWamids ?? []);
  let transient = false;
  const exclude = handled.size === 1 ? [...handled][0] : null;

  const listed = await svc.rpc('list_meta_early_status_pendings', {
    p_company_id:                instance.company_id,
    p_instance_id:               instance.id,
    p_exclude_meta_message_id:   exclude,
  });

  let candidateRows = [];
  if (listed?.error) {
    console.error('[meta/webhook] event_type=status opportunistic_list_failed db_error=true');
  } else if (Array.isArray(listed?.data)) {
    candidateRows = listed.data.filter((row) => row && !handled.has(row.meta_message_id));
  } else if (listed?.data != null) {
    console.error('[meta/webhook] event_type=status opportunistic_list_failed db_error=true');
  }

  const wamidOrder = [];
  const seen = new Set();
  for (const row of candidateRows) {
    if (typeof row.meta_message_id !== 'string' || seen.has(row.meta_message_id)) continue;
    seen.add(row.meta_message_id);
    wamidOrder.push(row.meta_message_id);
  }

  const loadedGroups = [];
  let pendingAvailable = 0;
  for (const wamid of wamidOrder) {
    if (pendingAvailable >= OPPORTUNISTIC_WORK_BUDGET) break;
    const loaded = await loadCurrentOutboundPendings(svc, instance, wamid);
    if (loaded.error) {
      transient = true;
      console.error('[meta/webhook] event_type=status status_persist_failed db_error=true');
      continue;
    }
    if (loaded.rows.length === 0) continue;
    loadedGroups.push({ wamid, rows: sortPendings(loaded.rows) });
    pendingAvailable += loaded.rows.length;
  }

  const markersLoaded = await loadNotifyMarkers(svc, instance);
  const markers = markersLoaded.error
    ? []
    : markersLoaded.rows.filter((row) => row && !handled.has(row.meta_message_id));
  if (markersLoaded.error) {
    console.error('[meta/webhook] event_type=status opportunistic_list_failed db_error=true');
  }

  const slots = allocateOpportunisticSlots(pendingAvailable, markers.length);
  const touched = new Set();
  let pendingLeft = slots.pendingSlots;

  for (const group of loadedGroups) {
    if (pendingLeft <= 0) break;
    const prefix = group.rows.slice(0, pendingLeft);
    pendingLeft -= prefix.length;
    const reconciled = await reconcileOutboundPendings(svc, instance, prefix);
    if (reconciled.transient) transient = true;
    if (reconciled.shouldNotify) {
      const notify = await notifyRetained(
        svc,
        instance,
        group.wamid,
        reconciled.retainedIds,
        reconciled.trackingId,
        reconciled.statusForNotify,
      );
      if (notify.transient) transient = true;
    }
    touched.add(group.wamid);
  }

  let markerLeft = slots.markerSlots;
  for (const marker of markers) {
    if (markerLeft <= 0) break;
    if (typeof marker.meta_message_id !== 'string') continue;
    if (handled.has(marker.meta_message_id) || touched.has(marker.meta_message_id)) continue;
    markerLeft -= 1;
    touched.add(marker.meta_message_id);
    const touch = await touchOutboundChatMessage(svc, instance, marker.meta_message_id);
    if (touch === 'error') {
      transient = true;
      continue;
    }
    const cleared = await clearOutboundNotifyMarker(svc, instance, marker.id, marker.status);
    if (cleared === 'error') transient = true;
  }

  await cleanupExpiredPendings(svc, instance);
  return { transient };
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
