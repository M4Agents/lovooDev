// =============================================================================
// POST /api/nuvemshop/admin/validate-connection
//
// Valida se o token de acesso atual ainda é válido fazendo uma chamada
// real para GET /store na API da Nuvemshop.
//
// Body: { company_id }
//
// RBAC: ALLOWED_ROLES (manager+).
//
// Retorna: { valid, store_name, store_domain } — nunca retorna o token.
// =============================================================================

import { getSupabaseAdmin }          from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller,
         ALLOWED_ROLES }             from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import { decrypt }                   from '../../lib/nuvemshop/tokenCrypto.js';
import { createNuvemshopClient }     from '../../lib/nuvemshop/nuvemshopClient.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { company_id: companyId } = req.body ?? {};
  if (!companyId) return res.status(400).json({ error: 'company_id é obrigatório' });

  const requestId = `req_${Date.now()}`;
  const svc       = getSupabaseAdmin();

  const auth = await validateNuvemshopCaller(req, svc, companyId, { roles: ALLOWED_ROLES });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // ── Buscar conexão ativa com token criptografado ──────────────────────────
  const { data: conn, error: connErr } = await svc
    .from('nuvemshop_connections')
    .select('id, nuvemshop_store_id, access_token_enc, encryption_version, status')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (connErr || !conn) {
    return res.status(404).json({ error: 'Nenhuma conexão ativa encontrada' });
  }

  // ── Descriptografar token ─────────────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decrypt(conn.access_token_enc, conn.encryption_version);
  } catch {
    return res.status(500).json({
      valid:   false,
      error:   'Falha ao descriptografar token — reconectar a integração.',
    });
  }

  // ── Testar token chamando GET /store ──────────────────────────────────────
  const client = createNuvemshopClient({
    storeId:     conn.nuvemshop_store_id,
    accessToken,
    correlationId: requestId,
  });

  try {
    const storeData = await client.get('/store');
    const valid = !!storeData?.id;

    console.log(JSON.stringify({
      event:      'validate_connection_result',
      company_id: companyId,
      valid,
      validated_by: auth.userId,
      role:         auth.role,
      request_id:   requestId,
    }));

    if (!valid) {
      return res.status(200).json({ valid: false, error: 'Token inválido ou loja inacessível' });
    }

    return res.status(200).json({
      valid:        true,
      store_name:   storeData.name?.pt ?? storeData.name ?? null,
      store_domain: storeData.url      ?? null,
    });
  } catch (err) {
    const isUnauthorized = err?.status === 401 || err?.statusCode === 401;

    console.warn(JSON.stringify({
      event:      'validate_connection_failed',
      company_id: companyId,
      status:     err?.status,
      request_id: requestId,
    }));

    if (isUnauthorized) {
      return res.status(200).json({
        valid:  false,
        error:  'Token expirado ou revogado — reconectar a integração.',
      });
    }

    return res.status(200).json({
      valid:  false,
      error:  'Não foi possível contatar a API da Nuvemshop. Tente novamente.',
    });
  }
}
