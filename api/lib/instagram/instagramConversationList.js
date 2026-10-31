// Dono e página da lista de conversas Instagram.
// all não filtra dono. official filtra connection_id. byo filtra byo_account_id
// com connection_id nulo. A página cabe abaixo do teto do PostgREST.

export const CONVERSATION_PAGE_SIZE = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function quote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function searchOr(term) {
  return `participant_username.ilike.%${term}%,participant_name.ilike.%${term}%,last_message_preview.ilike.%${term}%`;
}

function timestampCursorOr(cursor) {
  const at = quote(cursor.at);
  const id = quote(cursor.id);
  return `last_message_at.lt.${at},and(last_message_at.eq.${at},id.lt.${id}),last_message_at.is.null`;
}

export function parseConversationOwner(query) {
  const owner = text(query.owner);
  const connectionId = text(query.connection_id);
  const byoId = text(query.byo_account_id);
  const hasConnection = connectionId !== '' && connectionId !== 'all';
  const hasByo = byoId !== '';

  if (hasConnection && hasByo) return { ok: false };
  if (owner && (hasConnection || hasByo)) return { ok: false };

  if (owner) {
    if (owner === 'all') return { ok: true, kind: 'all' };
    const official = /^official:([0-9a-f-]{36})$/i.exec(owner);
    if (official && UUID_RE.test(official[1])) {
      return { ok: true, kind: 'official', id: official[1].toLowerCase() };
    }
    const byo = /^byo:([0-9a-f-]{36})$/i.exec(owner);
    if (byo && UUID_RE.test(byo[1])) {
      return { ok: true, kind: 'byo', id: byo[1].toLowerCase() };
    }
    return { ok: false };
  }

  if (hasByo) {
    if (!UUID_RE.test(byoId)) return { ok: false };
    return { ok: true, kind: 'byo', id: byoId.toLowerCase() };
  }
  if (!hasConnection) return { ok: true, kind: 'all' };
  if (!UUID_RE.test(connectionId)) return { ok: false };
  return { ok: true, kind: 'official', id: connectionId.toLowerCase() };
}

export function parseConversationCursor(query) {
  const id = query.cursor_id;
  const at = query.cursor_at;
  const hasId = typeof id === 'string' && id !== '';
  const hasAt = typeof at === 'string' && at !== '';
  if (!hasId && !hasAt) return { ok: true, cursor: null };
  if (!hasId || !UUID_RE.test(id)) return { ok: false };
  if (!hasAt || at === 'null') {
    return { ok: true, cursor: { at: null, id: id.toLowerCase() } };
  }
  if (Number.isNaN(Date.parse(at))) return { ok: false };
  return { ok: true, cursor: { at, id: id.toLowerCase() } };
}

export function applyConversationScope(query, { companyId, owner, filterType }) {
  let next = query.eq('company_id', companyId).eq('status', 'active');
  if (owner.kind === 'official') next = next.eq('connection_id', owner.id);
  if (owner.kind === 'byo') next = next.eq('byo_account_id', owner.id).is('connection_id', null);
  if (filterType === 'unread') next = next.gt('unread_count', 0);
  else if (filterType === 'assigned') next = next.not('assigned_to', 'is', null);
  else if (filterType === 'unassigned') next = next.is('assigned_to', null);
  return next;
}

export function applyConversationWindow(query, { search, cursor }) {
  const term = text(search);
  if (cursor?.at) {
    const cursorGroup = timestampCursorOr(cursor);
    if (!term) return query.or(cursorGroup);
    return query.or(`and(or(${searchOr(term)}),or(${cursorGroup}))`);
  }
  let next = term ? query.or(searchOr(term)) : query;
  if (cursor) next = next.is('last_message_at', null).lt('id', cursor.id);
  return next;
}

export function nextConversationCursor(rows) {
  if (!Array.isArray(rows) || rows.length < CONVERSATION_PAGE_SIZE) return null;
  const last = rows[rows.length - 1];
  if (!last || typeof last.id !== 'string') return null;
  return { at: last.last_message_at ?? null, id: last.id };
}
