// =============================================================================
// customerServiceWindow
//
// Motor da janela de atendimento de 24 horas do Meta WhatsApp Cloud API (MVP5.B2.1).
//
// Exports:
//   CUSTOMER_SERVICE_WINDOW_MS
//   CUSTOMER_SERVICE_WINDOW_SAFETY_MS
//   resolveCustomerServiceWindow   — puro; sem I/O, Graph, Supabase ou relógio
//                                    implícito quando `now` é injetado.
//   loadLastInboundTimestamp       — SELECT mínimo em meta_messages; não lança;
//                                    o cliente Supabase é fornecido pelo caller.
//
// Fonte de verdade: meta_messages.provider_timestamp com direction='inbound'.
// Não usa created_at, updated_at nem meta_conversations.last_message_at.
//
// Não instancia service_role. Não registra tokens, telefones ou corpos.
// =============================================================================

import { UUID_RE } from './mediaConstants.js';

export const CUSTOMER_SERVICE_WINDOW_MS = 86_400_000;
export const CUSTOMER_SERVICE_WINDOW_SAFETY_MS = 60_000;

const UNKNOWN = Object.freeze({ state: 'unknown', expiresAt: null });
const CLOSED  = Object.freeze({ state: 'closed',  expiresAt: null });

// ISO-8601 com timezone explícito: Z ou offset ±HH:MM.
// Rejeita Unix em segundos, dígitos puros, data sem fuso e anos expandidos.
// Grupos: ano, mês, dia, hora, minuto, segundo, fração opcional, timezone.
const ISO_TZ_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function hasValidCalendarComponents(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/**
 * @typedef {'open'|'closed'|'unknown'} CustomerServiceWindowState
 * @typedef {{ state: CustomerServiceWindowState, expiresAt: string | null }} WindowResult
 * @typedef {{ ok: true, lastInboundAt: string | null }} InboundLoadSuccess
 * @typedef {{ ok: false, reason: 'invalid_client'|'invalid_ids'|'db_error' }} InboundLoadFailure
 */

function parseIsoWithTimezone(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_TZ_RE.exec(value);
  if (!match) return null;

  const year   = Number(match[1]);
  const month  = Number(match[2]);
  const day    = Number(match[3]);
  const hour   = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const tz     = match[8];

  if (!hasValidCalendarComponents(year, month, day, hour, minute, second)) {
    return null;
  }

  if (tz !== 'Z') {
    const tzHour   = Number(tz.slice(1, 3));
    const tzMinute = Number(tz.slice(4, 6));
    if (tzHour > 23 || tzMinute > 59) return null;
  }

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return null;
  return ms;
}

function parseNow(now) {
  if (now === undefined) return Date.now();
  if (now instanceof Date) {
    const ms = now.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof now === 'number') {
    return Number.isFinite(now) ? now : null;
  }
  return parseIsoWithTimezone(now);
}

function resolveSafetyMs(safetyMs) {
  if (safetyMs === undefined) return CUSTOMER_SERVICE_WINDOW_SAFETY_MS;
  if (typeof safetyMs !== 'number' || !Number.isFinite(safetyMs) || safetyMs < 0) {
    return null;
  }
  if (safetyMs >= CUSTOMER_SERVICE_WINDOW_MS) return null;
  return safetyMs;
}

function resolveFutureToleranceMs(futureToleranceMs) {
  if (futureToleranceMs === undefined) return 0;
  if (
    typeof futureToleranceMs !== 'number'
    || !Number.isFinite(futureToleranceMs)
    || futureToleranceMs < 0
  ) {
    return null;
  }
  return futureToleranceMs;
}

function toIsoUtc(ms) {
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const iso = date.toISOString();
    return typeof iso === 'string' ? iso : null;
  } catch {
    return null;
  }
}

function openAt(expiresMs) {
  const expiresAt = toIsoUtc(expiresMs);
  if (expiresAt === null) return UNKNOWN;
  return { state: 'open', expiresAt };
}

/**
 * Calcula o estado da janela de atendimento a partir de um timestamp inbound.
 * Função pura quando `now` é informado. Sem efeitos colaterais.
 *
 * @param {object} [args]
 * @param {unknown} [args.lastInboundAt]
 * @param {unknown} [args.now]
 * @param {unknown} [args.safetyMs]
 * @param {unknown} [args.futureToleranceMs]
 * @returns {WindowResult}
 */
export function resolveCustomerServiceWindow(args) {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) {
    return UNKNOWN;
  }

  const { lastInboundAt, now, safetyMs, futureToleranceMs } = args;
  const inboundMs = parseIsoWithTimezone(lastInboundAt);
  if (inboundMs === null) return UNKNOWN;

  const nowMs = parseNow(now);
  if (nowMs === null) return UNKNOWN;

  const resolvedSafetyMs = resolveSafetyMs(safetyMs);
  if (resolvedSafetyMs === null) return UNKNOWN;

  const resolvedToleranceMs = resolveFutureToleranceMs(futureToleranceMs);
  if (resolvedToleranceMs === null) return UNKNOWN;

  const effectiveWindowMs = CUSTOMER_SERVICE_WINDOW_MS - resolvedSafetyMs;
  if (!Number.isFinite(effectiveWindowMs) || effectiveWindowMs <= 0) return UNKNOWN;

  const deltaMs = nowMs - inboundMs;
  if (!Number.isFinite(deltaMs)) return UNKNOWN;

  if (deltaMs >= effectiveWindowMs) return CLOSED;

  if (deltaMs >= 0) {
    return openAt(inboundMs + effectiveWindowMs);
  }

  const futureByMs = inboundMs - nowMs;
  if (futureByMs > resolvedToleranceMs) return UNKNOWN;

  return openAt(nowMs + effectiveWindowMs);
}

/**
 * Carrega o provider_timestamp do último inbound da conversa.
 * Não lança. Não consulta meta_conversations. Não faz SELECT global.
 *
 * @param {object} svc
 * @param {object} [ids]
 * @param {unknown} [ids.companyId]
 * @param {unknown} [ids.instanceId]
 * @param {unknown} [ids.conversationId]
 * @returns {Promise<InboundLoadSuccess | InboundLoadFailure>}
 */
export async function loadLastInboundTimestamp(svc, ids) {
  if (!svc || typeof svc.from !== 'function') {
    return { ok: false, reason: 'invalid_client' };
  }

  if (ids == null || typeof ids !== 'object' || Array.isArray(ids)) {
    return { ok: false, reason: 'invalid_ids' };
  }

  const { companyId, instanceId, conversationId } = ids;

  if (
    typeof companyId !== 'string'
    || typeof instanceId !== 'string'
    || typeof conversationId !== 'string'
    || !UUID_RE.test(companyId)
    || !UUID_RE.test(instanceId)
    || !UUID_RE.test(conversationId)
  ) {
    return { ok: false, reason: 'invalid_ids' };
  }

  try {
    const { data, error } = await svc
      .from('meta_messages')
      .select('provider_timestamp')
      .eq('company_id', companyId)
      .eq('instance_id', instanceId)
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .not('provider_timestamp', 'is', null)
      .order('provider_timestamp', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { ok: false, reason: 'db_error' };
    }

    if (data == null) {
      return { ok: true, lastInboundAt: null };
    }

    const timestamp = data.provider_timestamp;
    if (typeof timestamp !== 'string') {
      return { ok: true, lastInboundAt: null };
    }

    return { ok: true, lastInboundAt: timestamp };
  } catch {
    return { ok: false, reason: 'db_error' };
  }
}
