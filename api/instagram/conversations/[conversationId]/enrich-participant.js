// =============================================================================
// POST /api/instagram/conversations/[conversationId]/enrich-participant
//
// Busca o perfil real do participante na Meta Graph API (nome, username, foto),
// faz upload da foto para Supabase Storage e atualiza instagram_conversations.
//
// Casos de uso:
//   - Conversa aberta no chat com participant_name === null
//   - Atualização manual de perfil do participante
//
// Segurança:
//   - JWT + membership + RBAC obrigatórios
//   - company_id resolvido via conversa no banco (nunca do frontend)
//   - Token nunca retornado ao frontend
// =============================================================================

import { getSupabaseAdmin }        from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { decryptInstagramToken }   from '../../../lib/instagram/tokenCrypto.js';
import { uploadAvatarToStorage }   from '../../../lib/instagram/uploadAvatarToStorage.js';

const GRAPH_API_VERSION = 'v21.0';
const ALLOWED_ROLES     = ['super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversationId } = req.query;

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // ── 1. Buscar conversa (resolve company_id e connection_id no backend) ──────
  const { data: conv, error: convErr } = await svc
    .from('instagram_conversations')
    .select('id, company_id, connection_id, ig_participant_id, participant_name, participant_username, participant_avatar')
    .eq('id', conversationId)
    .maybeSingle();

  if (convErr || !conv) {
    return res.status(404).json({ error: 'Conversa não encontrada' });
  }

  // ── 2. Validar caller ───────────────────────────────────────────────────────
  const auth = await validateInstagramCaller(req, svc, conv.company_id, ALLOWED_ROLES);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 3. Se já tem nome, retornar sem chamar a Meta ───────────────────────────
  if (conv.participant_name) {
    return res.status(200).json({
      participant_name:     conv.participant_name,
      participant_username: conv.participant_username,
      participant_avatar:   conv.participant_avatar,
    });
  }

  // ── 4. Buscar conexão e descriptografar token ───────────────────────────────
  const { data: connection, error: connErr } = await svc
    .from('instagram_connections')
    .select('id, access_token_enc, status')
    .eq('id', conv.connection_id)
    .maybeSingle();

  if (connErr || !connection) {
    return res.status(404).json({ error: 'Conexão Instagram não encontrada' });
  }

  if (connection.status !== 'active') {
    return res.status(422).json({ error: 'connection_inactive', message: 'Conta Instagram não está ativa' });
  }

  let accessToken;
  try {
    accessToken = decryptInstagramToken(connection.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'configuration_error', message: 'Erro ao processar token' });
  }

  // ── 5. Buscar perfil do participante na Graph API ───────────────────────────
  let profileData;
  try {
    const profileUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/${conv.ig_participant_id}`);
    profileUrl.searchParams.set('fields',       'name,username,profile_pic');
    profileUrl.searchParams.set('access_token', accessToken);

    const profileRes = await fetch(profileUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    profileData = await profileRes.json();

    // #region agent log
    console.log('[enrich-participant][H1,H2,H3,H4] meta response status:', profileRes.status, 'body:', JSON.stringify(profileData));
    // #endregion

    if (profileData.error) {
      // #region agent log
      return res.status(502).json({ error: 'meta_api_error', message: 'Erro ao buscar perfil no Instagram', _debug: { code: profileData.error?.code, type: profileData.error?.type, message: profileData.error?.message, fbtrace: profileData.error?.fbtrace_id } });
      // #endregion
    }
  } catch (err) {
    // #region agent log
    console.log('[enrich-participant][H5] fetch threw:', err?.message ?? err);
    // #endregion
    return res.status(502).json({ error: 'meta_api_unavailable', message: 'API do Instagram indisponível', _debug: { thrown: err?.message ?? String(err) } });
  }

  const name     = profileData.name     ?? null;
  const username = profileData.username ?? null;
  const picUrl   = profileData.profile_pic ?? null;

  // ── 6. Fazer upload da foto para storage permanente ─────────────────────────
  let avatarUrl = null;
  if (picUrl) {
    avatarUrl = await uploadAvatarToStorage(svc, {
      cdnUrl:    picUrl,
      companyId: conv.company_id,
      filename:  `ig_${conv.ig_participant_id}.jpg`,
    });
  }

  // ── 7. Atualizar conversa ───────────────────────────────────────────────────
  const { error: updateErr } = await svc
    .from('instagram_conversations')
    .update({
      participant_name:     name,
      participant_username: username,
      participant_avatar:   avatarUrl,
      updated_at:           new Date().toISOString(),
    })
    .eq('id', conversationId);

  if (updateErr) {
    console.error('[enrich-participant] update error:', updateErr.message);
    return res.status(500).json({ error: 'db_error', message: 'Erro ao salvar dados do participante' });
  }

  return res.status(200).json({
    participant_name:     name,
    participant_username: username,
    participant_avatar:   avatarUrl,
  });
}
