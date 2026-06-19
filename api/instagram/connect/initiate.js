// =============================================================================
// POST /api/instagram/connect/initiate
//
// Inicia o fluxo OAuth Meta para conectar uma conta Instagram Business.
//
// Responsabilidades:
//   - Validar JWT do usuário
//   - Validar que o usuário é admin+ da empresa informada
//   - Validar que a empresa está ativa
//   - Gerar state JWT assinado (anti-CSRF, expira em 10 minutos)
//   - Retornar URL de autorização OAuth da Meta
//
// Segurança:
//   - company_id vem do body mas é OBRIGATORIAMENTE validado contra company_users
//   - Nunca confiar no company_id sem verificação de membership
//   - manager/seller não podem conectar contas (CONNECT_ROLES)
//   - State é assinado com HMAC-SHA256 — nunca plaintext
// =============================================================================

import { getSupabaseAdmin }             from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller,
         CONNECT_ROLES }                from '../../lib/instagram/validateInstagramCaller.js';
import { signState }                    from '../../lib/instagram/instagramState.js';

// Scopes para MVP: DMs + comentários.
// instagram_business_content_publish removido intencionalmente:
//   não é necessário para mensagens/comentários e aumenta risco no App Review.
const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const appId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI
    ?? 'https://app.lovoocrm.com/api/instagram/connect/callback';

  // #region agent log — diagnóstico redirect_uri
  console.log('[instagram-oauth-debug] step=initiate initiateRedirectUri=%s envVarPresent=%s envVarLength=%d usingFallback=%s appIdPresent=%s',
    redirectUri,
    !!process.env.INSTAGRAM_REDIRECT_URI,
    process.env.INSTAGRAM_REDIRECT_URI?.length ?? 0,
    !process.env.INSTAGRAM_REDIRECT_URI,
    !!appId
  );
  // #endregion

  if (!appId || !process.env.INSTAGRAM_STATE_SECRET) {
    return res.status(500).json({ error: 'Integração Instagram não configurada' });
  }

  const { company_id: companyId } = req.body ?? {};
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // Validar JWT + RBAC (admin+ apenas para conectar contas)
  const auth = await validateInstagramCaller(req, svc, companyId, { roles: CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // Validar que a empresa está ativa
  const { data: company } = await svc
    .from('companies')
    .select('id, status')
    .eq('id', companyId)
    .maybeSingle();

  if (!company) {
    return res.status(404).json({ error: 'Empresa não encontrada' });
  }
  if (company.status !== 'active') {
    return res.status(403).json({ error: 'Empresa inativa — não é possível conectar conta' });
  }

  // Gerar state JWT anti-CSRF (10 minutos de validade)
  const state = signState({ user_id: auth.userId, company_id: companyId });

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         IG_SCOPES,
    state,
  });

  const authUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`;

  // #region agent log — diagnóstico authUrl
  console.log('[instagram-oauth-debug] step=initiate-authurl appIdValue=%s appIdLength=%d redirectUriInUrl=%s scopesSent=%s',
    appId,
    appId?.length ?? 0,
    redirectUri,
    IG_SCOPES
  );
  // #endregion

  return res.status(200).json({ authUrl });
}
