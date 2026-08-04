// =============================================================================
// POST /api/nuvemshop/admin/register-webhooks
//
// Registra (ou re-registra) os webhooks na loja Nuvemshop conectada.
// Útil para conexões existentes que ainda não têm webhooks registrados
// ou para re-registro após desconexão parcial.
//
// Segurança: ALLOWED_ROLES (manager+)
// =============================================================================

import { getSupabaseAdmin }                   from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller, ALLOWED_ROLES } from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import { registerWebhooks }                   from '../../lib/nuvemshop/webhookSync.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { company_id: companyId } = req.body ?? {};
  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });

  const svc  = getSupabaseAdmin();
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: ALLOWED_ROLES });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data: conn } = await svc
    .from('nuvemshop_connections')
    .select('nuvemshop_store_id, access_token_enc, webhook_ids')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (!conn) return res.status(404).json({ error: 'Nenhuma conexão ativa encontrada' });

  const result = await registerWebhooks(conn, companyId);

  if (result.webhookIds.length > 0) {
    await svc
      .from('nuvemshop_connections')
      .update({ webhook_ids: result.webhookIds, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('nuvemshop_store_id', conn.nuvemshop_store_id);
  }

  return res.status(200).json({
    ok:         true,
    registered: result.registered.length,
    skipped:    result.skipped.length,
    failed:     result.failed.length,
    topics: {
      registered: result.registered,
      skipped:    result.skipped,
      failed:     result.failed,
    },
  });
}
