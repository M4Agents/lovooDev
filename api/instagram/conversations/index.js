// =============================================================================
// GET /api/instagram/conversations
//
// Lista conversas Instagram de uma empresa com filtros.
//
// Query params:
//   company_id    (obrigatório)
//   connection_id (opcional)  — filtrar por conta Instagram; 'all' = todas
//   filter        (opcional)  — all | unread | assigned | unassigned (padrão: all)
//   search        (opcional)  — busca em username/nome/preview
//
// RBAC: ALLOWED_ROLES (seller+)
// Segurança: company_id resolvido do banco via JWT, nunca do frontend.
// =============================================================================

import { getSupabaseAdmin }        from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../lib/instagram/validateInstagramCaller.js';

const ALLOWED_FILTERS = ['all', 'unread', 'assigned', 'unassigned'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { company_id: companyId, connection_id: connectionId, filter = 'all', search } = req.query;

  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  const filterType = ALLOWED_FILTERS.includes(filter) ? filter : 'all';

  const svc = getSupabaseAdmin();

  const auth = await validateInstagramCaller(req, svc, companyId);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  let query = svc
    .from('instagram_conversations')
    .select([
      'id', 'company_id', 'connection_id', 'ig_thread_id',
      'ig_participant_id', 'participant_name', 'participant_username',
      'participant_avatar', 'lead_id', 'status', 'unread_count',
      'last_message_at', 'last_message_preview', 'assigned_to',
      'created_at', 'updated_at',
    ].join(', '))
    .eq('company_id', companyId)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false, nullsLast: true });

  if (connectionId && connectionId !== 'all') {
    query = query.eq('connection_id', connectionId);
  }

  if (filterType === 'unread') {
    query = query.gt('unread_count', 0);
  } else if (filterType === 'assigned') {
    query = query.not('assigned_to', 'is', null);
  } else if (filterType === 'unassigned') {
    query = query.is('assigned_to', null);
  }

  if (search && search.trim()) {
    const s = search.trim();
    query = query.or(
      `participant_username.ilike.%${s}%,participant_name.ilike.%${s}%,last_message_preview.ilike.%${s}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error('[ig/conversations] query error:', error.message);
    return res.status(500).json({ error: 'Erro ao buscar conversas Instagram' });
  }

  return res.status(200).json({ conversations: data ?? [] });
}
