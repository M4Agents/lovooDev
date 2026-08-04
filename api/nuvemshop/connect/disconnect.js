// =============================================================================
// POST /api/nuvemshop/connect/disconnect
//
// Desconecta a integração Nuvemshop de uma empresa.
//
// Ação:
//   - Valida JWT + RBAC (CONNECT_ROLES — admin+)
//   - Valida que existe conexão ativa para desconectar
//   - Marca conexão como 'disconnected'
//   - Registra quem desconectou e quando
//
// Segurança:
//   - company_id validado contra company_users (nunca confiado do body)
//   - Preserva histórico: status = 'disconnected' (não deleta o registro)
//   - Dados históricos de leads/oportunidades permanecem intactos
//   - Token criptografado preservado (pode ser necessário para processos LGPD)
// =============================================================================

import { getSupabaseAdmin }          from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller,
         CONNECT_ROLES }             from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import { deleteWebhooks }            from '../../lib/nuvemshop/webhookSync.js';
import { deleteScript }              from '../../lib/nuvemshop/scriptSync.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { company_id: companyId } = req.body ?? {};
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // ── Validar JWT + RBAC ─────────────────────────────────────────────────────
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── Buscar conexão ativa ───────────────────────────────────────────────────
  const { data: connection } = await svc
    .from('nuvemshop_connections')
    .select('id, nuvemshop_store_id, store_name, access_token_enc, webhook_ids, script_id')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (!connection) {
    return res.status(404).json({
      error: 'Nenhuma loja Nuvemshop ativa encontrada para esta empresa',
    });
  }

  // ── Remover webhooks e script (best-effort — não bloqueia desconexão) ────
  await Promise.allSettled([
    deleteWebhooks(connection, companyId).catch(err =>
      console.warn('[nuvemshop/disconnect] webhook_delete_failed companyId=%s err=%s',
        companyId, err?.message)),
    deleteScript(connection, svc).catch(err =>
      console.warn('[nuvemshop/disconnect] script_delete_failed companyId=%s err=%s',
        companyId, err?.message)),
  ]);

  // ── Marcar como desconectada ──────────────────────────────────────────────
  const { error: updateErr } = await svc
    .from('nuvemshop_connections')
    .update({
      status:          'disconnected',
      status_reason:   'voluntary_disconnect',
      disconnected_by: auth.userId,
      disconnected_at: new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
    .eq('id', connection.id)
    .eq('company_id', companyId); // Garante isolamento multi-tenant

  if (updateErr) {
    console.error('[nuvemshop/disconnect] update_failed companyId=%s err=%s',
      companyId, updateErr.message);
    return res.status(500).json({ error: 'Falha ao desconectar a integração' });
  }

  console.log('[nuvemshop/disconnect] disconnected companyId=%s storeId=%s by=%s',
    companyId, connection.nuvemshop_store_id, auth.userId);

  return res.status(200).json({
    ok:         true,
    message:    'Integração Nuvemshop desconectada com sucesso',
    store_name: connection.store_name ?? connection.nuvemshop_store_id,
  });
}
