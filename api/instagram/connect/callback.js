// =============================================================================
// GET /api/instagram/connect/callback
//
// Callback OAuth Meta — substitui o stub anterior.
//
// Fluxo completo:
//   1. Receber code + state da Meta
//   2. Verificar state JWT (anti-CSRF)
//   3. Re-validar membership do usuário no banco
//   4. Trocar code → short-lived token (POST api.instagram.com)
//   5. Trocar short-lived → long-lived token (GET graph.instagram.com)
//   6. Buscar dados da conta Instagram (/me)
//   7. Criptografar token com AES-256-GCM
//   8. UPSERT instagram_connections (suporta reconexão)
//   9. Criar instagram_company_settings se inexistente
//  10. Registrar audit log
//  11. Redirecionar frontend (sucesso ou erro)
//
// Segurança:
//   - State nunca é aceito sem validação de assinatura
//   - Membership re-validada: previne acesso após remoção durante OAuth
//   - Token nunca retornado ao frontend (apenas criptografado no banco)
//   - Erros tipados para redirect sem vazar detalhes internos
// =============================================================================

import { getSupabaseAdmin }      from '../../lib/automation/supabaseAdmin.js';
import { verifyState }           from '../../lib/instagram/instagramState.js';
import { encryptInstagramToken } from '../../lib/instagram/tokenCrypto.js';
import { uploadAvatarToStorage } from '../../lib/instagram/uploadAvatarToStorage.js';

const CONNECT_ROLES = ['super_admin', 'system_admin', 'admin', 'partner'];

function redirectError(res, code) {
  const base   = (process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com').replace(/\/$/, '');
  const params = new URLSearchParams({ tab: 'integracoes', integration: 'instagram', ig_error: code });
  return res.redirect(`${base}/settings?${params.toString()}`);
}

function redirectSuccess(res, username) {
  const base   = (process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com').replace(/\/$/, '');
  const params = new URLSearchParams({ tab: 'integracoes', integration: 'instagram', connected: '1', account: username });
  return res.redirect(`${base}/settings?${params.toString()}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error: oauthError } = req.query;

  // Usuário negou a autorização
  if (oauthError) {
    return redirectError(res, 'user_denied');
  }

  if (!code || !state) {
    return redirectError(res, 'invalid_state');
  }

  // ── 1. Verificar state JWT ──────────────────────────────────────────────────
  let statePayload;
  try {
    statePayload = verifyState(state);
  } catch (err) {
    return redirectError(res, err.code ?? 'invalid_state');
  }

  const { user_id: userId, company_id: companyId } = statePayload;

  const svc = getSupabaseAdmin();

  // ── 2. Re-validar membership (previne acesso após remoção durante OAuth) ──
  const { data: membership } = await svc
    .from('company_users')
    .select('role, is_active')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!membership || !membership.is_active || !CONNECT_ROLES.includes(membership.role)) {
    console.error('[instagram/callback] membership_revoked userId=%s companyId=%s membership=%o', userId, companyId, membership);
    return redirectError(res, 'membership_revoked');
  }

  // ── 3. Validar empresa ainda ativa ─────────────────────────────────────────
  const { data: company } = await svc
    .from('companies')
    .select('status')
    .eq('id', companyId)
    .maybeSingle();

  if (!company || company.status !== 'active') {
    return redirectError(res, 'company_inactive');
  }

  const appId      = process.env.INSTAGRAM_APP_ID;
  const appSecret  = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI
    ?? 'https://app.lovoocrm.com/api/instagram/connect/callback';

  // #region agent log — diagnóstico redirect_uri
  const _fallback = 'https://app.lovoocrm.com/api/instagram/connect/callback';
  console.log('[instagram-oauth-debug] step=callback callbackRedirectUri=%s envVarPresent=%s envVarLength=%d usingFallback=%s appIdPresent=%s appSecretPresent=%s areRedirectUrisEqual=%s',
    redirectUri,
    !!process.env.INSTAGRAM_REDIRECT_URI,
    process.env.INSTAGRAM_REDIRECT_URI?.length ?? 0,
    !process.env.INSTAGRAM_REDIRECT_URI,
    !!appId,
    !!appSecret,
    redirectUri === _fallback
  );
  // #endregion

  if (!appId || !appSecret) {
    return redirectError(res, 'configuration_error');
  }

  // ── 4. Trocar code → short-lived token ─────────────────────────────────────
  // #region agent log — diagnóstico token exchange
  console.log('[instagram-oauth-debug] step=token-exchange appIdValue=%s appIdLength=%d appSecretLength=%d redirectUriSent=%s codeLength=%d codePrefix=%s',
    appId,
    appId?.length ?? 0,
    appSecret?.length ?? 0,
    redirectUri,
    code?.length ?? 0,
    code?.slice(0, 6) ?? 'none'
  );
  // #endregion

  let shortLivedToken, igUserId, grantedScopes, shortLivedExpiresIn;
  try {
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:    appId,
        client_secret: appSecret,
        grant_type:   'authorization_code',
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error_type || tokenData.error) {
      console.error('[instagram/callback] short-lived token exchange error:', JSON.stringify(tokenData));
      return redirectError(res, 'token_exchange_failed');
    }

    // Business Login retorna { data: [{ access_token, user_id, permissions }] }
    // ou diretamente { access_token, user_id, permissions }
    // permissions pode ser array ["scope1","scope2"] OU string "scope1,scope2"
    const entry         = Array.isArray(tokenData.data) ? tokenData.data[0] : tokenData;
    shortLivedToken     = entry.access_token;
    igUserId            = String(entry.user_id ?? '');
    shortLivedExpiresIn = entry.expires_in ?? tokenData.expires_in ?? null;

    const rawPerms = entry.permissions ?? [];
    grantedScopes  = Array.isArray(rawPerms)
      ? rawPerms.map((s) => String(s).trim()).filter(Boolean)
      : String(rawPerms).split(',').map((s) => s.trim()).filter(Boolean);

    // #region agent log
    console.log('[debug:449c25] short-lived-token-data rawKeys=%s expiresIn=%s tokenType=%s shortLivedTokenPresent=%s len=%d',
      Object.keys(tokenData).join(','),
      shortLivedExpiresIn ?? 'undefined',
      entry.token_type ?? tokenData.token_type ?? 'undefined',
      !!shortLivedToken, shortLivedToken?.length ?? 0);
    // #endregion
  } catch (err) {
    console.error('[instagram/callback] fetch short-lived token threw:', err?.message ?? err);
    return redirectError(res, 'meta_api_unavailable');
  }

  if (!shortLivedToken || !igUserId) {
    return redirectError(res, 'token_exchange_failed');
  }

  // ── 5. Verificar scopes mínimos concedidos ─────────────────────────────────
  if (!grantedScopes.includes('instagram_business_basic')) {
    return redirectError(res, 'missing_scopes');
  }

  // ── 6. Determinar token de longa duração ──────────────────────────────────
  // Business Login (instagram_business_basic) emite tokens sem expires_in —
  // o token retornado pelo OAuth já é válido por 60 dias (long-lived por padrão).
  // Fluxo legado com expires_in: tenta ig_exchange_token (compatibilidade futura).
  let longLivedToken, expiresIn;

  const oauthTokenHasExpiresIn = shortLivedExpiresIn != null;

  // #region agent log
  console.log('[debug:449c25] step6-decision oauthTokenHasExpiresIn=%s shortLivedExpiresIn=%s',
    oauthTokenHasExpiresIn, shortLivedExpiresIn ?? 'null');
  // #endregion

  if (oauthTokenHasExpiresIn) {
    // ── Fluxo legado (Basic Display API): tentar ig_exchange_token ──────────
    try {
      const llUrl = new URL('https://graph.instagram.com/access_token');
      llUrl.searchParams.set('grant_type',    'ig_exchange_token');
      llUrl.searchParams.set('client_secret', appSecret);
      llUrl.searchParams.set('access_token',  shortLivedToken);

      // #region agent log
      console.log('[debug:449c25] legacy-exchange-request endpoint=graph.instagram.com/access_token grant=ig_exchange_token');
      // #endregion

      const llRes  = await fetch(llUrl.toString());
      const llData = await llRes.json();

      // #region agent log
      console.log('[debug:449c25] legacy-exchange-response status=%d ok=%s error_code=%s hasAccessToken=%s expiresIn=%s',
        llRes.status, llRes.ok, llData?.error?.code ?? 'none', !!llData?.access_token, llData?.expires_in ?? 'undefined');
      // #endregion

      if (!llRes.ok || llData.error) {
        console.error('[instagram/callback] long-lived token exchange error:', JSON.stringify(llData));
        return redirectError(res, 'token_exchange_failed');
      }

      longLivedToken = llData.access_token;
      expiresIn      = llData.expires_in;
    } catch (err) {
      console.error('[instagram/callback] fetch long-lived token threw:', err?.message ?? err);
      return redirectError(res, 'meta_api_unavailable');
    }
  } else {
    // ── Business Login: token já é válido diretamente (60 dias) ─────────────
    longLivedToken = shortLivedToken;
    expiresIn      = 60 * 24 * 60 * 60; // 60 dias em segundos

    const computedExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // #region agent log
    console.log('[debug:449c25] usingDirectBusinessLoginToken=true tokenExpiresAt=%s', computedExpiresAt);
    // #endregion
  }

  // ── 7. Buscar dados da conta Instagram via Facebook Graph API ─────────────
  // Business Login tokens são tokens Facebook — o IGBID (usado nos webhooks
  // como entry.id) é obtido via graph.facebook.com/v21.0/me com o campo
  // instagram_business_account, não via graph.instagram.com (Basic Display).
  let username = igUserId, displayName = '', profilePictureUrl = null;
  let igWebhookId = igUserId; // fallback: mesmo ID caso IGBID não venha
  try {
    const meUrl = new URL('https://graph.facebook.com/v21.0/me');
    meUrl.searchParams.set('fields', 'instagram_business_account{id,username,name,profile_picture_url}');
    meUrl.searchParams.set('access_token', longLivedToken);

    // #region agent log
    console.log('[debug:449c25] me-request endpoint=graph.facebook.com/v21.0/me fields=instagram_business_account{id,username,name,profile_picture_url}');
    // #endregion

    const meRes  = await fetch(meUrl.toString());
    const meData = await meRes.json();

    // #region agent log
    console.log('[debug:449c25] me-response status=%d ok=%s rawKeys=%s error_code=%s error_type=%s error_message=%s hasIgAccount=%s',
      meRes.status, meRes.ok,
      Object.keys(meData).join(','),
      meData?.error?.code    ?? 'none',
      meData?.error?.type    ?? 'none',
      meData?.error?.message ?? 'none',
      !!(meData?.instagram_business_account));
    // #endregion

    const igAccount = meData?.instagram_business_account ?? null;
    if (!meData.error && igAccount) {
      username          = igAccount.username            ?? igUserId;
      displayName       = igAccount.name                ?? '';
      profilePictureUrl = igAccount.profile_picture_url ?? null;
      // IGBID: ID da conta Business no Instagram — é o entry.id dos webhooks
      if (igAccount.id) {
        igUserId    = String(igAccount.id);
        igWebhookId = String(igAccount.id);
      }

      // #region agent log
      console.log('[debug:449c25] me-extracted username=%s hasDisplayName=%s hasProfilePicture=%s igUserId=%s igWebhookId=%s',
        username, !!displayName, !!profilePictureUrl, igUserId, igWebhookId);
      // #endregion
    }
  } catch (meErr) {
    // #region agent log
    console.log('[debug:449c25] me-exception message=%s', meErr?.message ?? 'unknown');
    // #endregion
    // Não-fatal: continua com igUserId como fallback de username
  }

  // ── 8. Criptografar token ──────────────────────────────────────────────────
  let accessTokenEnc;
  try {
    accessTokenEnc = encryptInstagramToken(longLivedToken);
  } catch {
    return redirectError(res, 'configuration_error');
  }

  const tokenExpiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  // ── 8b. Fazer upload da foto para storage permanente ───────────────────────
  // Fallback para URL temporária caso o upload falhe (não deve bloquear o OAuth)
  if (profilePictureUrl && companyId) {
    const permanentUrl = await uploadAvatarToStorage(svc, {
      cdnUrl:    profilePictureUrl,
      companyId: companyId,
      filename:  `ig_account_${igUserId}.jpg`,
    });
    if (permanentUrl) profilePictureUrl = permanentUrl;
  }

  // ── 9. UPSERT instagram_connections ───────────────────────────────────────
  // ON CONFLICT (company_id, instagram_user_id): atualiza token e status.
  // Suporta reconexão de conta já existente (revogada ou expirada).
  const { data: connection, error: upsertErr } = await svc
    .from('instagram_connections')
    .upsert({
      company_id:         companyId,
      instagram_user_id:  igUserId,
      ig_webhook_id:      igWebhookId !== igUserId ? igWebhookId : null,
      instagram_username: username,
      profile_picture_url: profilePictureUrl,
      access_token_enc:   accessTokenEnc,
      encryption_version: 1,
      token_expires_at:   tokenExpiresAt,
      scopes:             grantedScopes,
      status:             'active',
      status_reason:      null,
      connected_by:       userId,
      disconnected_by:    null,
      updated_at:         new Date().toISOString(),
    }, {
      onConflict:       'company_id,instagram_user_id',
      ignoreDuplicates: false,
    })
    .select('id')
    .single();

  if (upsertErr || !connection) {
    return redirectError(res, 'connection_save_failed');
  }

  // ── 10. Subscrever conta ao webhook Meta ───────────────────────────────────
  // Obrigatório para que a Meta envie eventos (DMs, comentários, reações) para
  // o nosso endpoint. Sem esta chamada a conta existe no banco mas a Meta não
  // entrega webhooks para ela.
  let subscribeOk = false;
  try {
    const subscribeUrl =
      `https://graph.instagram.com/v21.0/${igUserId}/subscribed_apps` +
      `?subscribed_fields=messages,comments,message_reactions` +
      `&access_token=${longLivedToken}`;

    const subscribeRes  = await fetch(subscribeUrl, { method: 'POST' });
    const subscribeData = await subscribeRes.json();
    subscribeOk = subscribeRes.ok && subscribeData.success === true;

    if (!subscribeOk) {
      console.warn('[instagram/callback] subscribed_apps falhou igUserId=%s body=%s',
        igUserId, JSON.stringify(subscribeData));
    }
  } catch (err) {
    console.warn('[instagram/callback] subscribed_apps threw:', err?.message);
  }

  // ── 11. Criar configurações padrão da empresa (idempotente) ───────────────
  await svc
    .from('instagram_company_settings')
    .upsert({ company_id: companyId }, { onConflict: 'company_id', ignoreDuplicates: true });

  // ── 12. Audit log ──────────────────────────────────────────────────────────
  await svc.from('instagram_audit_logs').insert({
    company_id:    companyId,
    connection_id: connection.id,
    action:        'connect_account',
    performed_by:  userId,
    metadata: {
      instagram_user_id:  igUserId,
      ig_webhook_id:      igWebhookId,
      instagram_username: username,
      display_name:       displayName || undefined,
      scopes:             grantedScopes,
      subscribed_apps_ok: subscribeOk,
    },
  });

  return redirectSuccess(res, username);
}
