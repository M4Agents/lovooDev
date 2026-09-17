// =============================================================================
// POST /api/whatsapp/meta/onboarding/complete
//
// Responsabilidade: completar o fluxo Embedded Signup Meta WhatsApp.
//
// Fluxo (ordem obrigatória — não alterar):
//   1. Method guard (POST only)
//   2. Bearer token extraction
//   3. Supabase admin client
//   4. JWT auth → obter user autenticado
//   5. Body validation (somente após auth)
//   6. Claim atômico do onboarding state (UPDATE condicional único)
//   7. Derivar company_id do state claimado — NUNCA do request
//   8. RBAC + tenant + feature flag (validateMetaCaller)
//   9. Code exchange (Graph API)
//  10. WABA resolution (normal: body; discovery: debug_token) + phone listing
//  11. Phone number resolution
//  12. Token encryption (AES-256-GCM via encryptMetaToken)
//  13. Persistência atômica via rpc_create_meta_whatsapp_connection
//  14. Resposta sanitizada
//
// Segurança:
//   - company_id NUNCA vem do body, query, header ou Graph
//   - user_id vem EXCLUSIVAMENTE do JWT validado — nunca do body
//   - state é consumido atomicamente (UPDATE único) antes de qualquer
//     operação privilegiada de banco
//   - state é bound a user_id — não reutilizável por outro usuário
//   - plaintext do access token nunca vai ao banco
//   - resposta nunca contém accessToken, ciphertext, company_id,
//     encryption_version ou access_token_enc
//   - erros internos nunca refletem detalhes de infra ao caller
//   - logging zero: nenhum secret, token, code ou URL sensível logados
//
// Idempotência (MVP):
//   Após claim (used_at setado), qualquer falha posterior deixa o state
//   consumido. Retry com o mesmo state retorna 400 invalid_or_expired_state.
//   Trade-off aceito para esta fase.
// =============================================================================

import { randomUUID }                                  from 'crypto';
import { getSupabaseAdmin }                           from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_CONNECT_ROLES }     from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { exchangeCodeForToken, listWabaPhoneNumbers, discoverAuthorizedWabas } from '../../../lib/meta-whatsapp/graphClient.js';
import { encryptMetaToken }                           from '../../../lib/meta-whatsapp/tokenCrypto.js';

// UUID v4 básico — mesma regex de validateMetaCaller.js.
// Rejeita inputs obviamente inválidos antes de qualquer query no banco.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Meta numeric ID (WABA ID, Phone Number ID) — mesma regex de graphClient.js.
// Rejeita: vazio, letras, espaços, URLs.
const META_ID_RE = /^[0-9]+$/;

// =============================================================================
// Helpers privados
// =============================================================================

/**
 * Extrai Bearer token do header Authorization.
 * Retorna null se ausente, mal formado ou vazio.
 * @private
 */
function extractBearerToken(req) {
  const authHeader = req.headers?.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return token.length > 0 ? token : null;
}

/**
 * Resolve o phone number a usar aplicando as 4 regras obrigatórias:
 *   CASO 0: lista vazia              → erro no_phone_numbers
 *   CASO 1: 1 item, sem seleção     → seleciona o único
 *   CASO >1: vários, sem seleção    → erro ambiguous_phone_numbers
 *   CASO id fornecido: busca exata  → erro requested_phone_not_in_waba se ausente
 *
 * @private
 * @returns {{ phone: object, error: null } | { phone: null, error: { status: number, code: string } }}
 */
function resolvePhoneNumber(phones, requestedPhoneNumberId) {
  if (phones.length === 0) {
    return { phone: null, error: { status: 422, code: 'no_phone_numbers' } };
  }

  if (requestedPhoneNumberId !== undefined) {
    // Correspondência exata por id — nunca phones[0] como fallback.
    const match = phones.find(p => p.id === requestedPhoneNumberId);
    if (!match) {
      return { phone: null, error: { status: 422, code: 'requested_phone_not_in_waba' } };
    }
    return { phone: match, error: null };
  }

  // phone_number_id não fornecido
  if (phones.length === 1) {
    return { phone: phones[0], error: null };
  }

  // Mais de 1 número sem seleção explícita — ambíguo.
  return { phone: null, error: { status: 422, code: 'ambiguous_phone_numbers' } };
}

/**
 * Mapeia err.code de graphClient para { status, code } HTTP.
 * 403 não é usado — reservado ao RBAC interno Lovoo.
 * @private
 */
function mapGraphError(err) {
  if (err?.code === 'graph_waba_inaccessible') {
    return { status: 422, code: 'waba_inaccessible' };
  }
  // code_exchange_failed, code_exchange_no_token, code_exchange_network_error,
  // graph_timeout, graph_network_error, graph_invalid_response → 500
  return { status: 500, code: 'internal_error' };
}

// =============================================================================
// Diagnóstico temporário — remover após identificar subfase de falha pós-claim.
// Visível em: Vercel → LovooDev → Logs → Functions.
// Nenhum dado sensível nos logs: somente metadados de fase e contagens.
// =============================================================================

/**
 * Conjunto fechado de err.code reconhecidos de graphClient.js.
 * Qualquer outro código (ou ausência de código) → 'unknown_error'.
 * Nunca usa err.message — previne vazamento acidental de config/secrets.
 * @private
 */
const _KNOWN_GRAPH_CODES = new Set([
  'code_exchange_failed',
  'code_exchange_no_token',
  'code_exchange_network_error',
  'graph_waba_inaccessible',
  'graph_timeout',
  'graph_network_error',
  'graph_invalid_response',
  'graph_debug_token_failed',
]);

/**
 * Retorna uma categoria segura e fechada para o erro recebido.
 * Nunca expõe err.message, err.stack ou dados do request/response.
 * @private
 * @param {unknown} err
 * @returns {string}
 */
export function safeErrorCategory(err) {
  if (typeof err?.code === 'string' && _KNOWN_GRAPH_CODES.has(err.code)) {
    return err.code;
  }
  return 'unknown_error';
}

/**
 * Emite um evento de diagnóstico temporário via console.log (Vercel Logs).
 * Campos provenientes exclusivamente da allowlist — sem dados sensíveis.
 * @private
 * @param {string} correlationId UUID aleatório por request (sem relação com IDs de negócio)
 * @param {string} event         Nome do evento (conjunto fechado)
 * @param {object} [data]        Campos opcionais da allowlist
 */
export function logPhase(correlationId, event, data = {}) {
  // Allowlist explícita — campos externos nunca entram sem filtragem.
  const allowed = {};
  if ('mode'               in data) allowed.mode              = data.mode;
  if ('success'            in data) allowed.success            = data.success;
  if ('durationMs'         in data) allowed.durationMs         = data.durationMs;
  if ('safeErrorCategory'  in data) allowed.safeErrorCategory  = data.safeErrorCategory;
  if ('wabaCount'          in data) allowed.wabaCount          = data.wabaCount;
  if ('phoneCount'         in data) allowed.phoneCount         = data.phoneCount;
  if ('wabaSource'         in data) allowed.wabaSource         = data.wabaSource;

  console.log(JSON.stringify({
    event,
    correlationId,
    ...allowed,
    timestamp: Date.now(),
  }));
}

// =============================================================================
// Handler principal
// =============================================================================

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Bearer token ────────────────────────────────────────────────────────
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ── 3. Supabase admin client ───────────────────────────────────────────────
  // Instanciação em memória apenas — sem query ao banco aqui.
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Proteção defensiva externa — captura throws inesperados de:
  //   svc.auth.getUser, claim Supabase, validateMetaCaller, svc.rpc.
  // Graph e crypto já possuem catches específicos que retornam antes deste.
  // Nunca logar: Authorization, state, code, token, ciphertext, stack.
  try {

  // ── 4. JWT auth ────────────────────────────────────────────────────────────
  // Executado ANTES de qualquer leitura de body ou query privilegiada.
  // user_id vem EXCLUSIVAMENTE deste resultado — nunca do body.
  const { data: { user }, error: authErr } = await svc.auth.getUser(bearerToken);
  if (authErr || !user) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ── 5. Body validation ─────────────────────────────────────────────────────
  // Executada somente após auth para consistência na ordem de erros:
  //   sem auth → 401, body inválido → 400, sem acesso → 403.
  const body = req.body ?? {};

  // company_id no body é explicitamente proibido — jamais pode vir do browser.
  if (Object.prototype.hasOwnProperty.call(body, 'company_id')) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const { state, code, waba_id: wabaId, phone_number_id: reqPhoneNumberId } = body;

  // state: string, UUID v4 válido.
  if (typeof state !== 'string' || !UUID_RE.test(state)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // code: string, não vazio.
  // trim() somente para verificar se contém algum char não-whitespace.
  // O valor ORIGINAL (code) é preservado e enviado à Meta sem mutação.
  if (typeof code !== 'string' || code.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // waba_id: opcional; se presente, deve ser string numérica.
  // Ausente → caminho discovery na etapa 10.
  if (wabaId !== undefined) {
    if (typeof wabaId !== 'string' || !META_ID_RE.test(wabaId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
  }

  // phone_number_id: opcional; se presente, deve ser string numérica.
  // Não aceitar number JS — sem coerção.
  if (reqPhoneNumberId !== undefined) {
    if (typeof reqPhoneNumberId !== 'string' || !META_ID_RE.test(reqPhoneNumberId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
  }

  // ── 6. Claim atômico do onboarding state ──────────────────────────────────
  // Um único timestamp usado tanto em used_at quanto na comparação expires_at.
  // Garante consistência temporal sem janela de corrida entre as duas checagens.
  const now = new Date().toISOString();

  // UPDATE condicional único — não há SELECT prévio (evita TOCTOU).
  // maybeSingle() retorna data=null sem erro quando 0 linhas foram atualizadas,
  // cobrindo todos os casos de rejeição indistintamente:
  //   - state não existe
  //   - state pertence a outro user_id
  //   - state já foi usado (used_at IS NOT NULL)
  //   - state expirou (expires_at <= now)
  const { data: claimed, error: claimErr } = await svc
    .from('meta_whatsapp_onboarding')
    .update({ used_at: now })
    .eq('id', state)
    .eq('user_id', user.id)
    .is('used_at', null)
    .gt('expires_at', now)
    .select('company_id')
    .maybeSingle();

  if (claimErr) {
    // Erro operacional real (conexão, permissão, etc.) — não expor detalhes.
    return res.status(500).json({ error: 'internal_error' });
  }

  if (!claimed) {
    // 0 linhas atualizadas — qualquer razão de rejeição → mesmo erro público.
    // Evita oracle sobre existência/validade de onboarding states.
    return res.status(400).json({ error: 'invalid_or_expired_state' });
  }

  // ── 7. company_id — ÚNICA autoridade de tenant ────────────────────────────
  // Derivado exclusivamente da row retornada pelo claim.
  // Nunca lido de body, query, header, Graph ou sessão de frontend.
  const companyId = claimed.company_id;

  // ── Diagnóstico: correlation ID + modo (pós-claim) ────────────────────────
  // Gerado após o claim confirmado — correlaciona todos os eventos desta request.
  // correlationId é UUID v4 aleatório sem relação com state, user_id ou company_id.
  const _cid      = randomUUID();
  const _mode     = wabaId !== undefined ? 'normal' : 'discovery';
  logPhase(_cid, 'request_start', { mode: _mode });
  // ─────────────────────────────────────────────────────────────────────────

  // ── 8. RBAC + tenant + feature flag ──────────────────────────────────────
  // validateMetaCaller executa (nesta ordem):
  //   Bearer → JWT (duplo aceito nesta fase) → UUID format → membership →
  //   role matrix → partner assignment → parent/child → feature flag
  //
  // state permanece consumido mesmo se guard falhar — sem rollback de used_at.
  // Esse comportamento é intencional e documentado (anti-replay).
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_CONNECT_ROLES });
  if (!auth.ok) {
    // Diagnóstico: auth falhou → mapear status HTTP para categoria segura fechada.
    const _authCat = auth.status === 401 ? 'unauthorized'
                   : auth.status === 403 ? 'forbidden'
                   : 'internal_error';
    logPhase(_cid, 'auth_check_result', { success: false, safeErrorCategory: _authCat });
    return res.status(auth.status).json({ error: auth.error });
  }
  logPhase(_cid, 'auth_check_result', { success: true });

  // ── 9. Code exchange ───────────────────────────────────────────────────────
  // code original é passado sem alteração — trim() foi usado somente para
  // validação de não-vazio; o valor da variável 'code' não foi mutado.
  // URL final de exchange nunca logada (contém client_secret e code).
  let accessToken;
  {
    const _t = Date.now();
    logPhase(_cid, 'token_exchange_start');
    try {
      ({ accessToken } = await exchangeCodeForToken(code));
      logPhase(_cid, 'token_exchange_result', { success: true, durationMs: Date.now() - _t });
    } catch (err) {
      logPhase(_cid, 'token_exchange_result', { success: false, safeErrorCategory: safeErrorCategory(err), durationMs: Date.now() - _t });
      const mapped = mapGraphError(err);
      return res.status(mapped.status).json({ error: mapped.code });
    }
  }

  // ── 10. WABA resolution + phone listing ──────────────────────────────────
  //
  // CAMINHO NORMAL  (waba_id presente no body):
  //   wabaId validado na etapa 5; listWabaPhoneNumbers prova acesso.
  //
  // CAMINHO DISCOVERY (waba_id ausente — evento FINISH não disparou):
  //   Descobre WABAs via debug_token (fail-closed: 0 ou >1 → 422).
  //   App Access Token construído server-side — nunca exposto em resposta/log.
  //
  // resolvedWabaId é a fonte de verdade para chamadas subsequentes.
  // Uma única chamada compartilhada de listWabaPhoneNumbers após resolução.
  let resolvedWabaId;

  if (wabaId !== undefined) {
    // Caminho normal: wabaId vem do body (validado na etapa 5).
    resolvedWabaId = wabaId;
  } else {
    // Caminho discovery: determinar WABA via Meta debug_token.
    let wabaIds;
    {
      const _t = Date.now();
      logPhase(_cid, 'waba_discovery_start');
      try {
        wabaIds = await discoverAuthorizedWabas(accessToken);
        logPhase(_cid, 'waba_discovery_result', { success: true, wabaCount: wabaIds.length, durationMs: Date.now() - _t });
      } catch (err) {
        logPhase(_cid, 'waba_discovery_result', { success: false, safeErrorCategory: safeErrorCategory(err), durationMs: Date.now() - _t });
        const mapped = mapGraphError(err);
        return res.status(mapped.status).json({ error: mapped.code });
      }
    }

    if (wabaIds.length === 0) {
      return res.status(422).json({ error: 'no_waba_authorized' });
    }
    if (wabaIds.length > 1) {
      return res.status(422).json({ error: 'ambiguous_waba' });
    }
    // exatamente 1 WABA — seleção determinista
    resolvedWabaId = wabaIds[0];
  }

  // Chamada compartilhada — prova acesso do token à WABA resolvida.
  // wabaSource: 'body' (normal) | 'discovery' (fallback sem evento FINISH).
  const _wabaSource = _mode === 'normal' ? 'body' : 'discovery';
  let phones;
  {
    const _t = Date.now();
    logPhase(_cid, 'phone_list_start', { wabaSource: _wabaSource });
    try {
      phones = await listWabaPhoneNumbers(accessToken, resolvedWabaId);
      logPhase(_cid, 'phone_list_result', { success: true, phoneCount: phones.length, wabaSource: _wabaSource, durationMs: Date.now() - _t });
    } catch (err) {
      logPhase(_cid, 'phone_list_result', { success: false, safeErrorCategory: safeErrorCategory(err), wabaSource: _wabaSource, durationMs: Date.now() - _t });
      const mapped = mapGraphError(err);
      return res.status(mapped.status).json({ error: mapped.code });
    }
  }

  // ── 11. Phone number resolution ───────────────────────────────────────────
  // Aplicar as 4 regras obrigatórias de seleção.
  const { phone: selectedPhone, error: phoneErr } = resolvePhoneNumber(phones, reqPhoneNumberId);
  if (phoneErr) {
    // Diagnóstico: phoneErr.code é gerado internamente (resolvePhoneNumber) — não contém dados externos.
    logPhase(_cid, 'phone_resolution_result', { success: false, safeErrorCategory: phoneErr.code });
    return res.status(phoneErr.status).json({ error: phoneErr.code });
  }

  // ── 12. Criptografia do access token ─────────────────────────────────────
  // encryptMetaToken lança se chave ausente/inválida ou plaintext inválido.
  // Após este passo, o plaintext não é mais referenciado — somente ciphertext vai adiante.
  let ciphertext;
  try {
    ciphertext = encryptMetaToken(accessToken);
  } catch {
    // Falha de configuração ou crypto — nunca retornar configuration_error, key_error, etc.
    logPhase(_cid, 'token_encryption_result', { success: false, safeErrorCategory: 'crypto_error' });
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 13. Persistência atômica via RPC ──────────────────────────────────────
  // INSERT atômico em meta_whatsapp_instances + meta_whatsapp_credentials.
  // RPC retorna TABLE → Supabase JS entrega array; esperamos exatamente 1 row.
  //
  // 23505 detectado via rpcErr.code (campo estruturado PostgreSQL) — não regex.
  // Nenhum detalhe sobre quem possui o número é retornado (anti-oracle cross-tenant).
  const _rpcT = Date.now();
  logPhase(_cid, 'connection_rpc_start');
  const { data: rpcRows, error: rpcErr } = await svc.rpc(
    'rpc_create_meta_whatsapp_connection',
    {
      p_company_id:         companyId,
      p_connected_by:       user.id,
      p_waba_id:            resolvedWabaId,
      p_phone_number_id:    selectedPhone.id,
      p_phone_number:       selectedPhone.displayPhoneNumber,
      p_verified_name:      selectedPhone.verifiedName,
      p_display_name:       null,
      p_access_token_enc:   ciphertext,
      p_encryption_version: 1,
    },
  );

  if (rpcErr) {
    // Unique violation (23505) — phone_number_id já conectado (ativo).
    // Mesmo erro público independente de qual company possui o número.
    if (rpcErr.code === '23505') {
      logPhase(_cid, 'connection_rpc_result', { success: false, safeErrorCategory: 'rpc_conflict', durationMs: Date.now() - _rpcT });
      return res.status(409).json({ error: 'phone_number_already_connected' });
    }
    logPhase(_cid, 'connection_rpc_result', { success: false, safeErrorCategory: 'rpc_error', durationMs: Date.now() - _rpcT });
    return res.status(500).json({ error: 'internal_error' });
  }

  // Garantia defensiva: RPC deve retornar exatamente 1 row.
  const instance = Array.isArray(rpcRows) ? rpcRows[0] : null;
  if (!instance) {
    logPhase(_cid, 'connection_rpc_result', { success: false, safeErrorCategory: 'rpc_no_rows', durationMs: Date.now() - _rpcT });
    return res.status(500).json({ error: 'internal_error' });
  }
  logPhase(_cid, 'connection_rpc_result', { success: true, durationMs: Date.now() - _rpcT });

  // ── 14. Resposta sanitizada ───────────────────────────────────────────────
  // Campos NUNCA retornados: accessToken, ciphertext, access_token_enc,
  //   company_id, connected_by (user.id), encryption_version.
  return res.status(200).json({
    instance: {
      id:              instance.instance_id,
      phone_number_id: instance.phone_number_id,
      waba_id:         instance.waba_id,
      phone_number:    instance.phone_number,
      verified_name:   instance.verified_name ?? null,
      status:          instance.status,
    },
  });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos pelos
    // catches específicos de Graph/crypto. Nunca retornar err.message,
    // err.code, stack ou qualquer detalhe de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
