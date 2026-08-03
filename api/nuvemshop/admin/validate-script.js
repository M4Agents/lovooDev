// =============================================================================
// POST /api/nuvemshop/admin/validate-script
//
// Verifica se o script de rastreamento ainda está ativo na loja Nuvemshop.
//
// Body: { company_id }
//
// RBAC: ALLOWED_ROLES (manager+).
//
// Retorna: { valid, script_id, where, event } — nunca retorna o token.
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

  const { data: conn } = await svc
    .from('nuvemshop_connections')
    .select('id, nuvemshop_store_id, access_token_enc, encryption_version, script_id, script_status, status')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (!conn) return res.status(404).json({ error: 'Nenhuma conexão ativa encontrada' });

  if (!conn.script_id) {
    return res.status(200).json({
      valid:         false,
      script_id:     null,
      script_status: conn.script_status ?? null,
      message:       'Nenhum script_id cadastrado. Instalação pode estar pendente.',
    });
  }

  let accessToken;
  try {
    accessToken = decrypt(conn.access_token_enc, conn.encryption_version);
  } catch {
    return res.status(500).json({ valid: false, error: 'Falha ao descriptografar token' });
  }

  const client = createNuvemshopClient({
    storeId:       conn.nuvemshop_store_id,
    accessToken,
    correlationId: requestId,
  });

  try {
    const script = await client.get(`/scripts/${conn.script_id}`);
    const valid  = !!script?.id;

    console.log(JSON.stringify({
      event: 'validate_script_result', company_id: companyId,
      script_id: conn.script_id, valid, validated_by: auth.userId, request_id: requestId,
    }));

    if (!valid) {
      return res.status(200).json({ valid: false, script_id: conn.script_id, message: 'Script não encontrado na loja' });
    }

    return res.status(200).json({
      valid:         true,
      script_id:     script.id,
      where:         script.where  ?? null,
      event_trigger: script.event  ?? null,
      src:           undefined, // nunca retornar a URL do script ao frontend
    });
  } catch (err) {
    if (err?.status === 404) {
      return res.status(200).json({
        valid:     false,
        script_id: conn.script_id,
        message:   'Script não encontrado na loja (404). Pode ser necessário reinstalar.',
      });
    }

    return res.status(200).json({
      valid:   false,
      error:   'Não foi possível contatar a API da Nuvemshop. Tente novamente.',
    });
  }
}
