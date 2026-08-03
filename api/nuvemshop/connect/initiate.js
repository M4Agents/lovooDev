// =============================================================================
// POST /api/nuvemshop/connect/initiate
//
// Inicia o fluxo OAuth Nuvemshop para conectar uma loja.
//
// Responsabilidades:
//   - Validar JWT do usuário autenticado
//   - Validar role (CONNECT_ROLES — admin+)
//   - Validar empresa ativa
//   - Verificar se já existe conexão ativa (impede reconexão dupla sem desconectar antes)
//   - Gerar state JWT assinado anti-CSRF (TTL 10 minutos)
//   - Retornar URL de autorização Nuvemshop
//
// Segurança:
//   - company_id vem do body mas é validado contra company_users (nunca assumido)
//   - State assinado com HMAC-SHA256 — nunca plaintext
//   - manager/seller não podem conectar lojas (CONNECT_ROLES)
//   - Nenhum dado sensível retornado
// =============================================================================

import { randomBytes }                from 'crypto';
import { getSupabaseAdmin }           from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller,
         CONNECT_ROLES }              from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import { signState }                  from '../../lib/nuvemshop/nuvemshopState.js';

// URL de autorização OAuth Nuvemshop (Brasil)
// Argentina: https://www.tiendanube.com/apps/{client_id}/authorize
const OAUTH_BASE_URL = 'https://www.nuvemshop.com.br/apps';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId   = process.env.NUVEMSHOP_CLIENT_ID;
  const stateSecret = process.env.NUVEMSHOP_STATE_SECRET;

  if (!clientId || !stateSecret) {
    console.error('[nuvemshop/initiate] Variáveis de ambiente não configuradas');
    return res.status(500).json({ error: 'Integração Nuvemshop não configurada' });
  }

  const { company_id: companyId } = req.body ?? {};
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  const svc = getSupabaseAdmin();

  // ── Validar JWT + RBAC ─────────────────────────────────────────────────────
  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── Validar empresa ativa ─────────────────────────────────────────────────
  const { data: company } = await svc
    .from('companies')
    .select('id, status')
    .eq('id', companyId)
    .maybeSingle();

  if (!company) {
    return res.status(404).json({ error: 'Empresa não encontrada' });
  }
  if (company.status !== 'active') {
    return res.status(403).json({ error: 'Empresa inativa — não é possível conectar' });
  }

  // ── Verificar conexão ativa existente ─────────────────────────────────────
  // O partial unique index impede duas lojas ativas por empresa.
  // Informamos o usuário antes de iniciar o OAuth para melhor UX.
  const { data: existingActive } = await svc
    .from('nuvemshop_connections')
    .select('store_name, nuvemshop_store_id')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (existingActive) {
    return res.status(409).json({
      error:      'Já existe uma loja Nuvemshop conectada para esta empresa.',
      store_name: existingActive.store_name ?? existingActive.nuvemshop_store_id,
      hint:       'Desconecte a loja atual antes de conectar uma nova.',
    });
  }

         // ── Gerar e persistir nonce single-use ───────────────────────────────────
         // O nonce é armazenado em nuvemshop_oauth_states ANTES do redirect.
         // callback.js faz DELETE atômico — garante single-use inclusive na 1ª conexão.
         // Limpar nonces expirados desta empresa antes de inserir (manutenção inline).
         const STATE_TTL_MS  = 10 * 60 * 1000; // 10 minutos
         const nonce         = randomBytes(16).toString('hex');
         const nonceExpiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

         // Limpeza global de nonces expirados (não apenas desta empresa).
         // Executada em best-effort antes de inserir o novo nonce.
         await svc
           .from('nuvemshop_oauth_states')
           .delete()
           .lt('expires_at', new Date().toISOString());

         const { error: nonceErr } = await svc
           .from('nuvemshop_oauth_states')
           .insert({
             nonce,
             company_id: companyId,
             user_id:    auth.userId,
             expires_at: nonceExpiresAt,
           });

         if (nonceErr) {
           console.error('[nuvemshop/initiate] nonce_insert_failed companyId=%s err=%s',
             companyId, nonceErr.message);
           return res.status(500).json({ error: 'Erro ao iniciar o processo de autorização' });
         }

         // ── Gerar state JWT anti-CSRF (inclui nonce) ──────────────────────────────
         const state = signState({ user_id: auth.userId, company_id: companyId, nonce }, STATE_TTL_MS);

  // ── Construir URL de autorização ─────────────────────────────────────────
  const redirectUri = process.env.NUVEMSHOP_REDIRECT_URI
    ?? 'https://app.lovoocrm.com/api/nuvemshop/connect/callback';

  const params = new URLSearchParams({
    redirect_uri:  redirectUri,
    response_type: 'code',
    state,
  });

  const authUrl = `${OAUTH_BASE_URL}/${clientId}/authorize?${params.toString()}`;

  return res.status(200).json({ authUrl });
}
