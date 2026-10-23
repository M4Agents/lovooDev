// =============================================================================
// POST /api/whatsapp/meta/instances/reconnect
//
// Reativa uma instância Meta WhatsApp Cloud API com a credencial persistida
// (MVP5.A5.3.2 — caminho 1 + OCC por updated_at).
//
// Semântica:
//   Reconectar no Lovoo NÃO chama Embedded Signup e NÃO substitui credencial.
//   Só promove status → 'connected' após prova Graph da WABA + phone_number_id.
//   token_revoked e error exigem reautorização (caminho 2) — não tentados aqui.
//   Requisição antiga NÃO pode reverter disconnect posterior já persistido.
//
// Fluxo (ordem obrigatória):
//   1.  Method guard (POST only)
//   2.  Extração de body (company_id, instance_id — campos proibidos ignorados)
//   3.  getSupabaseAdmin()
//   4.  validateMetaCaller() — auth + RBAC + feature flag (META_CONNECT_ROLES)
//   5.  Validação de instance_id (somente após auth)
//   6.  Lookup (id + auth.companyId + deleted_at IS NULL)
//       Campos: id, status, phone_number_id, waba_id, updated_at
//   7.  Máquina de estados (error/token_revoked/inesperado → 409 sem Graph)
//   8.  Snapshot cru de updated_at — sem Date() nem arredondamento
//   9.  Lookup de credencial (instance.id já autorizado)
//  10. decryptMetaToken — falha → credential_unavailable, sem Graph
//  11. listWabaPhoneNumbers(token, waba_id persistido)
//  12. Exigir phone_number_id persistido na lista (match exato)
//  13. connected  → reler; se ainda connected e identidade igual → 200
//                   se disconnected/alterado → 409, ZERO UPDATE
//      disconnected → UPDATE condicional status='connected' + OCC
//  14. 0 linhas → reload no mesmo tenant; connected+identidade → 200
//                 disconnected → 409 (nunca reativa)
//  15. Resposta pública { ok, instance_id, status: 'connected' }
//
// OCC (updated_at):
//   trg_mwi_updated_at chama update_updated_at_column() em TODO UPDATE.
//   NOW() é o início da transação HTTP. Graph dura ms–s; o snapshot anterior
//   não coincide com o NOW() de um disconnect posterior.
//
// Graph (listWabaPhoneNumbers):
//   HTTP não-2xx é um único código (graph_waba_inaccessible). Não distingue
//   401, 403 e 429. Mapeamento conservador: 502 provider_error — NÃO afirma
//   revogação e NÃO altera status. Timeout/rede → 503 provider_unavailable.
//
// Segurança:
//   - company_id do body não autoriza. Lookup e UPDATE usam auth.companyId.
//   - Cross-tenant / deleted → 404 opaco.
//   - Token e ciphertext nunca na resposta nem em log.
//   - Zero alteração de credencial, WABA, número, deleted_at ou instance_id.
//   - Zero canal legado. Zero registro automático de número.
// =============================================================================

import { getSupabaseAdmin }                       from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_CONNECT_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken }                       from '../../../lib/meta-whatsapp/tokenCrypto.js';
import { listWabaPhoneNumbers }                   from '../../../lib/meta-whatsapp/graphClient.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function connectedBody(instanceId) {
  return {
    ok:          true,
    instance_id: instanceId,
    status:      'connected',
  };
}

/**
 * Classifica o status persistido antes de qualquer Graph.
 * @param {string} status
 * @returns {{ kind: 'eligible' | 'reauth' | 'conflict' }}
 */
export function classifyReconnectState(status) {
  if (status === 'disconnected' || status === 'connected') {
    return { kind: 'eligible' };
  }
  if (status === 'error' || status === 'token_revoked') {
    return { kind: 'reauth' };
  }
  return { kind: 'conflict' };
}

/**
 * Mapeia err.code de listWabaPhoneNumbers para HTTP público.
 * graph_waba_inaccessible cobre 401/403/429 — sem distinção segura.
 * @param {unknown} err
 * @returns {{ status: number, error: string }}
 */
export function mapGraphReconnectError(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  if (code === 'graph_timeout' || code === 'graph_network_error') {
    return { status: 503, error: 'provider_unavailable' };
  }
  return { status: 502, error: 'provider_error' };
}

function lookupInstance(svc, instanceId, companyId) {
  return svc
    .from('meta_whatsapp_instances')
    .select('id, status, phone_number_id, waba_id, updated_at')
    .eq('id', instanceId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();
}

function identityMatches(row, snapshot) {
  return Boolean(
    row
    && row.phone_number_id === snapshot.phone_number_id
    && row.waba_id === snapshot.waba_id,
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    company_id:  companyId,
    instance_id: instanceId,
  } = req.body ?? {};

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  try {

  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  if (!instanceId || !UUID_RE.test(instanceId)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const { data: instance, error: instErr } = await lookupInstance(svc, instanceId, auth.companyId);

  if (instErr) {
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!instance) {
    return res.status(404).json({ error: 'instance_not_found' });
  }

  const classified = classifyReconnectState(instance.status);
  if (classified.kind === 'reauth') {
    return res.status(409).json({ error: 'credential_reauth_required' });
  }
  if (classified.kind === 'conflict') {
    return res.status(409).json({ error: 'instance_state_conflict' });
  }

  if (typeof instance.phone_number_id !== 'string' || !instance.phone_number_id
      || typeof instance.waba_id !== 'string' || !instance.waba_id
      || typeof instance.updated_at !== 'string' || !instance.updated_at) {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Valor cru do PostgREST — nunca Date() / toISOString() / trim.
  const updatedAtSnapshot = instance.updated_at;

  const { data: credential, error: credErr } = await svc
    .from('meta_whatsapp_credentials')
    .select('access_token_enc')
    .eq('instance_id', instance.id)
    .maybeSingle();

  if (credErr || !credential?.access_token_enc) {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  let plainToken;
  try {
    plainToken = decryptMetaToken(credential.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  let phones;
  try {
    phones = await listWabaPhoneNumbers(plainToken, instance.waba_id);
  } catch (err) {
    const mapped = mapGraphReconnectError(err);
    return res.status(mapped.status).json({ error: mapped.error });
  }

  if (!Array.isArray(phones) || !phones.some((p) => p && p.id === instance.phone_number_id)) {
    return res.status(409).json({ error: 'credential_reauth_required' });
  }

  // Graph válida. Caminho connected: só confirma; nunca promove de volta.
  if (instance.status === 'connected') {
    const { data: current, error: reloadErr } = await lookupInstance(svc, instance.id, auth.companyId);
    if (reloadErr) {
      return res.status(500).json({ error: 'internal_error' });
    }
    if (!current) {
      return res.status(404).json({ error: 'instance_not_found' });
    }
    if (current.status === 'connected' && identityMatches(current, instance)) {
      return res.status(200).json(connectedBody(current.id));
    }
    if (current.status === 'error' || current.status === 'token_revoked') {
      return res.status(409).json({ error: 'credential_reauth_required' });
    }
    return res.status(409).json({ error: 'instance_state_conflict' });
  }

  const { data: updatedRows, error: updateErr } = await svc
    .from('meta_whatsapp_instances')
    .update({ status: 'connected' })
    .eq('id', instance.id)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .eq('status', 'disconnected')
    .eq('updated_at', updatedAtSnapshot)
    .eq('waba_id', instance.waba_id)
    .eq('phone_number_id', instance.phone_number_id)
    .select('id, status');

  if (updateErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  if (Array.isArray(updatedRows) && updatedRows.length > 0) {
    return res.status(200).json(connectedBody(updatedRows[0].id));
  }

  const { data: reloaded, error: reloadErr } = await lookupInstance(svc, instance.id, auth.companyId);
  if (reloadErr) {
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!reloaded) {
    return res.status(404).json({ error: 'instance_not_found' });
  }
  if (reloaded.status === 'connected' && identityMatches(reloaded, instance)) {
    return res.status(200).json(connectedBody(reloaded.id));
  }
  if (reloaded.status === 'error' || reloaded.status === 'token_revoked') {
    return res.status(409).json({ error: 'credential_reauth_required' });
  }
  return res.status(409).json({ error: 'instance_state_conflict' });

  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
