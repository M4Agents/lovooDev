// =============================================================================
// POST /api/nuvemshop/admin/reset-checkpoint
//
// Reinicia um checkpoint específico de sincronização.
//
// Body: { company_id, sync_type }
//   sync_type: 'categories' | 'products' | 'customers' | 'orders'
//
// RBAC: super_admin, system_admin, admin.
// =============================================================================

import { getSupabaseAdmin }       from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller } from '../../lib/nuvemshop/validateNuvemshopCaller.js';

const ALLOWED_ROLES = ['super_admin', 'system_admin', 'admin'];
const VALID_TYPES   = ['categories', 'products', 'customers', 'orders'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id: companyId, sync_type: syncType } = req.body ?? {};

  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });
  if (!syncType || !VALID_TYPES.includes(syncType)) {
    return res.status(400).json({
      error: `sync_type inválido. Valores aceitos: ${VALID_TYPES.join(', ')}`,
    });
  }

  const requestId = `req_${Date.now()}`;
  const svc       = getSupabaseAdmin();

  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: ALLOWED_ROLES });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // Buscar store_id da conexão ativa
  const { data: conn } = await svc
    .from('nuvemshop_connections')
    .select('nuvemshop_store_id')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (!conn) return res.status(404).json({ error: 'Nenhuma conexão ativa encontrada' });

  const { error: updateErr } = await svc
    .from('nuvemshop_sync_checkpoints')
    .update({
      status:            'idle',
      cursor_since_id:   null,
      cursor_updated_at: null,
      total_processed:   0,
      total_errors:      0,
      last_activity_at:  null,
      checkpoint_data:   {},
    })
    .eq('company_id', companyId)
    .eq('store_id', conn.nuvemshop_store_id)
    .eq('sync_type', syncType);

  if (updateErr) {
    return res.status(500).json({ error: 'Falha ao resetar checkpoint' });
  }

  console.log(JSON.stringify({
    event:       'checkpoint_reset',
    company_id:  companyId,
    sync_type:   syncType,
    reset_by:    auth.userId,
    role:        auth.role,
    request_id:  requestId,
  }));

  return res.status(200).json({
    ok:        true,
    sync_type: syncType,
    message:   `Checkpoint '${syncType}' resetado com sucesso.`,
  });
}
