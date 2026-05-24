// =============================================================================
// POST /api/instagram/connections/:connectionId/sync-photo
//
// Atualiza a foto de perfil de uma conexão Instagram usando o token salvo.
//
// Casos de uso:
//   - Após o token ser renovado
//   - Quando a URL da foto expirou
//   - Ação manual do usuário via botão "Atualizar foto"
//
// Segurança:
//   - Requer JWT válido + membership ativo + role com permissão de conexão
//   - A conexão deve pertencer à empresa do caller
//   - Token nunca retornado ao frontend
//   - Em caso de token expirado: erro tipado sem vazar detalhes internos
// =============================================================================

import { getSupabaseAdmin }       from '../../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../../lib/instagram/validateInstagramCaller.js';
import { decryptInstagramToken }  from '../../../lib/instagram/tokenCrypto.js';
import { uploadAvatarToStorage }  from '../../../lib/instagram/uploadAvatarToStorage.js';

const CONNECT_ROLES = ['super_admin', 'system_admin', 'admin'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { connectionId } = req.query;

  if (!connectionId) {
    return res.status(400).json({ error: 'connectionId é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // ── 1. Buscar conexão e company_id ─────────────────────────────────────────
  const { data: conn, error: fetchErr } = await svc
    .from('instagram_connections')
    .select('id, company_id, access_token_enc, status')
    .eq('id', connectionId)
    .maybeSingle();

  if (fetchErr || !conn) {
    return res.status(404).json({ error: 'Conexão não encontrada' });
  }

  // ── 2. Validar caller (JWT + membership + role) ────────────────────────────
  const auth = await validateInstagramCaller(req, svc, conn.company_id, CONNECT_ROLES);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  if (conn.status !== 'active') {
    return res.status(422).json({ error: 'token_expired', message: 'Token expirado. Reconecte a conta para atualizar a foto.' });
  }

  // ── 3. Descriptografar token ───────────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decryptInstagramToken(conn.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'configuration_error', message: 'Erro ao processar token' });
  }

  // ── 4. Buscar foto na Meta ─────────────────────────────────────────────────
  let profilePictureUrl;
  try {
    const meUrl = new URL('https://graph.instagram.com/me');
    meUrl.searchParams.set('fields',       'profile_picture_url');
    meUrl.searchParams.set('access_token', accessToken);

    const meRes  = await fetch(meUrl.toString());
    const meData = await meRes.json();

    if (meData.error) {
      const isTokenError =
        meData.error.type === 'OAuthException' ||
        meData.error.code === 190;

      if (isTokenError) {
        // Marca conexão como error no banco
        await svc
          .from('instagram_connections')
          .update({ status: 'error', status_reason: 'token_expired', updated_at: new Date().toISOString() })
          .eq('id', connectionId);

        return res.status(422).json({ error: 'token_expired', message: 'Token expirado. Reconecte a conta para atualizar a foto.' });
      }

      return res.status(502).json({ error: 'meta_api_error', message: 'Erro ao buscar foto no Instagram' });
    }

    profilePictureUrl = meData.profile_picture_url ?? null;
  } catch (err) {
    console.error('[sync-photo] fetch Meta threw:', err?.message ?? err);
    return res.status(502).json({ error: 'meta_api_unavailable', message: 'API do Instagram indisponível. Tente novamente.' });
  }

  if (!profilePictureUrl) {
    return res.status(200).json({ profile_picture_url: null, message: 'Foto não disponível nesta conta' });
  }

  // ── 5. Fazer upload para storage permanente ────────────────────────────────
  const permanentUrl = await uploadAvatarToStorage(svc, {
    cdnUrl:    profilePictureUrl,
    companyId: conn.company_id,
    filename:  `ig_account_${connectionId}.jpg`,
  });
  const finalUrl = permanentUrl ?? profilePictureUrl;

  // ── 6. Salvar URL atualizada no banco ──────────────────────────────────────
  const { error: updateErr } = await svc
    .from('instagram_connections')
    .update({
      profile_picture_url: finalUrl,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', connectionId);

  if (updateErr) {
    console.error('[sync-photo] update error:', updateErr.message);
    return res.status(500).json({ error: 'db_error', message: 'Erro ao salvar foto' });
  }

  return res.status(200).json({ profile_picture_url: finalUrl });
}
