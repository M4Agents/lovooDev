// =============================================================================
// POST /api/whatsapp/meta/instances/set-pin
//
// Define ou re-confirma o PIN de two-step verification de uma instância Meta
// já registrada/conectada, implementando o padrão "persist before call".
//
// Responsabilidade principal:
//   Recuperar o estado após partial failure de /register (timeout → PIN não
//   persistido) e garantir que o Lovoo tenha um PIN conhecido e confirmado
//   para o phone_number_id da instância.
//
// Fluxo (ordem obrigatória — não alterar):
//   1.  Method guard (POST only)
//   2.  Extração de body (company_id, instance_id — campos proibidos ignorados)
//   3.  getSupabaseAdmin()
//   4.  validateMetaCaller() — auth + RBAC + feature flag (META_CONNECT_ROLES)
//   5.  Validação de instance_id (após auth)
//   6.  Lookup de instância (id + company_id + deleted_at IS NULL)
//   7.  Lookup de credencial (access_token_enc + registration_pin_enc + confirmed_at)
//   8.  Máquina de estados (A / B / C / inválido)
//
//   ESTADO A — pin_enc IS NULL + confirmed_at IS NULL:
//     8a. generateMetaRegistrationPin() → pin
//     8b. encryptMetaRegistrationPin(pin) → pinEnc
//     8c. PERSIST registration_pin_enc = pinEnc (UPDATE condicional)
//     8d. Se persist ok: prosseguir com pin gerado
//     8e. Se persist 0 rows: reload credential → continuar com PIN vencedor
//
//   ESTADO B — pin_enc IS NOT NULL + confirmed_at IS NULL:
//     8f. decryptMetaRegistrationPin(pin_enc) → pin existente
//
//   ESTADO C — pin_enc IS NOT NULL + confirmed_at IS NOT NULL:
//     → 409 pin_already_confirmed (zero Graph)
//
//   INVÁLIDO — pin_enc IS NULL + confirmed_at IS NOT NULL:
//     → 500 pin_state_invalid (zero Graph)
//
//   9.  decryptMetaToken(access_token_enc) → plainToken
//  10.  setTwoStepVerificationPin(plainToken, phone_number_id, pin)
//  11.  UPDATE registration_pin_confirmed_at = now()
//       condicionado: instance_id + registration_pin_enc = pinEncUsed + confirmed_at IS NULL
//  12.  Verificar resultado do UPDATE de confirmação
//  13.  Resposta sanitizada { ok: true }
//
// Segurança:
//   - PIN nunca vem do body — sempre gerado ou recuperado do banco.
//   - phone_number_id EXCLUSIVAMENTE do banco.
//   - access_token EXCLUSIVAMENTE do banco + decrypt.
//   - registration_pin_confirmed_at NUNCA aceito do request.
//   - PIN nunca logado, nunca retornado.
//   - Partial failure (Graph ok + confirm DB fail) retorna erro distinto.
//   - Nenhum retry automático.
//   - UPDATE de confirmação condicionado ao ciphertext: não confirma se o PIN mudou.
//
// Princípio: PERSIST PIN FIRST → GRAPH → CONFIRM TIMESTAMP
// Nunca voltar ao padrão: GRAPH → PERSIST PIN
//
// Limitação de concorrência:
//   O UPDATE condicional da persistência (IS NULL) reduz a janela de corrida.
//   Para exclusão mútua absoluta seria necessário RPC/lock — planejável em fase futura.
// =============================================================================

import { getSupabaseAdmin }                       from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_CONNECT_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken }                       from '../../../lib/meta-whatsapp/tokenCrypto.js';
import {
  generateMetaRegistrationPin,
  encryptMetaRegistrationPin,
  decryptMetaRegistrationPin,
}                                                 from '../../../lib/meta-whatsapp/pinCrypto.js';
import { setTwoStepVerificationPin }              from '../../../lib/meta-whatsapp/graphClient.js';

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
  // Campos proibidos (pin, phone_number_id, access_token, registration_pin_enc,
  // registration_pin_confirmed_at, waba_id) são ignorados mesmo se presentes.
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

  // Proteção defensiva externa — nunca logar Authorization, token, PIN, stack.
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
  const { data: credential, error: credErr } = await svc
    .from('meta_whatsapp_credentials')
    .select('access_token_enc, registration_pin_enc, registration_pin_confirmed_at')
    .eq('instance_id', instance.id)
    .maybeSingle();

  if (credErr || !credential?.access_token_enc) {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 8. Máquina de estados ──────────────────────────────────────────────────
  const pinEncIsNull       = credential.registration_pin_enc === null;
  const confirmedAtIsNull  = credential.registration_pin_confirmed_at === null;

  // Estado C: já confirmado — nenhuma chamada Graph
  if (!pinEncIsNull && !confirmedAtIsNull) {
    return res.status(409).json({ error: 'pin_already_confirmed' });
  }

  // Estado inválido: confirmed_at preenchido sem pin_enc — nenhuma chamada Graph
  if (pinEncIsNull && !confirmedAtIsNull) {
    return res.status(500).json({ error: 'pin_state_invalid' });
  }

  // Variáveis para o Graph call e UPDATE de confirmação
  let plainPin;   // PIN plaintext — NUNCA persistir, NUNCA logar
  let pinEncUsed; // ciphertext efetivamente persistido (para o UPDATE condicional)

  if (pinEncIsNull) {
    // ── ESTADO A: gerar e persistir PIN ANTES do Graph ─────────────────────
    const generatedPin = generateMetaRegistrationPin();

    let generatedPinEnc;
    try {
      generatedPinEnc = encryptMetaRegistrationPin(generatedPin);
    } catch {
      return res.status(500).json({ error: 'internal_error' });
    }

    // PERSIST BEFORE GRAPH — UPDATE condicional (ambos IS NULL)
    // Garante que nunca sobrescrevemos PIN existente nem estado confirmado.
    const { data: persistedRows, error: persistErr } = await svc
      .from('meta_whatsapp_credentials')
      .update({ registration_pin_enc: generatedPinEnc })
      .eq('instance_id', instance.id)
      .is('registration_pin_enc', null)
      .is('registration_pin_confirmed_at', null)
      .select('instance_id');

    if (persistErr) {
      // DB falhou — NÃO chamar Graph (PIN não está garantido no banco).
      return res.status(500).json({ error: 'pin_persistence_failed' });
    }

    if (!Array.isArray(persistedRows) || persistedRows.length === 0) {
      // Corrida detectada: outra request persistiu antes. Recarregar uma vez.
      const { data: reloaded, error: reloadErr } = await svc
        .from('meta_whatsapp_credentials')
        .select('registration_pin_enc, registration_pin_confirmed_at')
        .eq('instance_id', instance.id)
        .maybeSingle();

      if (reloadErr || !reloaded) {
        return res.status(500).json({ error: 'internal_error' });
      }

      // Se o vencedor já confirmou → retornar conflito (não repetir Graph)
      if (reloaded.registration_pin_confirmed_at !== null) {
        return res.status(409).json({ error: 'pin_already_confirmed' });
      }

      // Estado inválido após reload
      if (reloaded.registration_pin_enc === null) {
        return res.status(500).json({ error: 'pin_state_invalid' });
      }

      // Reutilizar exatamente o PIN vencedor persistido (Estado B a partir daqui)
      try {
        plainPin    = decryptMetaRegistrationPin(reloaded.registration_pin_enc);
        pinEncUsed  = reloaded.registration_pin_enc;
      } catch {
        return res.status(500).json({ error: 'pin_credential_unavailable' });
      }
    } else {
      // Esta request ganhou a corrida — usar o PIN gerado
      plainPin   = generatedPin;
      pinEncUsed = generatedPinEnc;
    }
  } else {
    // ── ESTADO B: reutilizar PIN existente (não confirmado) ────────────────
    // NÃO gerar novo PIN. NÃO sobrescrever registration_pin_enc.
    try {
      plainPin   = decryptMetaRegistrationPin(credential.registration_pin_enc);
      pinEncUsed = credential.registration_pin_enc;
    } catch {
      return res.status(500).json({ error: 'pin_credential_unavailable' });
    }
  }

  // ── 9. Decrypt do access token ─────────────────────────────────────────────
  // Decrypt após PIN estar garantido no banco (falha aqui deixa PIN para retry).
  let plainToken;
  try {
    plainToken = decryptMetaToken(credential.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 10. Chamar Meta Cloud API ──────────────────────────────────────────────
  // phone_number_id EXCLUSIVAMENTE de instance.phone_number_id (banco).
  // plainToken do decrypt — nunca do body.
  // plainPin gerado ou recuperado do banco — nunca do body.
  try {
    await setTwoStepVerificationPin(plainToken, instance.phone_number_id, plainPin);
  } catch (err) {
    const code = err?.code;
    // Inputs derivados do backend: invalid_input indica bug interno
    if (code === 'set_pin_invalid_input') {
      return res.status(500).json({ error: 'internal_error' });
    }
    if (code === 'set_pin_timeout' || code === 'set_pin_network_error') {
      // PIN permanece persistido (registro_pin_enc NOT NULL) para retry em Estado B.
      // NÃO apagar PIN. NÃO gerar outro. NÃO retry automático.
      return res.status(503).json({ error: 'provider_unavailable' });
    }
    // set_pin_failed, set_pin_invalid_response
    return res.status(502).json({ error: 'set_pin_failed' });
  }

  // ── 11 + 12. Persistir confirmação (somente após Graph success) ────────────
  // UPDATE condicionado:
  //   - instance_id correto
  //   - registration_pin_enc = pinEncUsed (garantia: não confirma se PIN mudou)
  //   - registration_pin_confirmed_at IS NULL (não sobrescreve confirmação)
  const confirmedAt = new Date().toISOString();

  const { data: confirmedRows, error: confirmErr } = await svc
    .from('meta_whatsapp_credentials')
    .update({ registration_pin_confirmed_at: confirmedAt })
    .eq('instance_id', instance.id)
    .eq('registration_pin_enc', pinEncUsed)
    .is('registration_pin_confirmed_at', null)
    .select('instance_id');

  if (confirmErr) {
    // Graph success + DB fail → estado parcial especial.
    // Meta aceitou o PIN mas confirmação não foi registrada.
    return res.status(500).json({ error: 'pin_confirmation_persistence_failed' });
  }

  if (!Array.isArray(confirmedRows) || confirmedRows.length === 0) {
    // 0 rows: PIN mudou ou já foi confirmado entre o Graph call e este UPDATE.
    return res.status(500).json({ error: 'pin_confirmation_conflict' });
  }

  // ── 13. Resposta sanitizada ────────────────────────────────────────────────
  // PIN nunca retornado. Token nunca retornado.
  return res.status(200).json({ ok: true });

  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
