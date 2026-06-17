// =============================================================================
// POST /api/instagram/connect/token
//
// Conexão Instagram via token manual — alternativa temporária ao OAuth.
// Usado enquanto o aplicativo Meta aguarda aprovação.
//
// Fluxo:
//   1. Validar JWT + RBAC (validateInstagramCaller com CONNECT_ROLES)
//   2. Validar empresa ativa
//   3. Validar variáveis de ambiente obrigatórias
//   4. Validar token via /debug_token (is_valid, app_id, scopes, expires_at)
//   5. Buscar dados do perfil via /me (id, username, user_id, profile_picture_url)
//   6. Criptografar token com AES-256-GCM
//   7. Fazer upload do avatar (best-effort, nunca bloqueia)
//   8. Subscrever webhooks via subscribed_apps (soft-fail → status = 'limited')
//   9. UPSERT instagram_connections (mesma chave do OAuth)
//  10. UPSERT instagram_company_settings (idempotente)
//  11. Inserir instagram_audit_logs (sem dados sensíveis)
//  12. Retornar { success, status, username, webhook_subscribed, ... }
//
// Segurança:
//   - raw_token nunca logado, nunca retornado, nunca no audit log
//   - Erros da Meta mascarados para não vazar token ou query params
//   - Autorização idêntica ao callback.js (CONNECT_ROLES via validateInstagramCaller)
//   - company_id sempre validado contra banco — nunca confiado do frontend
// =============================================================================

import { getSupabaseAdmin }          from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller,
         CONNECT_ROLES }             from '../../lib/instagram/validateInstagramCaller.js';
import { encryptInstagramToken }     from '../../lib/instagram/tokenCrypto.js';
import { uploadAvatarToStorage }     from '../../lib/instagram/uploadAvatarToStorage.js';

const GRAPH_API_VERSION = 'v21.0';

const REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Validar body ────────────────────────────────────────────────────────
  const { company_id: companyId, raw_token: rawToken } = req.body ?? {};

  if (!companyId || !rawToken) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes: company_id, raw_token' });
  }

  const svc = getSupabaseAdmin();

  // ── 2. Validar JWT + RBAC via helper consolidado ───────────────────────────
  // Usa exatamente a mesma lógica do callback.js: CONNECT_ROLES, Trilha 1 e 2,
  // validação de partner_company_assignments, is_active obrigatório.
  const auth = await validateInstagramCaller(req, svc, companyId, { roles: CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }
  const { userId } = auth;

  // ── 3. Validar empresa ativa ───────────────────────────────────────────────
  const { data: company } = await svc
    .from('companies')
    .select('status')
    .eq('id', companyId)
    .maybeSingle();

  if (!company || company.status !== 'active') {
    return res.status(422).json({ error: 'company_inactive' });
  }

  // ── 4. Validar variáveis de ambiente ───────────────────────────────────────
  const appId     = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  if (!appId || !appSecret) {
    return res.status(500).json({ error: 'configuration_error' });
  }

  // ── 5. Validar token via /debug_token ──────────────────────────────────────
  // Valida: is_valid, app_id, scopes obrigatórios, expires_at
  let grantedScopes   = [];
  let tokenExpiresAt  = null;

  try {
    const debugUrl = new URL('https://graph.facebook.com/debug_token');
    debugUrl.searchParams.set('input_token',  rawToken);
    debugUrl.searchParams.set('access_token', `${appId}|${appSecret}`);

    const debugRes  = await fetch(debugUrl.toString());
    const debugData = await debugRes.json();

    if (!debugRes.ok || !debugData.data) {
      // Mascarar detalhes que possam conter o token ou query params sensíveis
      console.error('[instagram/token] debug_token error companyId=%s', companyId);
      return res.status(422).json({ error: 'token_invalid' });
    }

    const { is_valid, app_id, scopes, expires_at } = debugData.data;

    if (!is_valid) {
      return res.status(422).json({ error: 'token_invalid' });
    }

    if (String(app_id) !== String(appId)) {
      return res.status(422).json({ error: 'token_wrong_app' });
    }

    // Scopes retornados pelo debug_token (array de strings)
    grantedScopes = Array.isArray(scopes) ? scopes.map(s => String(s).trim()).filter(Boolean) : [];

    const missingScopes = REQUIRED_SCOPES.filter(s => !grantedScopes.includes(s));
    if (missingScopes.length > 0) {
      return res.status(422).json({ error: 'missing_scopes', missing_scopes: missingScopes });
    }

    // expires_at é Unix timestamp em segundos (mesmo padrão do manual.js)
    if (expires_at) {
      tokenExpiresAt = new Date(expires_at * 1000).toISOString();
    }
  } catch (err) {
    console.error('[instagram/token] debug_token threw companyId=%s message=%s', companyId, err?.message ?? 'unknown');
    return res.status(502).json({ error: 'meta_api_unavailable' });
  }

  // ── 6. Buscar dados do perfil via /me ─────────────────────────────────────
  // Segue exatamente o mesmo padrão do callback.js (linhas 180–198):
  //   meData.id       → IGUID (instagram_user_id)
  //   meData.user_id  → IGBID (ig_webhook_id, o ID que a Meta usa nos webhooks)
  //   Fallback: igWebhookId = igUserId quando user_id ausente
  let igUserId          = '';
  let igWebhookId       = '';
  let username          = '';
  let profilePictureUrl = null;

  try {
    const meUrl = new URL('https://graph.instagram.com/me');
    meUrl.searchParams.set('fields',       'id,username,name,profile_picture_url,user_id');
    meUrl.searchParams.set('access_token', rawToken);

    const meRes  = await fetch(meUrl.toString());
    const meData = await meRes.json();

    if (!meRes.ok || meData.error) {
      // Mascarar: não incluir detalhes do erro que possam conter o token
      console.error('[instagram/token] /me error companyId=%s', companyId);
      return res.status(502).json({ error: 'meta_api_error' });
    }

    igUserId    = String(meData.id ?? '');
    igWebhookId = igUserId; // fallback: IGUID caso IGBID ausente

    if (meData.username)            username          = meData.username;
    if (meData.profile_picture_url) profilePictureUrl = meData.profile_picture_url;
    if (meData.user_id)             igWebhookId       = String(meData.user_id);
  } catch (err) {
    console.error('[instagram/token] /me threw companyId=%s message=%s', companyId, err?.message ?? 'unknown');
    return res.status(502).json({ error: 'meta_api_unavailable' });
  }

  if (!igUserId) {
    return res.status(422).json({ error: 'token_invalid' });
  }

  // Username fallback para o IGUID caso /me não retorne
  if (!username) username = igUserId;

  // ── 7. Criptografar token ──────────────────────────────────────────────────
  let accessTokenEnc;
  try {
    accessTokenEnc = encryptInstagramToken(rawToken);
  } catch {
    return res.status(500).json({ error: 'encryption_failed' });
  }

  // ── 8. Upload do avatar (best-effort, nunca bloqueia a conexão) ───────────
  if (profilePictureUrl && companyId) {
    const permanentUrl = await uploadAvatarToStorage(svc, {
      cdnUrl:    profilePictureUrl,
      companyId: companyId,
      filename:  `ig_account_${igUserId}.jpg`,
    });
    if (permanentUrl) profilePictureUrl = permanentUrl;
  }

  // ── 9. Subscrever webhooks via subscribed_apps (soft-fail) ────────────────
  // Se falhar por scope ou permissão: status = 'limited', nunca rejeita a conexão.
  // Mesma lógica e mesmos campos do callback.js.
  let subscribeOk = false;
  let subscribeErrorDetail = null;

  try {
    const subscribeUrl =
      `https://graph.instagram.com/${GRAPH_API_VERSION}/${igUserId}/subscribed_apps` +
      `?subscribed_fields=messages,comments,message_reactions` +
      `&access_token=${rawToken}`;

    const subscribeRes  = await fetch(subscribeUrl, { method: 'POST' });
    const subscribeData = await subscribeRes.json();
    subscribeOk = subscribeRes.ok && subscribeData.success === true;

    if (!subscribeOk) {
      subscribeErrorDetail = subscribeData.error?.message ?? 'subscription_failed';
      console.warn('[instagram/token] subscribed_apps falhou igUserId=%s companyId=%s',
        igUserId, companyId);
    }
  } catch (err) {
    console.warn('[instagram/token] subscribed_apps threw companyId=%s message=%s',
      companyId, err?.message ?? 'unknown');
  }

  const connectionStatus = subscribeOk ? 'active' : 'limited';

  // ── 10. UPSERT instagram_connections ──────────────────────────────────────
  // Mesma chave de conflito do callback.js: (company_id, instagram_user_id).
  // Suporta reconexão de conta já existente (revogada ou expirada).
  // ig_webhook_id = null quando IGBID === IGUID (mesmo padrão do callback.js linha 232).
  const { data: connection, error: upsertErr } = await svc
    .from('instagram_connections')
    .upsert({
      company_id:          companyId,
      instagram_user_id:   igUserId,
      ig_webhook_id:       igWebhookId !== igUserId ? igWebhookId : null,
      instagram_username:  username,
      profile_picture_url: profilePictureUrl,
      access_token_enc:    accessTokenEnc,
      encryption_version:  1,
      token_expires_at:    tokenExpiresAt,
      scopes:              grantedScopes,
      status:              connectionStatus,
      status_reason:       subscribeOk ? null : 'webhook_subscription_failed',
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
    console.error('[instagram/token] upsert error companyId=%s detail=%s',
      companyId, upsertErr?.message ?? 'unknown');
    return res.status(500).json({ error: 'connection_save_failed' });
  }

  // ── 11. UPSERT instagram_company_settings (idempotente) ───────────────────
  await svc
    .from('instagram_company_settings')
    .upsert({ company_id: companyId }, { onConflict: 'company_id', ignoreDuplicates: true });

  // ── 12. Audit log (sem raw_token, sem dados sensíveis) ────────────────────
  await svc.from('instagram_audit_logs').insert({
    company_id:    companyId,
    connection_id: connection.id,
    action:        'connect_account_token',
    performed_by:  userId,
    metadata: {
      instagram_user_id:   igUserId,
      ig_webhook_id:       igWebhookId !== igUserId ? igWebhookId : null,
      instagram_username:  username,
      scopes:              grantedScopes,
      subscribed_apps_ok:  subscribeOk,
      webhook_error:       subscribeErrorDetail ?? undefined,
      source:              'token_endpoint',
    },
  });

  // ── 13. Resposta ───────────────────────────────────────────────────────────
  const response = {
    success:            true,
    status:             connectionStatus,
    username:           username,
    webhook_subscribed: subscribeOk,
    missing_scopes:     [],
  };

  if (!subscribeOk) {
    response.warning =
      'Conta conectada. O recebimento de mensagens pode não funcionar — ' +
      'verifique se o token possui as permissões de webhook necessárias.';
  }

  return res.status(200).json(response);
}
