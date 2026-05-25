// =============================================================================
// GET /api/instagram/connections
//
// Lista as conexões Instagram de uma empresa.
//
// Query params:
//   company_id  (obrigatório) — validado contra membership do usuário
//   status      (opcional)   — filtrar por: 'active' | 'revoked' | 'error'
//
// Retorna campos públicos — NUNCA retorna token ou dados sensíveis.
//
// RBAC:
//   Leitura: todos os roles (seller, manager, admin, partner, super_admin, system_admin)
//   Conectar/desconectar: apenas admin+ (endpoints separados)
// =============================================================================

import { getSupabaseAdmin }      from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../lib/instagram/validateInstagramCaller.js';

const SAFE_FIELDS = [
  'id',
  'instagram_username',
  'profile_picture_url',
  'status',
  'scopes',
  'token_expires_at',
  'last_error_at',
  'created_at',
  'rate_limit_metadata',
  'connected_by',
].join(', ');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { company_id: companyId, status: statusFilter } = req.query;

  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // Todos os roles podem listar conexões (padrão: ALLOWED_ROLES)
  const auth = await validateInstagramCaller(req, svc, companyId);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  let query = svc
    .from('instagram_connections')
    .select(SAFE_FIELDS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: 'Erro ao buscar conexões Instagram' });
  }

  return res.status(200).json({ connections: data ?? [] });
}
