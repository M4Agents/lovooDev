// Autorização incremental da mídia de conversa Meta.
// Não autentica e não duplica a matriz de roles. source_ref é só a pista:
// meta-inbound:{wamid} e meta-outbound:{operationId} exigem vínculo único,
// no company_id autorizado, compatível com o arquivo e com a conversa ativa.
// Referência Meta inválida não vira arquivo compartilhado.
// source_ref nulo, outro prefixo e lmu: permanecem na biblioteca.

import {
  applyMetaConversationFilters,
  authorizeMetaConversation,
} from './metaConversationAccess.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WAMID_RE = /^[A-Za-z0-9._=-]{1,200}$/;
const META_KEY_SEGMENTS = new Set(['meta-inbound', 'meta-outbound']);

export const COMMERCIAL_SOURCE_OR = [
  'source_ref.is.null',
  'source_ref.like.lmu:%',
  'and(source_ref.not.like.meta-inbound:%,source_ref.not.like.meta-outbound:%)',
].join(',');

export const META_CONVERSATION_SOURCE_OR =
  'source_ref.like.meta-inbound:%,source_ref.like.meta-outbound:%';

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Classifica a origem sem consultar o banco.
 * kind "meta" não pode ser reclassificada como biblioteca compartilhada.
 */
export function classifyCompanyMediaSource(sourceRef) {
  if (typeof sourceRef !== 'string' || sourceRef.length === 0) {
    return { kind: 'shared' };
  }
  if (sourceRef.startsWith('lmu:')) return { kind: 'shared' };
  if (sourceRef.startsWith('meta-inbound:')) {
    const wamid = sourceRef.slice('meta-inbound:'.length);
    if (!WAMID_RE.test(wamid)) return { kind: 'meta', valid: false, direction: 'inbound' };
    return { kind: 'meta', valid: true, direction: 'inbound', wamid };
  }
  if (sourceRef.startsWith('meta-outbound:')) {
    const operationId = sourceRef.slice('meta-outbound:'.length);
    if (!isUuid(operationId)) return { kind: 'meta', valid: false, direction: 'outbound' };
    return {
      kind: 'meta',
      valid: true,
      direction: 'outbound',
      operationId: operationId.toLowerCase(),
    };
  }
  return { kind: 'shared' };
}

function decodeStorageKey(value) {
  let current = value.trim();
  if (current.includes('\0')) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) return null;
    if (decoded === current) break;
    current = decoded;
  }
  current = current.replace(/\\/g, '/').normalize('NFKC');
  const parts = [];
  for (const part of current.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts;
}

/** Chave normalizada de objeto Meta. Decodificação inválida com o prefixo também bloqueia. */
export function isMetaConversationStorageKey(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  const hint = value.toLowerCase();
  const mentionsMeta = hint.includes('meta-inbound')
    || hint.includes('meta-outbound')
    || hint.includes('meta%2dinbound')
    || hint.includes('meta%2doutbound');
  const parts = decodeStorageKey(value);
  if (!parts) return mentionsMeta;
  return parts.some((part) => META_KEY_SEGMENTS.has(part.toLowerCase()));
}

function sameId(left, right) {
  return isUuid(left) && isUuid(right) && left.toLowerCase() === right.toLowerCase();
}

function groupBy(rows, readKey) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    const key = readKey(row);
    if (typeof key !== 'string' || key.length === 0) continue;
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

async function readQuery(query) {
  try {
    const result = await query;
    return { data: result?.data ?? null, error: result?.error ?? null };
  } catch {
    return { data: null, error: { message: 'query_failed' } };
  }
}

function originFailure() {
  return { ok: false, status: 500, error: 'internal_error' };
}

async function loadInbound(svc, companyId, wamids) {
  if (wamids.length === 0) return { ok: true, rows: [] };
  const result = await readQuery(
    svc.from('meta_messages')
      .select('id, company_id, conversation_id, instance_id, meta_message_id, media_asset_id')
      .eq('company_id', companyId)
      .in('meta_message_id', wamids),
  );
  if (result.error) return originFailure();
  return { ok: true, rows: result.data ?? [] };
}

async function loadOutbound(svc, companyId, operationIds) {
  if (operationIds.length === 0) return { ok: true, rows: [] };
  const result = await readQuery(
    svc.from('meta_outbound_audio_operations')
      .select('id, company_id, operation_id, conversation_id, instance_id, s3_key')
      .eq('company_id', companyId)
      .in('operation_id', operationIds),
  );
  if (result.error) return originFailure();
  return { ok: true, rows: result.data ?? [] };
}

async function loadVisibleConversations(svc, scope, conversationIds) {
  if (conversationIds.length === 0) return { ok: true, byId: new Map() };
  const filtered = applyMetaConversationFilters(
    svc.from('meta_conversations').select('id, company_id, instance_id, assigned_to, status'),
    scope,
    {},
  );
  if (!filtered.ok) return { ok: false, status: 403, error: 'Acesso negado' };
  const result = await readQuery(
    filtered.query.in('id', conversationIds).eq('status', 'active'),
  );
  if (result.error) return originFailure();
  const byId = new Map();
  for (const row of result.data ?? []) {
    if (!row || row.company_id !== scope.companyId || row.status !== 'active') continue;
    if (scope.visibility === 'assigned' && row.assigned_to !== scope.userId) continue;
    if (!isUuid(row.id)) continue;
    byId.set(row.id.toLowerCase(), row);
  }
  return { ok: true, byId };
}

function conversationMatches(conversation, instanceId) {
  return Boolean(conversation) && sameId(conversation.instance_id, instanceId);
}

function belongsToCompany(row, companyId) {
  return !row?.company_id || row.company_id === companyId;
}

function resolveInboundLink(row, classification, messagesByWamid, companyId) {
  if (!belongsToCompany(row, companyId)) return null;
  const matches = messagesByWamid.get(classification.wamid) ?? [];
  const scoped = matches.filter((message) => message?.company_id === companyId);
  if (scoped.length !== 1) return null;
  const message = scoped[0];
  if (!sameId(message.media_asset_id, row.id)) return null;
  if (!isUuid(message.conversation_id) || !isUuid(message.instance_id)) return null;
  return { conversationId: message.conversation_id, instanceId: message.instance_id };
}

function resolveOutboundLink(row, classification, operationsById, companyId) {
  if (!belongsToCompany(row, companyId)) return null;
  const matches = operationsById.get(classification.operationId) ?? [];
  const scoped = matches.filter((operation) => operation?.company_id === companyId);
  if (scoped.length !== 1) return null;
  const operation = scoped[0];
  if (typeof operation.s3_key !== 'string' || operation.s3_key.length === 0) return null;
  if (operation.s3_key !== row.s3_key) return null;
  if (!isUuid(operation.conversation_id) || !isUuid(operation.instance_id)) return null;
  return { conversationId: operation.conversation_id, instanceId: operation.instance_id };
}

/** Conversa única já resolvida. O lote usa applyMetaConversationFilters, sem consulta por arquivo. */
export async function assertMetaMediaConversation(svc, scope, conversationId, instanceId) {
  const authorized = await authorizeMetaConversation(svc, scope, {
    conversationId,
    instanceId,
  });
  if (!authorized.ok) return authorized;
  const result = await readQuery(
    svc.from('meta_conversations')
      .select('id, company_id, status')
      .eq('company_id', scope.companyId)
      .eq('id', conversationId)
      .maybeSingle(),
  );
  if (result.error) return originFailure();
  if (!result.data || result.data.status !== 'active' || result.data.company_id !== scope.companyId) {
    return { ok: false, status: 404, error: 'conversation_not_found' };
  }
  return authorized;
}

/** Tira do resultado a mídia Meta que o seller restrito não prova. Visão ampla não consulta de novo. */
export async function filterAssignedCompanyMedia(svc, scope, rows) {
  if (!scope || scope.ok !== true || !isUuid(scope.companyId) || !isUuid(scope.userId)) {
    return { ok: false, status: 403, error: 'Acesso negado' };
  }
  const list = Array.isArray(rows) ? rows : [];
  if (scope.visibility !== 'assigned') return { ok: true, rows: list };

  const shared = [];
  const inbound = [];
  const outbound = [];
  for (const row of list) {
    const classification = classifyCompanyMediaSource(row?.source_ref);
    if (classification.kind !== 'meta') {
      shared.push(row);
      continue;
    }
    if (!classification.valid || !belongsToCompany(row, scope.companyId)) continue;
    if (classification.direction === 'inbound') inbound.push({ row, classification });
    else outbound.push({ row, classification });
  }

  const inboundResult = await loadInbound(
    svc,
    scope.companyId,
    [...new Set(inbound.map((item) => item.classification.wamid))],
  );
  if (!inboundResult.ok) return inboundResult;
  const outboundResult = await loadOutbound(
    svc,
    scope.companyId,
    [...new Set(outbound.map((item) => item.classification.operationId))],
  );
  if (!outboundResult.ok) return outboundResult;

  const messagesByWamid = groupBy(inboundResult.rows, (message) => message?.meta_message_id);
  const operationsById = groupBy(
    outboundResult.rows,
    (operation) => (
      isUuid(operation?.operation_id) ? operation.operation_id.toLowerCase() : ''
    ),
  );

  const linked = [];
  for (const item of inbound) {
    const link = resolveInboundLink(item.row, item.classification, messagesByWamid, scope.companyId);
    if (link) linked.push({ row: item.row, ...link });
  }
  for (const item of outbound) {
    const link = resolveOutboundLink(item.row, item.classification, operationsById, scope.companyId);
    if (link) linked.push({ row: item.row, ...link });
  }

  const visible = await loadVisibleConversations(
    svc,
    scope,
    [...new Set(linked.map((item) => item.conversationId))],
  );
  if (!visible.ok) return visible;

  const allowed = linked
    .filter((item) => {
      const conversation = visible.byId.get(item.conversationId.toLowerCase());
      return conversationMatches(conversation, item.instanceId);
    })
    .map((item) => item.row);

  return { ok: true, rows: [...shared, ...allowed] };
}
