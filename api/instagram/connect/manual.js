// =============================================================================
// POST /api/instagram/connect/manual
//
// ENDPOINT TEMPORÁRIO — remover após validação do fluxo de webhook.
//
// Permite que um super_admin insira manualmente um token Instagram
// gerado via painel da Meta ("Gerar token"), sem passar pelo OAuth.
//
// Uso: conectar a conta própria da plataforma para testes de webhook.
//
// Segurança:
//   - Restrito exclusivamente a super_admin
//   - Re-valida membership no banco (nunca confia só no JWT)
//   - Token nunca retornado, apenas criptografado e persistido
//   - raw_token ausente de todos os logs
// =============================================================================

import { getSupabaseAdmin }      from '../../lib/automation/supabaseAdmin.js';
import { encryptInstagramToken } from '../../lib/instagram/tokenCrypto.js';

const ALLOWED_ROLES = ['super_admin'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Autenticar via JWT ──────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? '';
  const jwt        = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!jwt) {
    return res.status(401).json({ error: 'Missing authorization' });
  }

  const svc = getSupabaseAdmin();

  const { data: { user }, error: authErr } = await svc.auth.getUser(jwt);

  if (authErr || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // ── 2. Validar body ────────────────────────────────────────────────────────
  const {
    raw_token,
    company_id,
    ig_user_id,
    ig_username,
  } = req.body ?? {};

  if (!raw_token || !company_id || !ig_user_id || !ig_username) {
    return res.status(400).json({
      error: 'Missing required fields: raw_token, company_id, ig_user_id, ig_username',
    });
  }

  // ── 3. Verificar que o caller é super_admin na empresa informada ───────────
  const { data: membership } = await svc
    .from('company_users')
    .select('role, is_active')
    .eq('user_id', user.id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!membership || !membership.is_active || !ALLOWED_ROLES.includes(membership.role)) {
    return res.status(403).json({ error: 'Forbidden: super_admin required' });
  }

  // ── 4. Validar token junto à Meta (GET /me) ────────────────────────────────
  let validatedUserId, validatedUsername;
  try {
    const meUrl = new URL('https://graph.instagram.com/me');
    meUrl.searchParams.set('fields',       'id,username,name');
    meUrl.searchParams.set('access_token', raw_token);

    const meRes  = await fetch(meUrl.toString());
    const meData = await meRes.json();

    if (!meRes.ok || meData.error) {
      const reason = meData.error?.message ?? 'token validation failed';
      return res.status(422).json({ error: `Meta rejected token: ${reason}` });
    }

    validatedUserId  = String(meData.id ?? '');
    validatedUsername = meData.username ?? ig_username;
  } catch (err) {
    return res.status(502).json({ error: 'Meta API unavailable' });
  }

  // Garantir que o ig_user_id informado bate com o token
  if (validatedUserId && validatedUserId !== String(ig_user_id)) {
    return res.status(422).json({
      error: `Token mismatch: token belongs to ${validatedUserId}, not ${ig_user_id}`,
    });
  }

  // ── 5. Verificar expiração via debug_token ─────────────────────────────────
  let tokenExpiresAt = null;
  try {
    const appId     = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;

    if (appId && appSecret) {
      const debugUrl = new URL('https://graph.facebook.com/debug_token');
      debugUrl.searchParams.set('input_token',  raw_token);
      debugUrl.searchParams.set('access_token', `${appId}|${appSecret}`);

      const debugRes  = await fetch(debugUrl.toString());
      const debugData = await debugRes.json();

      if (debugRes.ok && debugData.data?.expires_at) {
        tokenExpiresAt = new Date(debugData.data.expires_at * 1000).toISOString();
      }
    }
  } catch {
    // Não-fatal: expiry ficará null
  }

  // ── 6. Criptografar token ──────────────────────────────────────────────────
  let accessTokenEnc;
  try {
    accessTokenEnc = encryptInstagramToken(raw_token);
  } catch {
    return res.status(500).json({ error: 'Encryption failed: check INSTAGRAM_TOKEN_ENC_KEY_V1' });
  }

  // ── 7. UPSERT instagram_connections ───────────────────────────────────────
  const { data: connection, error: upsertErr } = await svc
    .from('instagram_connections')
    .upsert({
      company_id:         company_id,
      instagram_user_id:  String(ig_user_id),
      instagram_username: validatedUsername,
      access_token_enc:   accessTokenEnc,
      encryption_version: 1,
      token_expires_at:   tokenExpiresAt,
      scopes:             [
        'instagram_business_basic',
        'instagram_business_manage_messages',
        'instagram_business_manage_comments',
      ],
      status:          'active',
      status_reason:   null,
      connected_by:    user.id,
      disconnected_by: null,
      updated_at:      new Date().toISOString(),
    }, {
      onConflict:       'company_id,instagram_user_id',
      ignoreDuplicates: false,
    })
    .select('id, instagram_username, status, token_expires_at')
    .single();

  if (upsertErr || !connection) {
    return res.status(500).json({ error: 'Failed to save connection', detail: upsertErr?.message });
  }

  // ── 8. Criar configurações padrão (idempotente) ───────────────────────────
  await svc
    .from('instagram_company_settings')
    .insert({ company_id })
    .onConflict('company_id')
    .ignoreDuplicates();

  // ── 9. Audit log ──────────────────────────────────────────────────────────
  await svc.from('instagram_audit_logs').insert({
    company_id:    company_id,
    connection_id: connection.id,
    action:        'connect_account_manual',
    performed_by:  user.id,
    metadata: {
      instagram_user_id:  String(ig_user_id),
      instagram_username: validatedUsername,
      source:             'manual_endpoint',
    },
  });

  return res.status(200).json({
    success:           true,
    connection_id:     connection.id,
    instagram_username: connection.instagram_username,
    status:            connection.status,
    token_expires_at:  connection.token_expires_at,
  });
}
