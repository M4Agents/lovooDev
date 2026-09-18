// =============================================================================
// POST /api/whatsapp/meta/instances/register
//
// Registra um phone_number_id existente na Meta WhatsApp Cloud API.
// Uso principal: recuperar instâncias já persistidas com status "Pendente"
// no WhatsApp Manager sem refazer o Embedded Signup.
//
// Fluxo (ordem obrigatória — não alterar):
//   1.  Method guard (POST only)
//   2.  Extração de campos do body
//   3.  getSupabaseAdmin()
//   4.  validateMetaCaller() — auth + RBAC + feature flag (META_CONNECT_ROLES)
//   5.  Validação de instance_id (somente após auth)
//   6.  Lookup de instância (company_id autorizado + deleted_at IS NULL)
//   7.  Lookup de credencial (access_token_enc + registration_pin_enc)
//   8.  Guard: já registrado (registration_pin_enc NOT NULL) → 409
//   9.  decryptMetaToken(access_token_enc) → plainToken
//  10.  generateMetaRegistrationPin() → pin (CSPRNG)
//  11.  encryptMetaRegistrationPin(pin) → pinEnc
//  12.  registerPhoneNumber(plainToken, instance.phone_number_id, pin)
//  13.  UPDATE meta_whatsapp_credentials SET registration_pin_enc = pinEnc
//       condicionado a registration_pin_enc IS NULL (anti-race)
//  14.  Verificar resultado do UPDATE
//  15.  Resposta sanitizada { ok: true }
//
// Segurança:
//   - company_id do body identifica o tenant — não autoriza acesso.
//     Autorização via validateMetaCaller; lookups usam auth.companyId.
//   - phone_number_id vem EXCLUSIVAMENTE do banco (instance.phone_number_id).
//   - access_token NÃO aceito no body — sempre do banco + decrypt.
//   - pin NÃO aceito no body — gerado internamente via CSPRNG.
//   - PIN nunca retornado, nunca logado.
//   - registration_pin_enc não é sobrescrito se já preenchido (409).
//   - UPDATE condicionado a IS NULL: resistência a corrida concorrente.
//   - Partial failure (Graph ok + DB fail) retorna error distinto, sem retry.
//   - Nenhum campo sensível em resposta ou logs.
//
// Limitação de concorrência:
//   O guard (passo 8) e o UPDATE condicionado (passo 13) reduzem o risco de
//   corrida, mas não eliminam completamente a janela entre a leitura do
//   registration_pin_enc e o UPDATE. Em produção, o risco é mínimo porque
//   o endpoint é administrativo (admin+) e de uso esporádico. Para garantia
//   absoluta seria necessário lock via RPC/transaction, planejável em fase futura.
// =============================================================================

import { getSupabaseAdmin }                     from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_CONNECT_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken }                     from '../../../lib/meta-whatsapp/tokenCrypto.js';
import {
  generateMetaRegistrationPin,
  encryptMetaRegistrationPin,
}                                               from '../../../lib/meta-whatsapp/pinCrypto.js';
import { registerPhoneNumber }                  from '../../../lib/meta-whatsapp/graphClient.js';

// UUID v4 básico — mesmo padrão dos outros endpoints Meta.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Extrair campos do body ──────────────────────────────────────────────
  // Somente company_id e instance_id são aceitos.
  // Campos proibidos (pin, phone_number_id, access_token, waba_id,
  // registration_pin_enc) são ignorados mesmo se presentes — nunca usados.
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

  // Proteção defensiva externa — captura throws inesperados.
  // Nunca logar: Authorization, token, PIN, stack.
  try {

  // ── 4. Auth + RBAC + feature flag ─────────────────────────────────────────
  // META_CONNECT_ROLES: super_admin, system_admin, partner, admin.
  // Partner exige assignment ativo (validado internamente pelo guard).
  // Feature flag companies.meta_whatsapp_enabled obrigatória.
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
  // Filtros:
  //   id = instanceId              → instância solicitada
  //   company_id = auth.companyId  → isolamento de tenant
  //   deleted_at IS NULL           → somente ativas
  // Cross-tenant, inexistente, deleted → 404 genérico (sem distinção).
  const { data: instance, error: instErr } = await svc
    .from('meta_whatsapp_instances')
    .select('id, phone_number_id')
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

  // ── 7. Lookup de credencial ────────────────────────────────────────────────
  // Somente após instância validada.
  // Seleciona access_token_enc e registration_pin_enc — o mínimo necessário.
  const { data: credential, error: credErr } = await svc
    .from('meta_whatsapp_credentials')
    .select('access_token_enc, registration_pin_enc')
    .eq('instance_id', instance.id)
    .maybeSingle();

  if (credErr || !credential?.access_token_enc) {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 8. Guard: já registrado ────────────────────────────────────────────────
  // registration_pin_enc NOT NULL → já existe evidência de registration.
  // Não re-registrar automaticamente — fail-closed.
  // Zero Graph calls neste caminho.
  if (credential.registration_pin_enc !== null) {
    return res.status(409).json({ error: 'already_registered' });
  }

  // ── 9. Decrypt do access token ─────────────────────────────────────────────
  // Somente após guard. Falhas de decrypt → resposta genérica.
  let plainToken;
  try {
    plainToken = decryptMetaToken(credential.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 10. Gerar PIN criptograficamente seguro ────────────────────────────────
  // CSPRNG — PIN nunca recebido do body, nunca fixo, nunca logado.
  const pin = generateMetaRegistrationPin();

  // ── 11. Cifrar PIN ─────────────────────────────────────────────────────────
  // Preparar ciphertext antes da chamada Graph (falha-rapida se crypto indisponível).
  let pinEnc;
  try {
    pinEnc = encryptMetaRegistrationPin(pin);
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 12. Registrar na Meta Cloud API ───────────────────────────────────────
  // phone_number_id vem EXCLUSIVAMENTE de instance.phone_number_id (banco).
  // plainToken vem do decrypt — nunca do body.
  // pin gerado internamente — nunca do body.
  // Meta Graph call ocorre SOMENTE após todas as validações anteriores.
  try {
    await registerPhoneNumber(plainToken, instance.phone_number_id, pin);
  } catch (err) {
    const code = err?.code;
    // register_invalid_input indica inconsistência interna (inputs derivados do backend)
    if (code === 'register_invalid_input') {
      return res.status(500).json({ error: 'internal_error' });
    }
    if (code === 'register_timeout' || code === 'register_network_error') {
      return res.status(503).json({ error: 'provider_unavailable' });
    }
    // register_failed, register_invalid_response → falha na Meta
    return res.status(502).json({ error: 'registration_failed' });
  }

  // ── 13. Persistir PIN cifrado (somente após Graph success) ─────────────────
  // UPDATE condicionado a registration_pin_enc IS NULL:
  //   - Garante que nunca sobrescrevemos um PIN já existente.
  //   - Reduz (mas não elimina completamente) a janela de corrida concorrente.
  //   - Se outra request concorrente persistiu primeiro, o UPDATE afeta 0 linhas.
  //
  // Nota de limitação: sem lock/RPC a exclusão mútua não é absoluta.
  // Ver comentário de arquitetura no cabeçalho deste arquivo.
  const { data: updatedRows, error: updateErr } = await svc
    .from('meta_whatsapp_credentials')
    .update({ registration_pin_enc: pinEnc })
    .eq('instance_id', instance.id)
    .is('registration_pin_enc', null)
    .select('instance_id'); // retorna as rows atualizadas para detectar 0 linhas

  // ── 14. Verificar resultado do UPDATE ─────────────────────────────────────
  if (updateErr) {
    // DB falhou após Graph success — estado parcial.
    // Meta pode estar registrada, PIN não persistido.
    // Erro distinto para observabilidade: registration_persistence_failed.
    return res.status(500).json({ error: 'registration_persistence_failed' });
  }

  // updatedRows vazio: corrida detectada — outra request já persistiu antes.
  // Fail-closed: não sobrescrever, retornar conflito.
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    return res.status(409).json({ error: 'already_registered' });
  }

  // ── 15. Resposta sanitizada ────────────────────────────────────────────────
  // PIN nunca retornado. Token nunca retornado. Resposta mínima.
  return res.status(200).json({ ok: true });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos pelos catches específicos.
    // Nunca retornar err.message, err.code, stack ou qualquer detalhe de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
