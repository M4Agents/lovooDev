// =============================================================================
// GET /api/nuvemshop/connect/callback
//
// Callback OAuth Nuvemshop — fluxo completo de conexão de loja.
//
// Fluxo:
//   1. Receber code + state da Nuvemshop
//   2. Verificar state JWT (anti-CSRF, TTL)
//   2.1 Verificar nonce single-use (previne replay de states válidos)
//   3. Re-validar membership do usuário no banco
//   4. Trocar code → access_token (POST authorize/token)
//   5. Buscar dados da loja (GET /store) — registra metadata_status
//   6. Criptografar token com AES-256-GCM
//   7. UPSERT nuvemshop_connections (com oauth_nonce e metadata_status)
//   8. Redirecionar frontend (sucesso ou erro)
//
// NÃO implementado nesta fase (deferred):
//   - Registro de webhooks (Fase 4)
//   - Registro de script de rastreamento (Fase 12)
//
// Segurança:
//   - State nunca aceito sem validação de assinatura HMAC
//   - Nonce single-use: armazenado no registro após uso, rejeita replay
//   - Membership re-validada após retorno do OAuth
//   - Token nunca retornado ao frontend (apenas criptografado no banco)
//   - metadata_status rastreia resultado do GET /store
//   - Erros genéricos para o frontend (não vazam detalhes internos)
// =============================================================================

import { getSupabaseAdmin }         from '../../lib/automation/supabaseAdmin.js';
import { verifyState }              from '../../lib/nuvemshop/nuvemshopState.js';
import { encryptNuvemshopToken }    from '../../lib/nuvemshop/tokenCrypto.js';
import { createNuvemshopClient }    from '../../lib/nuvemshop/nuvemshopClient.js';

const CONNECT_ROLES = ['super_admin', 'system_admin', 'admin', 'partner'];

const TOKEN_EXCHANGE_URL = 'https://www.nuvemshop.com.br/apps/authorize/token';

function redirectError(res, code) {
  const base   = (process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com').replace(/\/$/, '');
  const params = new URLSearchParams({
    tab:         'integracoes',
    integration: 'nuvemshop',
    nv_error:    code,
  });
  return res.redirect(`${base}/settings?${params.toString()}`);
}

function redirectSuccess(res, storeName) {
  const base   = (process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com').replace(/\/$/, '');
  const params = new URLSearchParams({
    tab:         'integracoes',
    integration: 'nuvemshop',
    connected:   '1',
    store:       storeName ?? '',
  });
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
    return redirectError(res, 'invalid_params');
  }

  // ── 1. Verificar state JWT ─────────────────────────────────────────────────
  let statePayload;
  try {
    statePayload = verifyState(state);
  } catch (err) {
    return redirectError(res, err.code ?? 'invalid_state');
  }

         const { user_id: userId, company_id: companyId, nonce } = statePayload;

         const svc = getSupabaseAdmin();

         // ── 2.1 Consumir nonce single-use (DELETE atômico) ───────────────────────
         // O nonce foi inserido em nuvemshop_oauth_states por initiate.js.
         // DELETE retorna 0 linhas se: (a) já foi consumido, (b) nunca existiu,
         // (c) expirou e foi limpo. Todos esses casos indicam state inválido.
         if (!nonce) {
           console.warn('[nuvemshop/callback] nonce_missing companyId=%s', companyId);
           return redirectError(res, 'invalid_state');
         }

         const { data: deletedNonce, error: nonceDeleteErr } = await svc
           .from('nuvemshop_oauth_states')
           .delete()
           .eq('nonce', nonce)
           .eq('company_id', companyId)
           .gt('expires_at', new Date().toISOString())  // rejeita nonces expirados
           .select('nonce');

         if (nonceDeleteErr || !deletedNonce?.length) {
           console.warn('[nuvemshop/callback] nonce_invalid_or_consumed companyId=%s nonce=%s',
             companyId, nonce?.slice(0, 8));
           return redirectError(res, 'state_already_used');
         }

  // ── 2. Re-validar membership ──────────────────────────────────────────────
  // Previne acesso caso a role do usuário tenha sido alterada durante o OAuth
  const { data: membership } = await svc
    .from('company_users')
    .select('role, is_active')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!membership || !membership.is_active || !CONNECT_ROLES.includes(membership.role)) {
    console.error('[nuvemshop/callback] membership_invalid userId=%s companyId=%s', userId, companyId);
    return redirectError(res, 'membership_revoked');
  }

  // ── 3. Validar empresa ativa ───────────────────────────────────────────────
  const { data: company } = await svc
    .from('companies')
    .select('status')
    .eq('id', companyId)
    .maybeSingle();

  if (!company || company.status !== 'active') {
    return redirectError(res, 'company_inactive');
  }

  const clientId     = process.env.NUVEMSHOP_CLIENT_ID;
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET;
  const redirectUri  = process.env.NUVEMSHOP_REDIRECT_URI
    ?? 'https://app.lovoocrm.com/api/nuvemshop/connect/callback';

  if (!clientId || !clientSecret) {
    console.error('[nuvemshop/callback] Credenciais de app não configuradas');
    return redirectError(res, 'configuration_error');
  }

  // ── 4. Trocar code → access_token ────────────────────────────────────────
  let accessToken, storeId;
  try {
    const tokenRes = await fetch(TOKEN_EXCHANGE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
        code,
      }).toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      console.error('[nuvemshop/callback] token_exchange_error status=%d body=%s',
        tokenRes.status, JSON.stringify(tokenData));
      return redirectError(res, 'token_exchange_failed');
    }

    // Resposta: { access_token, token_type, scope, user_id (= store_id) }
    accessToken = tokenData.access_token;
    storeId     = String(tokenData.user_id);

    if (!accessToken || !storeId) {
      console.error('[nuvemshop/callback] token_response_incomplete body=%s', JSON.stringify(tokenData));
      return redirectError(res, 'token_exchange_failed');
    }
  } catch (err) {
    console.error('[nuvemshop/callback] token_exchange_threw:', err?.message ?? err);
    return redirectError(res, 'nuvemshop_api_unavailable');
  }

         // ── 5. Buscar dados da loja (GET /store) ──────────────────────────────────
         // metadata_status rastreia o resultado: 'success', 'pending' ou 'failed'.
         // A conexão não falha se o fetch falhar — registramos como 'failed'.
         let storeName = null, storeDomain = null, currency = null, country = null;
         let planName  = null, storeWhatsapp = null;
         let metadataStatus = 'pending';

         try {
           const client    = createNuvemshopClient({ storeId, accessToken });
           const storeData = await client.get('store');

           storeName     = storeData.name             ?? null;
           storeDomain   = storeData.original_domain  ?? null;
           currency      = storeData.currency         ?? null;
           country       = storeData.country          ?? null;
           planName      = storeData.plan_name        ?? null;
           storeWhatsapp = storeData.whatsapp         ?? null;
           metadataStatus = 'success';

           console.log('[nuvemshop/callback] store_fetched storeId=%s name=%s domain=%s',
             storeId, storeName, storeDomain);
         } catch (err) {
           metadataStatus = 'failed';
           console.warn('[nuvemshop/callback] store_fetch_failed storeId=%s err=%s', storeId, err?.message);
         }

  // ── 6. Criptografar access token ──────────────────────────────────────────
  let accessTokenEnc;
  try {
    accessTokenEnc = encryptNuvemshopToken(accessToken);
  } catch (err) {
    console.error('[nuvemshop/callback] encrypt_failed:', err?.message);
    return redirectError(res, 'configuration_error');
  }

         // ── 7. UPSERT nuvemshop_connections ───────────────────────────────────────
         // onConflict: 'company_id,nuvemshop_store_id' — suporta reconexão da mesma loja.
         // O partial unique index (WHERE status='active') impede duas lojas ativas.
         // oauth_nonce é salvo para marcar o state como consumido (single-use).
         // metadata_status registra o resultado do GET /store.
         const { error: upsertErr } = await svc
           .from('nuvemshop_connections')
           .upsert(
               {
               company_id:         companyId,
               nuvemshop_store_id: storeId,
               store_name:         storeName,
               store_domain:       storeDomain,
               currency,
               country,
               plan_name:          planName,
               store_whatsapp:     storeWhatsapp,
               access_token_enc:   accessTokenEnc,
               encryption_version: 1,
               status:             'active',
               status_reason:      null,
               metadata_status:    metadataStatus,
               // Script desacoplado: instalação acontece no cron nuvemshop-install-scripts.
               // O callback apenas marca como 'pending' — sem chamada à Scripts API aqui.
               script_status:      'pending',
               connected_by:       userId,
               connected_at:       new Date().toISOString(),
               disconnected_by:    null,
               disconnected_at:    null,
               last_success_at:    new Date().toISOString(),
               updated_at:         new Date().toISOString(),
             },
             { onConflict: 'company_id,nuvemshop_store_id', ignoreDuplicates: false }
           );

  if (upsertErr) {
    // Código 23505: unique violation (outra loja já ativa — índice parcial)
    if (upsertErr.code === '23505') {
      console.warn('[nuvemshop/callback] active_connection_conflict companyId=%s', companyId);
      return redirectError(res, 'connection_already_active');
    }
    console.error('[nuvemshop/callback] upsert_failed companyId=%s err=%s',
      companyId, upsertErr.message);
    return redirectError(res, 'connection_save_failed');
  }

  console.log('[nuvemshop/callback] connected companyId=%s storeId=%s storeName=%s',
    companyId, storeId, storeName);
  // Script de rastreamento instalado pelo cron nuvemshop-install-scripts (script_status = 'pending').

  return redirectSuccess(res, storeName);
}
