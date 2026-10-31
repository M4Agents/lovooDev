// =============================================================================
// GET /api/instagram/conversations
//
// Lista conversas Instagram de uma empresa com filtros.
//
// Query params:
//   company_id     (obrigatório)
//   owner          all | official:<uuid> | byo:<uuid>
//   connection_id  (legado) uuid de conexão oficial, ou all
//   filter         all | unread | assigned | unassigned
//   search         busca em username/nome/preview
//   cursor_at      página seguinte; "null" continua entre last_message_at nulos
//   cursor_id      desempate da página seguinte
//
// owner e connection_id/byo_account_id juntos respondem 400.
// RBAC: ALLOWED_ROLES (seller+)
// company_id autorizado pelo JWT, nunca aceito como prova de tenant.
// =============================================================================

import { getSupabaseAdmin }        from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../lib/instagram/validateInstagramCaller.js';
import {
  CONVERSATION_PAGE_SIZE,
  applyConversationScope,
  applyConversationWindow,
  nextConversationCursor,
  parseConversationCursor,
  parseConversationOwner,
} from '../../lib/instagram/instagramConversationList.js';

const ALLOWED_FILTERS = ['all', 'unread', 'assigned', 'unassigned'];
const CONVERSATION_FIELDS = [
  'id', 'company_id', 'connection_id', 'byo_account_id', 'ig_thread_id',
  'ig_participant_id', 'participant_name', 'participant_username',
  'participant_avatar', 'lead_id', 'status', 'unread_count',
  'last_message_at', 'last_message_preview', 'assigned_to',
  'created_at', 'updated_at',
].join(', ');
const BYO_ACCOUNT_FIELD = 'byo_account:instagram_byo_poc_accounts!fk_igconv_byo_account_company(instagram_username)';

function presentConversation(row) {
  const username = row.byo_account?.instagram_username;
  const { byo_account, ...conversation } = row;
  return {
    ...conversation,
    connection_id: conversation.connection_id ?? null,
    byo_account_id: conversation.byo_account_id ?? null,
    byo_instagram_username: typeof username === 'string' ? username : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query?.company_id;
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  const filterType = ALLOWED_FILTERS.includes(req.query.filter) ? req.query.filter : 'all';
  const svc = getSupabaseAdmin();
  const auth = await validateInstagramCaller(req, svc, companyId);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const owner = parseConversationOwner(req.query);
  if (!owner.ok) return res.status(400).json({ error: 'invalid_owner' });
  const cursor = parseConversationCursor(req.query);
  if (!cursor.ok) return res.status(400).json({ error: 'invalid_cursor' });

  const scope = { companyId, owner, filterType };
  const page = applyConversationWindow(
    applyConversationScope(
      svc.from('instagram_conversations').select(`${CONVERSATION_FIELDS}, ${BYO_ACCOUNT_FIELD}`),
      scope,
    ),
    { search: req.query.search, cursor: cursor.cursor },
  )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(CONVERSATION_PAGE_SIZE);

  const counted = applyConversationWindow(
    applyConversationScope(
      svc.from('instagram_conversations').select('id', { count: 'exact', head: true }),
      scope,
    ),
    { search: req.query.search, cursor: null },
  );

  const [listed, totalResult] = await Promise.all([page, counted]);
  if (listed.error || totalResult.error) {
    console.error('[ig/conversations] query error:', listed.error?.message || totalResult.error?.message);
    return res.status(500).json({ error: 'Erro ao buscar conversas Instagram' });
  }

  const conversations = (listed.data ?? []).map(presentConversation);
  return res.status(200).json({
    conversations,
    total: typeof totalResult.count === 'number' ? totalResult.count : conversations.length,
    next_cursor: nextConversationCursor(conversations),
  });
}
