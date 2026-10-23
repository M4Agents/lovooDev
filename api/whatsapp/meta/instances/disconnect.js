// =============================================================================
// POST /api/whatsapp/meta/instances/disconnect
//
// Desconecta uma instância Meta WhatsApp Cloud API no Lovoo.
//
// Semântica (MVP5.A3):
//   Desconectar no Lovoo NÃO revoga autorização na Meta.
//   Nenhuma chamada Graph API ocorre neste fluxo.
//   A operação altera SOMENTE status → 'disconnected'.
//   deleted_at permanece NULL (o phone_number_id continua pertencendo à empresa).
//   Credenciais, número, WABA, histórico e instance_id são preservados.
//
// Fluxo (ordem obrigatória — não alterar):
//   1.  Method guard (POST only)
//   2.  Extração de body (company_id, instance_id — campos proibidos ignorados)
//   3.  getSupabaseAdmin()
//   4.  validateMetaCaller() — auth + RBAC + feature flag (META_CONNECT_ROLES)
//   5.  Validação de instance_id (somente após auth)
//   6.  Lookup de instância (id + auth.companyId + deleted_at IS NULL)
//   7.  Máquina de estados:
//         disconnected  → 200 idempotente (zero UPDATE)
//         token_revoked → 409 instance_state_conflict (não reativa, não altera)
//         error         → 409 instance_state_conflict (não reativa, não altera)
//         outro         → 409 instance_state_conflict
//         connected     → UPDATE status='disconnected' com predicados de corrida
//   8.  Verificar resultado do UPDATE
//   9.  Se 0 linhas: reload e resolver idempotência ou conflito
//  10.  Resposta pública { ok, instance_id, status }
//
// Segurança:
//   - company_id do body identifica o tenant solicitado — não autoriza acesso.
//     Autorização via validateMetaCaller; lookups usam auth.companyId.
//   - Cross-tenant, inexistente ou soft-deleted → 404 opaco instance_not_found.
//   - UPDATE filtra id + company_id + deleted_at IS NULL + status='connected'.
//   - meta_whatsapp_credentials nunca é lida nem escrita.
//   - phone_number_id, waba_id e deleted_at nunca entram no UPDATE.
//   - Nenhum token, PIN, ciphertext ou secret na resposta.
//   - Zero Graph / Uazapi.
//
// Estados token_revoked e error:
//   Não são tratados como desconexão. Exigem fluxo próprio (rotação/revogação)
//   fora deste endpoint. Documentado e fail-closed com 409.
// =============================================================================

import { getSupabaseAdmin }                       from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_CONNECT_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function disconnectedBody(instanceId) {
  return {
    ok:          true,
    instance_id: instanceId,
    status:      'disconnected',
  };
}

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Extrair campos do body ──────────────────────────────────────────────
  // Somente company_id e instance_id são aceitos.
  // Campos proibidos (status, deleted_at, phone_number_id, waba_id, access_token,
  // pin, registration_pin_enc) são ignorados mesmo se presentes — nunca usados.
  const {
    company_id:  companyId,
    instance_id: instanceId,
  } = req.body ?? {};

  // ── 3. Supabase admin client ───────────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  try {

  // ── 4. Auth + RBAC + feature flag ─────────────────────────────────────────
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_CONNECT_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 5. Validação de instance_id (somente após auth) ────────────────────────
  if (!instanceId || !UUID_RE.test(instanceId)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // ── 6. Lookup de instância ─────────────────────────────────────────────────
  // Usa EXCLUSIVAMENTE auth.companyId — nunca req.body.company_id diretamente.
  const { data: instance, error: instErr } = await svc
    .from('meta_whatsapp_instances')
    .select('id, status')
    .eq('id', instanceId)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (instErr) {
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!instance) {
    return res.status(404).json({ error: 'instance_not_found' });
  }

  // ── 7. Máquina de estados ──────────────────────────────────────────────────
  if (instance.status === 'disconnected') {
    return res.status(200).json(disconnectedBody(instance.id));
  }

  if (instance.status !== 'connected') {
    // token_revoked, error ou valor inesperado — não reativar, não alterar.
    return res.status(409).json({ error: 'instance_state_conflict' });
  }

  // UPDATE exclusivo: somente status, somente a linha autorizada e ainda connected.
  const { data: updatedRows, error: updateErr } = await svc
    .from('meta_whatsapp_instances')
    .update({ status: 'disconnected' })
    .eq('id', instance.id)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .eq('status', 'connected')
    .select('id, status');

  // ── 8. Verificar resultado do UPDATE ───────────────────────────────────────
  if (updateErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  if (Array.isArray(updatedRows) && updatedRows.length > 0) {
    return res.status(200).json(disconnectedBody(updatedRows[0].id));
  }

  // ── 9. 0 linhas: corrida — recarregar e resolver ───────────────────────────
  const { data: reloaded, error: reloadErr } = await svc
    .from('meta_whatsapp_instances')
    .select('id, status')
    .eq('id', instance.id)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (reloadErr) {
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!reloaded) {
    return res.status(404).json({ error: 'instance_not_found' });
  }
  if (reloaded.status === 'disconnected') {
    return res.status(200).json(disconnectedBody(reloaded.id));
  }

  return res.status(409).json({ error: 'instance_state_conflict' });

  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
