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

  if (!appId || !appSecret) {
    return redirectError(res, 'configuration_error');
  }

  // ── 4. Trocar code → short-lived token ─────────────────────────────────────
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

  if (oauthTokenHasExpiresIn) {
    // ── Fluxo legado (Basic Display API): tentar ig_exchange_token ──────────
    try {
      const llUrl = new URL('https://graph.instagram.com/access_token');
      llUrl.searchParams.set('grant_type',    'ig_exchange_token');
      llUrl.searchParams.set('client_secret', appSecret);
      llUrl.searchParams.set('access_token',  shortLivedToken);

      const llRes  = await fetch(llUrl.toString());
      const llData = await llRes.json();

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
  }

  // ── 7. Buscar dados da conta Instagram ────────────────────────────────────
  // Estratégia de dois endpoints (tokens Facebook vs. tokens Instagram):
  //
  // A) graph.instagram.com/me — para Instagram User Access Tokens (maioria dos casos).
  //    Retorna: id (IGBID), username, name, profile_picture_url, user_id (legado).
  //
  // B) graph.facebook.com/me + instagram_business_account — para contas page-backed
  //    que retornam um Facebook User Access Token no OAuth.
  //    Ocorre quando: conta Instagram está vinculada a uma Página Facebook de modo que
  //    o Meta OAuth emite um token Facebook ao invés de Instagram.
  //    Sintoma: graph.instagram.com/me falha com code 100 "Unsupported request - method type: get".
  const oauthIgUserId = igUserId; // preserva o user_id original do OAuth antes do /me
  let username = igUserId, displayName = '', profilePictureUrl = null;
  let igWebhookId = igUserId; // fallback: mesmo ID caso /me falhe
  let meSource = 'none';
  try {
    const meUrl = new URL('https://graph.instagram.com/me');
    meUrl.searchParams.set('fields', 'id,username,name,profile_picture_url,user_id');
    meUrl.searchParams.set('access_token', longLivedToken);

    const meRes  = await fetch(meUrl.toString());
    const meData = await meRes.json();

    if (!meData.error) {
      meSource          = 'instagram';
      username          = meData.username            ?? igUserId;
      displayName       = meData.name                ?? '';
      profilePictureUrl = meData.profile_picture_url ?? null;
      if (meData.id)      igUserId    = String(meData.id);
      if (meData.user_id) igWebhookId = String(meData.user_id);
    } else if (meData.error?.code === 100) {
      // Fallback: token Facebook — tentar graph.facebook.com/me + instagram_business_account
      try {
        const fbMeUrl = new URL('https://graph.facebook.com/me');
        fbMeUrl.searchParams.set(
          'fields',
          'id,instagram_business_account{id,username,name,profile_picture_url}'
        );
        fbMeUrl.searchParams.set('access_token', longLivedToken);

        const fbMeRes  = await fetch(fbMeUrl.toString());
        const fbMeData = await fbMeRes.json();

        if (!fbMeData.error && fbMeData.instagram_business_account) {
          const igAcc   = fbMeData.instagram_business_account;
          meSource          = 'facebook';
          igUserId          = String(igAcc.id);
          igWebhookId       = String(igAcc.id); // IGBID da conta Business
          username          = igAcc.username            ?? igUserId;
          displayName       = igAcc.name                ?? '';
          profilePictureUrl = igAcc.profile_picture_url ?? null;

          // #region agent log
          console.log('[debug:449c25] fb-me-fallback fbUserId=%s igAccId=%s username=%s hasPhoto=%s',
            fbMeData.id ?? 'none', igAcc.id, igAcc.username ?? 'none', !!igAcc.profile_picture_url);
          // #endregion
        } else {
          // #region agent log
          console.log('[debug:449c25] fb-me-fallback-failed fbError=%s hasIgAcc=%s',
            fbMeData.error ? JSON.stringify(fbMeData.error) : 'none',
            !!fbMeData.instagram_business_account);
          // #endregion
          console.error('[instagram/callback] fb-me fallback falhou:', JSON.stringify(fbMeData));
        }
      } catch (fbErr) {
        console.error('[instagram/callback] fb-me fallback threw:', fbErr?.message ?? fbErr);
      }
    }

    // #region agent log
    console.log('[debug:449c25] me-fields meSource=%s igId=%s igUserId=%s igWebhookId=%s username=%s hasPhoto=%s meError=%s',
      meSource, meData?.id ?? 'none', igUserId, igWebhookId, username,
      !!profilePictureUrl, meData?.error ? JSON.stringify(meData.error) : 'none');
    // #endregion
    console.log('[instagram/callback] me status=%d meSource=%s igId=%s username=%s hasPhoto=%s userId=%s',
      meRes.status, meSource, meData?.id ?? 'none', username,
      !!profilePictureUrl, meData?.user_id ?? 'none');
  } catch (meErr) {
    console.error('[instagram/callback] me-exception:', meErr?.message ?? meErr);
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

  // ── 9. Subscrever conta ao webhook Meta (antes do UPSERT para saber o effectiveWebhookId) ──
  // Estratégia com fallback:
  //   - Alguns accounts: meData.user_id é o ID funcional para subscribed_apps.
  //   - Outros: meData.user_id não suporta POST; meData.id funciona.
  // Tentamos igWebhookId primeiro; se falhar, tentamos igUserId.

  // Remover subscrição stale pelo igUserId (se igWebhookId for diferente)
  if (igWebhookId && igWebhookId !== igUserId) {
    try {
      await fetch(
        `https://graph.instagram.com/v21.0/${igUserId}/subscribed_apps?access_token=${longLivedToken}`,
        { method: 'DELETE' }
      );
    } catch (_e) { /* não-fatal */ }
  }

  let subscribeOk = false;
  let effectiveWebhookId = igWebhookId; // ID que funcionou para subscribed_apps

  // Quando meSource='facebook', igUserId = igWebhookId = IGBID da conta Business.
  // Quando meSource='instagram', igWebhookId pode ser meData.user_id (ID alternativo).
  // Em ambos os casos, candidateIds tem os IDs a tentar em ordem.
  const candidateIds = (igWebhookId && igWebhookId !== igUserId)
    ? [igWebhookId, igUserId]   // tenta user_id (meData.user_id) primeiro, depois id (meData.id)
    : [igUserId];               // apenas um candidato

  for (const candidateId of candidateIds) {
    try {
      const subscribeUrl =
        `https://graph.instagram.com/v21.0/${candidateId}/subscribed_apps` +
        `?subscribed_fields=messages,comments,message_reactions` +
        `&access_token=${longLivedToken}`;

      const subscribeRes  = await fetch(subscribeUrl, { method: 'POST' });
      const subscribeData = await subscribeRes.json();

      // #region agent log
      console.log('[debug:449c25] subscribed_apps-attempt candidateId=%s ok=%s body=%s',
        candidateId, subscribeRes.ok && subscribeData.success === true, JSON.stringify(subscribeData));
      // #endregion

      if (subscribeRes.ok && subscribeData.success === true) {
        subscribeOk = true;
        effectiveWebhookId = candidateId;
        break;
      }

      console.warn('[instagram/callback] subscribed_apps falhou subscribeAccountId=%s body=%s',
        candidateId, JSON.stringify(subscribeData));
    } catch (err) {
      console.warn('[instagram/callback] subscribed_apps threw candidateId=%s:', candidateId, err?.message);
    }
  }

  // ── 10. UPSERT instagram_connections ──────────────────────────────────────
  // ON CONFLICT (company_id, instagram_user_id): atualiza token e status.
  // Suporta reconexão de conta já existente (revogada ou expirada).
  // ig_webhook_id = effectiveWebhookId: ID confirmado pelo subscribed_apps (ou melhor candidato).
  const { data: connection, error: upsertErr } = await svc
    .from('instagram_connections')
    .upsert({
      company_id:         companyId,
      instagram_user_id:  igUserId,
      ig_webhook_id:      effectiveWebhookId !== igUserId ? effectiveWebhookId : null,
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
      ig_webhook_id:      effectiveWebhookId,
      instagram_username: username,
      display_name:       displayName || undefined,
      scopes:             grantedScopes,
      subscribed_apps_ok: subscribeOk,
    },
  });

  return redirectSuccess(res, username);
}
