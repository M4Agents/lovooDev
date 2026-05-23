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
  let shortLivedToken, igUserId, grantedScopes;
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
    const entry      = Array.isArray(tokenData.data) ? tokenData.data[0] : tokenData;
    shortLivedToken  = entry.access_token;
    igUserId         = String(entry.user_id ?? '');
    grantedScopes    = (entry.permissions ?? '')
      .split(',').map(s => s.trim()).filter(Boolean);
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

  // ── 6. Trocar short-lived → long-lived token (60 dias) ────────────────────
  let longLivedToken, expiresIn;
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
    expiresIn      = llData.expires_in; // segundos
  } catch (err) {
    console.error('[instagram/callback] fetch long-lived token threw:', err?.message ?? err);
    return redirectError(res, 'meta_api_unavailable');
  }

  // ── 7. Buscar dados da conta Instagram ─────────────────────────────────────
  let username = igUserId, displayName = '';
  try {
    const meUrl = new URL('https://graph.instagram.com/me');
    meUrl.searchParams.set('fields',       'id,username,name');
    meUrl.searchParams.set('access_token', longLivedToken);

    const meRes  = await fetch(meUrl.toString());
    const meData = await meRes.json();

    if (!meData.error) {
      username    = meData.username ?? igUserId;
      displayName = meData.name     ?? '';
    }
  } catch {
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

  // ── 9. UPSERT instagram_connections ───────────────────────────────────────
  // ON CONFLICT (company_id, instagram_user_id): atualiza token e status.
  // Suporta reconexão de conta já existente (revogada ou expirada).
  const { data: connection, error: upsertErr } = await svc
    .from('instagram_connections')
    .upsert({
      company_id:         companyId,
      instagram_user_id:  igUserId,
      instagram_username: username,
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

  // ── 10. Criar configurações padrão da empresa (idempotente) ───────────────
  await svc
    .from('instagram_company_settings')
    .insert({ company_id: companyId })
    .onConflict('company_id')
    .ignoreDuplicates();

  // ── 11. Audit log ──────────────────────────────────────────────────────────
  await svc.from('instagram_audit_logs').insert({
    company_id:    companyId,
    connection_id: connection.id,
    action:        'connect_account',
    performed_by:  userId,
    metadata: {
      instagram_user_id:  igUserId,
      instagram_username: username,
      display_name:       displayName || undefined,
      scopes:             grantedScopes,
    },
  });

  return redirectSuccess(res, username);
}
