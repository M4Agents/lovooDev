// =============================================================================
// DELETE /api/instagram/connect/delete
//
// Exclui permanentemente uma conexão Instagram já desconectada (status = 'revoked').
//
// Responsabilidades:
//   - Validar JWT + role admin+ (CONNECT_ROLES)
//   - Resolver company_id a partir da conexão no banco (NUNCA do body)
//   - Verificar que a conexão está revogada (não permite excluir conexões ativas)
//   - Registrar audit log ANTES da exclusão (para rastreabilidade)
//   - Nullificar FKs sem cascade antes do DELETE:
//       · instagram_audit_logs.connection_id   (nullable, sem cascade)
//       · instagram_webhook_events.connection_id (nullable, sem cascade)
//   - Deletar a conexão — cascade cuida de:
//       · instagram_conversations (ON DELETE CASCADE)
//       · instagram_comments      (ON DELETE CASCADE)
//
// Segurança:
//   - company_id nunca aceito do body (resolvido pelo banco via connection_id)
//   - Apenas admin+ pode excluir
//   - Apenas conexões revogadas podem ser excluídas por este endpoint
// =============================================================================

import { getSupabaseAdmin }      from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller,
         CONNECT_ROLES }         from '../../lib/instagram/validateInstagramCaller.js';

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

  if (connection.status !== 'revoked') {
    return res.status(409).json({
      error: 'Apenas conexões desconectadas podem ser excluídas. Desconecte primeiro.',
    });
  }

  // ── Validar JWT + RBAC contra a empresa dona da conexão ───────────────────
  const auth = await validateInstagramCaller(req, svc, connection.company_id, { roles: CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── Audit log ANTES da exclusão (conexão ainda existe para referenciar) ───
  await svc.from('instagram_audit_logs').insert({
    company_id:    connection.company_id,
    connection_id: connectionId,
    action:        'delete_account',
    performed_by:  auth.userId,
    metadata: {
      instagram_user_id:  connection.instagram_user_id,
      instagram_username: connection.instagram_username,
    },
  });

  // ── Nullificar FKs sem ON DELETE CASCADE ──────────────────────────────────
  await svc
    .from('instagram_audit_logs')
    .update({ connection_id: null })
    .eq('connection_id', connectionId);

  await svc
    .from('instagram_webhook_events')
    .update({ connection_id: null })
    .eq('connection_id', connectionId);

  // ── Hard delete — cascade cuida de conversations e comments ───────────────
  const { error: deleteErr } = await svc
    .from('instagram_connections')
    .delete()
    .eq('id', connectionId);

  if (deleteErr) {
    console.error('[instagram/delete] Erro ao excluir conexão:', deleteErr.message);
    return res.status(500).json({ error: 'Erro ao excluir conexão Instagram' });
  }

  return res.status(200).json({
    success: true,
    message: 'Conexão Instagram excluída com sucesso',
  });
}
