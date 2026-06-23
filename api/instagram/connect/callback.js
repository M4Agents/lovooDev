// =============================================================================
// GET /api/instagram/connect/callback
//
// Callback OAuth Meta — fluxo completo de conexão de conta Instagram Business.
//
// Fluxo:
//   1. Receber code + state da Meta
//   2. Verificar state JWT (anti-CSRF)
//   3. Re-validar membership do usuário no banco
//   4. Trocar code → short-lived token (POST api.instagram.com)
//   5. Trocar short-lived → long-lived token quando necessário
//   6. Buscar dados da conta Instagram (/me)
//   7. Criptografar token com AES-256-GCM
//   8. Subscrever ao webhook Meta (antes do UPSERT para determinar effectiveWebhookId)
//   9. UPSERT instagram_connections (suporta reconexão)
//  10. Criar instagram_company_settings se inexistente
//  11. Registrar audit log
//  12. Redirecionar frontend (sucesso ou erro)
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

  // ── 2. Re-validar membership ────────────────────────────────────────────────
  const { data: membership } = await svc
    .from('company_users')
    .select('role, is_active')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!membership || !membership.is_active || !CONNECT_ROLES.includes(membership.role)) {
    console.error('[instagram/callback] membership_revoked userId=%s companyId=%s', userId, companyId);
    return redirectError(res, 'membership_revoked');
  }

  // ── 3. Validar empresa ativa ────────────────────────────────────────────────
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
        client_id:     appId,
        client_secret: appSecret,
        grant_type:    'authorization_code',
        redirect_uri:  redirectUri,
        code,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error_type || tokenData.error) {
      console.error('[instagram/callback] short-lived token exchange error:', JSON.stringify(tokenData));
      return redirectError(res, 'token_exchange_failed');
    }

    // Business Login retorna { access_token, user_id, permissions }
    // ou { data: [{ access_token, user_id, permissions }] }
    // Para formatos onde data[] não contém access_token, usamos tokenData.access_token (root).
    const dataIsArray   = Array.isArray(tokenData.data);
    const entry         = dataIsArray ? tokenData.data[0] : tokenData;
    const entryToken    = entry.access_token ?? null;
    const rootToken     = tokenData.access_token ?? null;
    shortLivedToken     = entryToken ?? rootToken;
    igUserId            = String(entry.user_id ?? tokenData.user_id ?? '');
    shortLivedExpiresIn = entry.expires_in ?? tokenData.expires_in ?? null;

    const rawPerms = entry.permissions ?? tokenData.permissions ?? [];
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

  // ── 5. Verificar scopes mínimos ────────────────────────────────────────────
  if (!grantedScopes.includes('instagram_business_basic')) {
    return redirectError(res, 'missing_scopes');
  }

  // ── 6. Determinar token de longa duração ──────────────────────────────────
  // Formatos de token da Business Login API:
  //
  // A) Prefixo "EAA..." → token já long-lived (60 dias), sem troca necessária.
  //    Emitido para contas Business/Creator vinculadas a uma Página Facebook.
  //
  // B) Prefixo "IGAAT..." → novo formato (2024+), requer troca via ig_exchange_token.
  //    Emitido quando a conta ainda não tem vinculação de Página Facebook adequada.
  //    Se a troca falhar, a conta não é compatível com o Graph API → erro claro ao usuário.
  //
  // C) Fluxo legado Basic Display API: tem expires_in → troca obrigatória.
  let longLivedToken, expiresIn;

  const tokenNeedsExchange = shortLivedExpiresIn != null || shortLivedToken.startsWith('IGAAT');

  if (tokenNeedsExchange) {
    let exchangeOk = false;

    // Tentativa 1: POST ig_exchange_token
    try {
      const llRes = await fetch('https://graph.instagram.com/access_token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          grant_type:    'ig_exchange_token',
          client_secret: appSecret,
          access_token:  shortLivedToken,
        }).toString(),
      });
      const llData = await llRes.json();

      if (llRes.ok && !llData.error && llData.access_token) {
        longLivedToken = llData.access_token;
        expiresIn      = llData.expires_in ?? (60 * 24 * 60 * 60);
        exchangeOk     = true;
      } else {
        console.warn('[instagram/callback] ll-exchange POST falhou:', JSON.stringify(llData));
      }
    } catch (err) {
      console.error('[instagram/callback] fetch ll-exchange POST threw:', err?.message ?? err);
    }

    // Tentativa 2: GET ig_exchange_token (forma legada)
    if (!exchangeOk) {
      try {
        const llUrl = new URL('https://graph.instagram.com/access_token');
        llUrl.searchParams.set('grant_type',    'ig_exchange_token');
        llUrl.searchParams.set('client_secret', appSecret);
        llUrl.searchParams.set('access_token',  shortLivedToken);

        const llRes  = await fetch(llUrl.toString());
        const llData = await llRes.json();

        if (llRes.ok && !llData.error && llData.access_token) {
          longLivedToken = llData.access_token;
          expiresIn      = llData.expires_in ?? (60 * 24 * 60 * 60);
          exchangeOk     = true;
        } else {
          console.warn('[instagram/callback] ll-exchange GET falhou:', JSON.stringify(llData));
        }
      } catch (err) {
        console.error('[instagram/callback] fetch ll-exchange GET threw:', err?.message ?? err);
      }
    }

    if (!exchangeOk) {
      if (shortLivedExpiresIn != null) {
        console.error('[instagram/callback] ll-exchange falhou para token com expires_in — abortando');
        return redirectError(res, 'token_exchange_failed');
      }
      // Token IGAAT sem troca possível: conta não vinculada a Página do Facebook.
      // Sem a Página, o token não é compatível com o Graph API (recebimento de DMs etc.).
      console.error('[instagram/callback] token IGAAT sem exchange válido — conta não vinculada a Página Facebook');
      return redirectError(res, 'account_not_page_backed');
    }
  } else {
    // Token EAA Business Login: já é long-lived (60 dias).
    longLivedToken = shortLivedToken;
    expiresIn      = 60 * 24 * 60 * 60;
  }

  // ── 7. Buscar dados da conta Instagram ────────────────────────────────────
  // Estratégia de dois endpoints:
  //
  // A) graph.instagram.com/me — funciona para tokens Instagram (EAA).
  //    Retorna: id (IGBID), username, name, profile_picture_url, user_id (legado).
  //
  // B) graph.facebook.com/me + instagram_business_account — fallback para tokens
  //    Facebook emitidos em fluxos page-backed alternativos.
  const oauthIgUserId = igUserId;
  let username = igUserId, displayName = '', profilePictureUrl = null;
  let igWebhookId = igUserId;
  try {
    const meUrl = new URL('https://graph.instagram.com/me');
    meUrl.searchParams.set('fields', 'id,username,name,profile_picture_url,user_id');
    meUrl.searchParams.set('access_token', longLivedToken);

    const meRes  = await fetch(meUrl.toString());
    const meData = await meRes.json();

    if (!meData.error) {
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
          igUserId          = String(igAcc.id);
          igWebhookId       = String(igAcc.id);
          username          = igAcc.username            ?? igUserId;
          displayName       = igAcc.name                ?? '';
          profilePictureUrl = igAcc.profile_picture_url ?? null;
        } else {
          console.error('[instagram/callback] fb-me fallback falhou:', JSON.stringify(fbMeData));
        }
      } catch (fbErr) {
        console.error('[instagram/callback] fb-me fallback threw:', fbErr?.message ?? fbErr);
      }
    }

    console.log('[instagram/callback] me status=%d igId=%s username=%s hasPhoto=%s',
      meRes.status, igUserId, username, !!profilePictureUrl);
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

  // ── 8b. Upload da foto para storage permanente ────────────────────────────
  if (profilePictureUrl && companyId) {
    const permanentUrl = await uploadAvatarToStorage(svc, {
      cdnUrl:    profilePictureUrl,
      companyId: companyId,
      filename:  `ig_account_${igUserId}.jpg`,
    });
    if (permanentUrl) profilePictureUrl = permanentUrl;
  }

  // ── 9. Subscrever ao webhook Meta ─────────────────────────────────────────
  // effectiveWebhookId: ID confirmado que funcionou para subscribed_apps.
  // Tentamos igWebhookId (meData.user_id) primeiro; se falhar, igUserId (meData.id).
  // O ID que funcionar é salvo como ig_webhook_id e usado para envio de mensagens.

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
  let effectiveWebhookId = igWebhookId;

  const candidateIds = (igWebhookId && igWebhookId !== igUserId)
    ? [igWebhookId, igUserId]
    : [igUserId];

  for (const candidateId of candidateIds) {
    try {
      const subscribeUrl =
        `https://graph.instagram.com/v21.0/${candidateId}/subscribed_apps` +
        `?subscribed_fields=messages,comments,message_reactions` +
        `&access_token=${longLivedToken}`;

      const subscribeRes  = await fetch(subscribeUrl, { method: 'POST' });
      const subscribeData = await subscribeRes.json();

      if (subscribeRes.ok && subscribeData.success === true) {
        subscribeOk        = true;
        effectiveWebhookId = candidateId;
        break;
      }

      console.warn('[instagram/callback] subscribed_apps falhou candidateId=%s body=%s',
        candidateId, JSON.stringify(subscribeData));
    } catch (err) {
      console.warn('[instagram/callback] subscribed_apps threw candidateId=%s:', candidateId, err?.message);
    }
  }

  // ── 10. UPSERT instagram_connections ──────────────────────────────────────
  const { data: connection, error: upsertErr } = await svc
    .from('instagram_connections')
    .upsert({
      company_id:          companyId,
      instagram_user_id:   igUserId,
      ig_webhook_id:       effectiveWebhookId !== igUserId ? effectiveWebhookId : null,
      instagram_username:  username,
      profile_picture_url: profilePictureUrl,
      access_token_enc:    accessTokenEnc,
      encryption_version:  1,
      token_expires_at:    tokenExpiresAt,
      scopes:              grantedScopes,
      status:              'active',
      status_reason:       null,
      connected_by:        userId,
      disconnected_by:     null,
      updated_at:          new Date().toISOString(),
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
