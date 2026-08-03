// =============================================================================
// POST /api/nuvemshop/admin/force-resync
//
// Reinicia todos os checkpoints de uma empresa, forçando re-sincronização
// completa na próxima execução do worker de reconciliação.
//
// Body: { company_id }
//
// RBAC: super_admin, system_admin apenas.
//
// Impacto:
//   - Todos os checkpoints da empresa são resetados para status='idle' e
//     cursor zerado, causando full-scan de categorias, produtos, clientes e pedidos.
//   - NÃO apaga dados sincronizados existentes no CRM.
//   - NÃO cancela eventos pendentes no pipeline.
//   - O re-sync acontece na próxima execução do cron (máx. 1h).
// =============================================================================

import { randomUUID }             from 'crypto';
import { getSupabaseAdmin }       from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller } from '../../lib/nuvemshop/validateNuvemshopCaller.js';

const ADMIN_ROLES = ['super_admin', 'system_admin'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id: companyId } = req.body ?? {};
  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });

  const requestId = `req_${Date.now()}`;
  const svc       = getSupabaseAdmin();

  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: ADMIN_ROLES });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // ── Verificar conexão ativa ───────────────────────────────────────────────
  const { data: conn } = await svc
    .from('nuvemshop_connections')
    .select('id, nuvemshop_store_id, status')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (!conn) {
    return res.status(404).json({ error: 'Nenhuma conexão ativa encontrada para esta empresa' });
  }

  // ── Resetar todos os checkpoints ─────────────────────────────────────────
  const { data: updated, error: updateErr } = await svc
    .from('nuvemshop_sync_checkpoints')
    .update({
      status:           'idle',
      cursor_since_id:  null,
      cursor_updated_at:null,
      total_processed:  0,
      total_errors:     0,
      last_activity_at: null,
      checkpoint_data:  {},
    })
    .eq('company_id', companyId)
    .eq('store_id', conn.nuvemshop_store_id)
    .select('sync_type');

  if (updateErr) {
    console.error(JSON.stringify({
      event: 'force_resync_failed', company_id: companyId, error: updateErr.message,
    }));
    return res.status(500).json({ error: 'Falha ao resetar checkpoints' });
  }

  const resetTypes = (updated ?? []).map(r => r.sync_type);

  console.log(JSON.stringify({
    event:           'force_resync_triggered',
    company_id:      companyId,
    store_id:        conn.nuvemshop_store_id,
    reset_types:     resetTypes,
    triggered_by:    auth.userId,
    role:            auth.role,
    request_id:      requestId,
    correlation_id:  `resync_${randomUUID()}`,
  }));

  return res.status(200).json({
    ok:          true,
    reset_types: resetTypes,
    message:     'Checkpoints resetados. O re-sync completo ocorrerá na próxima execução do worker (até 1h).',
  });
}
