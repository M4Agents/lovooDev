// =============================================================================
// DELETE /api/instagram/connect/disconnect
//
// Desconecta (revoga) uma conta Instagram da empresa.
//
// Responsabilidades:
//   - Validar JWT + role admin+ (CONNECT_ROLES)
//   - Resolver company_id a partir da conexão no banco (NUNCA do body)
//   - Verificar que o usuário tem acesso à empresa dona da conexão
//   - Marcar conexão como 'revoked' (histórico preservado)
//   - Registrar audit log
//
// Nota sobre revogação Meta:
//   A Meta não expõe endpoint de revogação de token para Instagram Business Login.
//   O token simplesmente expira em 60 dias ou o usuário pode revogar pelo painel Meta.
//   Esta limitação está documentada intencionalmente.
//
// Segurança:
//   - company_id nunca aceito do body (resolvido pelo banco via connection_id)
//   - Apenas admin+ pode desconectar contas
//   - Histórico preservado (soft delete via status = 'revoked')
// =============================================================================

import { getSupabaseAdmin }           from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller,
         CONNECT_ROLES }              from '../../lib/instagram/validateInstagramCaller.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { connection_id: connectionId } = req.body ?? {};

  if (!connectionId) {
    return res.status(400).json({ error: 'connection_id é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // ── Resolver company_id pelo banco (nunca do body) ─────────────────────────
  const { data: connection } = await svc
    .from('instagram_connections')
    .select('id, company_id, instagram_user_id, instagram_username, status')
    .eq('id', connectionId)
    .maybeSingle();

  if (!connection) {
    return res.status(404).json({ error: 'Conexão não encontrada' });
  }

  if (connection.status === 'revoked') {
    return res.status(409).json({ error: 'Conexão já está desconectada' });
  }

  // ── Validar JWT + RBAC contra a empresa dona da conexão ───────────────────
  const auth = await validateInstagramCaller(req, svc, connection.company_id, { roles: CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── Revogar conexão (soft delete — histórico preservado) ──────────────────
  const { error: updateErr } = await svc
    .from('instagram_connections')
    .update({
      status:          'revoked',
      status_reason:   'manual_disconnect',
      disconnected_by: auth.userId,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', connectionId);

  if (updateErr) {
    return res.status(500).json({ error: 'Erro ao desconectar conta Instagram' });
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  await svc.from('instagram_audit_logs').insert({
    company_id:    connection.company_id,
    connection_id: connectionId,
    action:        'disconnect_account',
    performed_by:  auth.userId,
    metadata: {
      instagram_user_id:  connection.instagram_user_id,
      instagram_username: connection.instagram_username,
    },
  });

  return res.status(200).json({
    success: true,
    message: 'Conta Instagram desconectada com sucesso',
  });
}
