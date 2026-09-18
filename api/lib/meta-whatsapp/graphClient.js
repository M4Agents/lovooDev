// =============================================================================
// graphClient.js — Meta WhatsApp Cloud API Graph Client
//
// Responsabilidade: comunicação HTTP com a Graph API da Meta.
// Módulo funcional — sem estado, sem retry, sem persistência, sem crypto.
//
// Funções exportadas:
//   exchangeCodeForToken(code)           → { accessToken }
//   listWabaPhoneNumbers(token, wabaId)  → [{ id, displayPhoneNumber, verifiedName }]
//   discoverAuthorizedWabas(token)       → string[]  — WABA IDs via debug_token
//
// SEGURANÇA:
//   - URL de code exchange NUNCA logada (contém client_secret e code na query)
//   - URL de debug_token NUNCA logada (contém App Access Token na query)
//   - accessToken vai SOMENTE no header Authorization: Bearer (phone_numbers)
//   - paging.next NUNCA executado como fetch destination (anti-SSRF)
//   - Próxima página sempre reconstruída internamente usando somente cursors.after
//   - Erros genéricos — nunca refletem secrets, tokens, wabaId ou Graph.message
//   - Cursors opacos — não interpretados, não logados
//
// Dependências:
//   - api/lib/meta-whatsapp/config.js (getMetaServerConfig)
//
// NÃO presente neste módulo:
//   META_SYSTEM_USER_TOKEN | appsecret_proof
//   subscribed_apps | persistência | criptografia
// =============================================================================

import { getMetaServerConfig } from './config.js';

// =============================================================================
// Constantes
// =============================================================================

const GRAPH_BASE_URL   = 'https://graph.facebook.com';
const GRAPH_TIMEOUT_MS = 10_000; // 10 s — padrão do projeto para Graph calls simples
const PAGE_LIMIT       = 100;    // máximo por request de paginação
const MAX_PAGES        = 10;     // limite defensivo puro — não vinculado ao cap comercial

// Valida Meta IDs (WABA ID, Phone Number ID): numeric strings não vazias.
// Não impõe limite de tamanho — documentação não garante comprimento máximo.
// Rejeita: vazio, letras, espaços, '/', '?', '&', '=', '://', URLs completas.
const META_ID_RE = /^[0-9]+$/;

// Scope que identifica autorização de WhatsApp Business no granular_scopes do debug_token.
const WA_SCOPE = 'whatsapp_business_management';

// Comprimento máximo aceito pela WhatsApp Cloud API para mensagens de texto.
// Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
// Enforced fail-closed: texto acima deste limite é rejeitado antes do fetch.
const MAX_TEXT_BODY_LENGTH = 4096;

// Valida o número de destino para envio outbound.
// Regra MVP: somente dígitos, 7–15 chars (cobre formatos internacionais sem '+').
// A Graph API aceita E.164 com ou sem '+'; o caller deve remover '+' antes de passar.
const TO_PHONE_RE = /^[0-9]{7,15}$/;

// =============================================================================
// Helpers internos
// =============================================================================

/**
 * Cria um Error com código estável para uso interno e nos testes.
 * Mensagem é sempre genérica — nunca reflete secrets ou input do caller.
 *
 * @private
 */
function makeError(code, message) {
  const err = new Error(message);
  err.code  = code;
  return err;
}

/**
 * Executa fetch com timeout via AbortController + setTimeout.
 * clearTimeout no finally garante que o timer não vaza após a resposta.
 *
 * @private
 */
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Constrói a URL do endpoint phone_numbers para uma WABA.
 * Sempre reconstruída internamente — nunca usa paging.next como destino.
 *
 * @private
 */
function buildPhoneNumbersUrl(graphVersion, wabaId, after) {
  const url = new URL(`${GRAPH_BASE_URL}/${graphVersion}/${wabaId}/phone_numbers`);
  url.searchParams.set('fields', 'id,display_phone_number,verified_name');
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (after !== null) {
    url.searchParams.set('after', after);
  }
  return url;
}

/**
 * Valida e normaliza um item de phone number retornado pela Graph API.
 * Falha toda a operação se id ou display_phone_number estiverem ausentes/inválidos.
 * verified_name é opcional: string | null | undefined → normalizado para string | null.
 *
 * @private
 */
function normalizePhone(item) {
  if (typeof item?.id !== 'string' || item.id.length === 0) {
    throw makeError('graph_invalid_response', 'Meta Graph returned invalid phone number data');
  }

  if (typeof item?.display_phone_number !== 'string' || item.display_phone_number.length === 0) {
    throw makeError('graph_invalid_response', 'Meta Graph returned invalid phone number data');
  }

  // verified_name: string → preserva; null/undefined → null; qualquer outro tipo → fail-closed
  const vn = item.verified_name;
  let verifiedName;
  if (typeof vn === 'string') {
    verifiedName = vn;
  } else if (vn === null || vn === undefined) {
    verifiedName = null;
  } else {
    // number, boolean, object, etc. — tipo inesperado → fail-closed
    throw makeError('graph_invalid_response', 'Meta Graph returned invalid phone number data');
  }

  return {
    id:                 item.id,
    displayPhoneNumber: item.display_phone_number,
    verifiedName,
  };
}

// =============================================================================
// exchangeCodeForToken
// =============================================================================

/**
 * Troca o authorization code do Embedded Signup pelo business token do cliente.
 *
 * Endpoint: GET /oauth/access_token
 * Params:   client_id, client_secret, code
 * Omitidos: redirect_uri, grant_type (causam erro 100/subcode 36008)
 *
 * SEGURANÇA: URL final nunca logada — contém client_secret e code na query string.
 *
 * @param {string} code Authorization code do evento JS do Embedded Signup (~30s TTL)
 * @returns {Promise<{ accessToken: string }>}
 * @throws {Error} err.code in:
 *   code_exchange_failed        — HTTP não-2xx ou JSON inválido
 *   code_exchange_no_token      — 2xx mas access_token ausente ou vazio
 *   code_exchange_network_error — timeout ou falha de rede
 */
export async function exchangeCodeForToken(code) {
  if (typeof code !== 'string' || code.length === 0) {
    throw makeError('code_exchange_failed', 'Meta Graph code exchange failed');
  }

  const { appId, appSecret, graphVersion } = getMetaServerConfig();

  // Construção interna — URL final nunca exposta em logs
  const url = new URL(`${GRAPH_BASE_URL}/${graphVersion}/oauth/access_token`);
  url.searchParams.set('client_id',     appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code',          code);
  // Sem redirect_uri — causa erro 100/36008 se incluído
  // Sem grant_type   — não documentado para este fluxo

  let res;
  try {
    res = await fetchWithTimeout(url, { method: 'GET' });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw makeError('code_exchange_network_error', 'Meta Graph request timed out');
    }
    throw makeError('code_exchange_network_error', 'Meta Graph network error');
  }

  if (!res.ok) {
    throw makeError('code_exchange_failed', 'Meta Graph code exchange failed');
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw makeError('code_exchange_failed', 'Meta Graph code exchange failed');
  }

  if (typeof payload?.access_token !== 'string' || payload.access_token.length === 0) {
    throw makeError('code_exchange_no_token', 'Meta Graph code exchange returned no token');
  }

  return { accessToken: payload.access_token };
}

// =============================================================================
// listWabaPhoneNumbers
// =============================================================================

/**
 * Lista todos os números de telefone de uma WABA, seguindo paginação internamente.
 *
 * Prova simultaneamente:
 *   - Business token válido
 *   - Token tem acesso à WABA informada
 *
 * Paginação anti-SSRF:
 *   - paging.next indica existência de próxima página (sinal booleano)
 *   - paging.next NUNCA é usado como URL de fetch
 *   - Próxima request sempre reconstruída internamente com cursors.after
 *
 * @param {string} accessToken Business token obtido via exchangeCodeForToken
 * @param {string} wabaId      WABA ID (numeric string — validado antes do fetch)
 * @returns {Promise<Array<{ id: string, displayPhoneNumber: string, verifiedName: string|null }>>}
 * @throws {Error} err.code in:
 *   graph_waba_inaccessible — HTTP não-2xx (token sem acesso ou WABA inválida)
 *   graph_timeout           — timeout expirado
 *   graph_network_error     — falha de rede
 *   graph_invalid_response  — JSON inválido, payload malformado, paginação inválida
 */
export async function listWabaPhoneNumbers(accessToken, wabaId) {
  // ── Validação de entrada ─────────────────────────────────────────────────────
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw makeError('graph_invalid_response', 'Meta Graph request failed');
  }

  if (typeof wabaId !== 'string' || !META_ID_RE.test(wabaId)) {
    throw makeError('graph_invalid_response', 'Meta Graph request failed');
  }

  const { graphVersion } = getMetaServerConfig();

  // ── Loop de paginação ────────────────────────────────────────────────────────
  const allNumbers  = [];
  const seenCursors = new Set();
  let pageCount = 0;
  let after     = null; // null → primeira página (sem parâmetro after)

  for (;;) {
    pageCount += 1;
    if (pageCount > MAX_PAGES) {
      throw makeError('graph_invalid_response', 'Meta Graph pagination limit exceeded');
    }

    // URL reconstruída internamente a cada iteração
    const url = buildPhoneNumbersUrl(graphVersion, wabaId, after);

    let res;
    try {
      res = await fetchWithTimeout(url, {
        method:  'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw makeError('graph_timeout', 'Meta Graph request timed out');
      }
      throw makeError('graph_network_error', 'Meta Graph network error');
    }

    if (!res.ok) {
      throw makeError('graph_waba_inaccessible', 'Meta Graph WABA inaccessible');
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      throw makeError('graph_invalid_response', 'Meta Graph invalid response');
    }

    if (!Array.isArray(payload?.data)) {
      throw makeError('graph_invalid_response', 'Meta Graph invalid response');
    }

    // Validação e normalização de cada item — fail-closed (falha toda a operação)
    for (const item of payload.data) {
      allNumbers.push(normalizePhone(item));
    }

    // ── Decisão de continuidade ──────────────────────────────────────────────
    // Sinal oficial de fim: ausência de paging.next (Graph API paginated results)
    const pagingNext = payload.paging?.next;

    if (pagingNext === undefined) {
      // paging.next ausente — sinal oficial de fim dos dados
      break;
    }

    // Qualquer valor presente que não seja string não vazia é inválido.
    // Inclui: null, '', number, boolean, object — nenhum deles é fim normal.
    if (typeof pagingNext !== 'string' || pagingNext.length === 0) {
      throw makeError('graph_invalid_response', 'Meta Graph invalid pagination response');
    }

    // paging.next sinaliza mais dados → exigir cursors.after para reconstrução interna
    const cursor = payload.paging?.cursors?.after;

    if (typeof cursor !== 'string' || cursor.length === 0) {
      throw makeError('graph_invalid_response', 'Meta Graph pagination cursor missing');
    }

    if (seenCursors.has(cursor)) {
      throw makeError('graph_invalid_response', 'Meta Graph pagination loop detected');
    }
    seenCursors.add(cursor);

    // cursor é usado somente como query param &after=<cursor>
    // paging.next nunca é executado como URL de fetch destination
    after = cursor;
  }

  return allNumbers;
}

// =============================================================================
// discoverAuthorizedWabas
// =============================================================================

/**
 * Descobre os WABA IDs autorizados pelo access token via Meta debug_token +
 * granular_scopes.
 *
 * Autentica com App Access Token (appId|appSecret) construído server-side —
 * nunca exposto ao caller em resultado, log ou mensagem de erro.
 * Retorna somente IDs do scope whatsapp_business_management.
 *
 * POLÍTICA DE TARGET_IDS INVÁLIDOS (fail-closed):
 *   Se qualquer target_id em um entry válido do scope não for string numérica
 *   não vazia, a operação inteira é rejeitada com graph_invalid_response.
 *   Não é feita filtragem silenciosa de IDs inválidos — resposta estruturalmente
 *   inconsistente indica dado não confiável e não deve ser aceita parcialmente.
 *
 * URL de debug_token NUNCA logada — contém App Access Token na query string.
 *
 * @param {string} accessToken Business token obtido via exchangeCodeForToken
 * @returns {Promise<string[]>} WABA IDs numéricos deduplicados (pode ser [])
 * @throws {Error} err.code in:
 *   graph_debug_token_failed — HTTP não-2xx
 *   graph_timeout            — timeout expirado
 *   graph_network_error      — falha de rede
 *   graph_invalid_response   — JSON inválido, payload malformado, target_id inválido
 */
export async function discoverAuthorizedWabas(accessToken) {
  // ── Validação de entrada ─────────────────────────────────────────────────────
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw makeError('graph_invalid_response', 'Meta Graph request failed');
  }

  const { appId, appSecret, graphVersion } = getMetaServerConfig();

  // App Access Token: appId|appSecret — somente em query param, nunca logado,
  // nunca retornado, nunca presente em mensagens de erro.
  const appAccessToken = `${appId}|${appSecret}`;

  // URL contém access_token — nunca logada (mesma política de exchangeCodeForToken)
  const url = new URL(`${GRAPH_BASE_URL}/${graphVersion}/debug_token`);
  url.searchParams.set('input_token',  accessToken);
  url.searchParams.set('access_token', appAccessToken);

  let res;
  try {
    res = await fetchWithTimeout(url, { method: 'GET' });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw makeError('graph_timeout', 'Meta Graph request timed out');
    }
    throw makeError('graph_network_error', 'Meta Graph network error');
  }

  if (!res.ok) {
    throw makeError('graph_debug_token_failed', 'Meta Graph debug_token request failed');
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw makeError('graph_invalid_response', 'Meta Graph invalid response');
  }

  // data deve ser um objeto não-nulo — estrutura mínima esperada
  if (typeof payload?.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
    throw makeError('graph_invalid_response', 'Meta Graph invalid response');
  }

  const { granular_scopes } = payload.data;

  // granular_scopes ausente (undefined) → token sem nenhum scope granular → []
  // Válido semanticamente: token pode não ter autorizado nenhum recurso WABA.
  if (granular_scopes === undefined) {
    return [];
  }

  // granular_scopes presente mas não é array → inconsistência estrutural → fail-closed
  if (!Array.isArray(granular_scopes)) {
    throw makeError('graph_invalid_response', 'Meta Graph invalid response');
  }

  // ── Extração de WABA IDs ─────────────────────────────────────────────────────
  // Set garante deduplicação entre múltiplos entries do mesmo scope
  const wabaIds = new Set();

  for (const entry of granular_scopes) {
    // Ignorar silenciosamente entries que não são do scope WhatsApp Business.
    // Qualquer outro scope é irrelevante — sem falha.
    if (typeof entry?.scope !== 'string' || entry.scope !== WA_SCOPE) {
      continue;
    }

    // Entry do scope correto mas target_ids não é array → inconsistência → fail-closed
    if (!Array.isArray(entry.target_ids)) {
      throw makeError('graph_invalid_response', 'Meta Graph invalid response');
    }

    // target_ids vazio → scope presente mas sem WABAs autorizadas → contribui []
    for (const id of entry.target_ids) {
      // POLÍTICA FAIL-CLOSED:
      // Qualquer ID inválido junto com IDs válidos → rejeita operação inteira.
      // Resposta estruturalmente inconsistente não é aceita parcialmente.
      if (typeof id !== 'string' || !META_ID_RE.test(id)) {
        throw makeError('graph_invalid_response', 'Meta Graph invalid response');
      }
      wabaIds.add(id);
    }
  }

  return Array.from(wabaIds);
}

// =============================================================================
// sendTextMessage
// =============================================================================

/**
 * Envia uma mensagem de texto via WhatsApp Cloud API.
 *
 * Endpoint: POST /{graphVersion}/{phoneNumberId}/messages
 *
 * Payload construído INTERNAMENTE — não aceita payload arbitrário do caller.
 * Estrutura enviada ao Graph:
 *   { messaging_product, recipient_type, to, type, text: { body } }
 *
 * SEGURANÇA:
 *   - accessToken nunca logado, nunca presente em mensagem de erro
 *   - to nunca logado
 *   - text nunca logado
 *   - URL construída internamente — sem SSRF por valor externo
 *   - Payload construído internamente — sem injection de campos arbitrários
 *
 * @param {string} accessToken   Business token da instância (nunca logar)
 * @param {string} phoneNumberId Phone Number ID da instância (numeric string)
 * @param {string} to            Número de destino — somente dígitos, sem '+'
 * @param {string} text          Corpo da mensagem (não vazio após trim, max 4096 chars)
 * @returns {Promise<{ messageId: string }>}
 * @throws {Error} err.code in:
 *   send_invalid_input    — validação falhou antes do fetch (sem rede)
 *   send_failed           — HTTP não-2xx do Graph
 *   send_timeout          — AbortError / timeout expirado
 *   send_network_error    — falha de rede não-timeout
 *   send_invalid_response — HTTP 2xx mas response sem message id válido
 */
export async function sendTextMessage(accessToken, phoneNumberId, to, text) {
  // ── Validação de entrada (fail-closed antes de qualquer fetch) ────────────
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw makeError('send_invalid_input', 'Meta send: invalid input');
  }

  if (typeof phoneNumberId !== 'string' || !META_ID_RE.test(phoneNumberId)) {
    throw makeError('send_invalid_input', 'Meta send: invalid input');
  }

  if (typeof to !== 'string' || !TO_PHONE_RE.test(to)) {
    throw makeError('send_invalid_input', 'Meta send: invalid input');
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    throw makeError('send_invalid_input', 'Meta send: invalid input');
  }

  if (text.length > MAX_TEXT_BODY_LENGTH) {
    throw makeError('send_invalid_input', 'Meta send: invalid input');
  }

  const { graphVersion } = getMetaServerConfig();

  // URL construída internamente — nunca usa valor externo como base de URL
  const url = new URL(`${GRAPH_BASE_URL}/${graphVersion}/${phoneNumberId}/messages`);

  // Payload construído internamente — não expõe campos arbitrários ao Graph
  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type:              'text',
    text:              { body: text.trim() },
  });

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw makeError('send_timeout', 'Meta send request timed out');
    }
    throw makeError('send_network_error', 'Meta send network error');
  }

  if (!res.ok) {
    throw makeError('send_failed', 'Meta send failed');
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw makeError('send_invalid_response', 'Meta send invalid response');
  }

  // Extrair somente o primeiro message id válido da resposta Graph.
  // Resposta esperada: { messages: [{ id: "wamid.xxx" }], ... }
  const messageId = payload?.messages?.[0]?.id;
  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw makeError('send_invalid_response', 'Meta send invalid response');
  }

  return { messageId };
}

// =============================================================================
// registerPhoneNumber
// =============================================================================

/**
 * Registra um phone_number_id na WhatsApp Cloud API.
 *
 * Endpoint: POST /{graphVersion}/{phoneNumberId}/register
 *
 * Payload construído INTERNAMENTE:
 *   { messaging_product: "whatsapp", pin }
 *
 * SEGURANÇA:
 *   - accessToken nunca logado, nunca presente em mensagem de erro
 *   - PIN nunca logado, nunca presente em mensagem de erro
 *   - phoneNumberId nunca logado
 *   - URL construída internamente — sem SSRF por valor externo
 *   - Em non-2xx: preserva SOMENTE graphStatus, metaErrorCode, metaSubcode
 *     (campos numéricos seguros para diagnóstico — sem message, fbtrace, body)
 *
 * @param {string} accessToken   Business token da instância (nunca logar)
 * @param {string} phoneNumberId Phone Number ID da instância (numeric string)
 * @param {string} pin           PIN de 6 dígitos exatos (nunca logar)
 * @returns {Promise<{ ok: true }>}
 * @throws {Error} err.code in:
 *   register_invalid_input    — validação falhou antes do fetch (sem rede)
 *   register_failed           — HTTP não-2xx do Graph
 *   register_timeout          — AbortError / timeout expirado
 *   register_network_error    — falha de rede não-timeout
 *   register_invalid_response — HTTP 2xx mas response semanticamente inválida
 */
export async function registerPhoneNumber(accessToken, phoneNumberId, pin) {
  // ── Validação de entrada (fail-closed antes de qualquer fetch) ────────────
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw makeError('register_invalid_input', 'Meta register: invalid input');
  }

  if (typeof phoneNumberId !== 'string' || !META_ID_RE.test(phoneNumberId)) {
    throw makeError('register_invalid_input', 'Meta register: invalid input');
  }

  // PIN: exatamente 6 dígitos — mesma regex de pinCrypto.js
  if (typeof pin !== 'string' || !/^[0-9]{6}$/.test(pin)) {
    throw makeError('register_invalid_input', 'Meta register: invalid input');
  }

  const { graphVersion } = getMetaServerConfig();

  // URL construída internamente — nunca usa valor externo como base de URL
  const url = new URL(`${GRAPH_BASE_URL}/${graphVersion}/${phoneNumberId}/register`);

  // Payload construído internamente
  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    pin,
  });

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw makeError('register_timeout', 'Meta register request timed out');
    }
    throw makeError('register_network_error', 'Meta register network error');
  }

  if (!res.ok) {
    // Preservar SOMENTE campos seguros para diagnóstico — sem message, fbtrace, body raw.
    // Leitura do body tentada em best-effort: falha silenciosa (body pode não ser JSON).
    const errObj = makeError('register_failed', 'Meta register failed');
    errObj.graphStatus = res.status;
    try {
      const errPayload = await res.json();
      const code    = errPayload?.error?.code;
      const subcode = errPayload?.error?.error_subcode;
      if (typeof code    === 'number') errObj.metaErrorCode = code;
      if (typeof subcode === 'number') errObj.metaSubcode   = subcode;
    } catch {
      // Body não é JSON válido — sem dados adicionais. Não falhar por isso.
    }
    throw errObj;
  }

  // ── Validação da resposta 2xx ──────────────────────────────────────────────
  // A Graph API retorna { success: true } para registration bem-sucedido.
  // Aceitar também resposta sem body (201 sem conteúdo) como sucesso válido.
  let payload;
  try {
    payload = await res.json();
  } catch {
    // Corpo ausente ou não-JSON em 2xx — aceitar como sucesso (alguns 201 são empty)
    return { ok: true };
  }

  // Se há body JSON, verificar que não indica falha explícita (success: false).
  if (payload !== null && typeof payload === 'object' && payload.success === false) {
    throw makeError('register_invalid_response', 'Meta register invalid response');
  }

  return { ok: true };
}

// =============================================================================
// setTwoStepVerificationPin
// =============================================================================

/**
 * Define ou altera o PIN de two-step verification de um phone_number_id
 * já registrado na WhatsApp Cloud API.
 *
 * Endpoint: POST /{graphVersion}/{phoneNumberId}
 *
 * Payload construído INTERNAMENTE:
 *   { pin }
 *
 * DIFERENÇA CRÍTICA vs registerPhoneNumber:
 *   - NÃO inclui messaging_product no body
 *   - NÃO exige conhecer o PIN anterior
 *   - Funciona em números com status Connected
 *   - Sucesso EXIGE payload { success: true } — não aceita body vazio
 *
 * SEGURANÇA:
 *   - accessToken nunca logado, nunca presente em mensagem de erro
 *   - PIN nunca logado, nunca presente em mensagem de erro
 *   - phoneNumberId nunca logado
 *   - URL construída internamente — sem SSRF por valor externo
 *   - Em non-2xx: preserva SOMENTE graphStatus, metaErrorCode, metaSubcode
 *
 * @param {string} accessToken   Business token da instância (nunca logar)
 * @param {string} phoneNumberId Phone Number ID da instância (numeric string)
 * @param {string} pin           PIN de 6 dígitos exatos (nunca logar)
 * @returns {Promise<{ ok: true }>}
 * @throws {Error} err.code in:
 *   set_pin_invalid_input    — validação falhou antes do fetch (sem rede)
 *   set_pin_failed           — HTTP não-2xx do Graph
 *   set_pin_timeout          — AbortError / timeout expirado
 *   set_pin_network_error    — falha de rede não-timeout
 *   set_pin_invalid_response — HTTP 2xx mas payload ≠ { success: true }
 */
export async function setTwoStepVerificationPin(accessToken, phoneNumberId, pin) {
  // ── Validação de entrada (fail-closed antes de qualquer fetch) ────────────
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    throw makeError('set_pin_invalid_input', 'Meta set_pin: invalid input');
  }

  if (typeof phoneNumberId !== 'string' || !META_ID_RE.test(phoneNumberId)) {
    throw makeError('set_pin_invalid_input', 'Meta set_pin: invalid input');
  }

  // PIN: exatamente 6 dígitos — mesma regex de pinCrypto.js
  if (typeof pin !== 'string' || !/^[0-9]{6}$/.test(pin)) {
    throw makeError('set_pin_invalid_input', 'Meta set_pin: invalid input');
  }

  const { graphVersion } = getMetaServerConfig();

  // URL construída internamente — endpoint é o phoneNumberId SEM sufixo /register
  const url = new URL(`${GRAPH_BASE_URL}/${graphVersion}/${phoneNumberId}`);

  // Payload contém SOMENTE { pin } — NÃO inclui messaging_product (diferença do /register)
  const body = JSON.stringify({ pin });

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw makeError('set_pin_timeout', 'Meta set_pin request timed out');
    }
    throw makeError('set_pin_network_error', 'Meta set_pin network error');
  }

  if (!res.ok) {
    // Preservar SOMENTE campos seguros para diagnóstico — sem message, fbtrace, body raw.
    const errObj = makeError('set_pin_failed', 'Meta set_pin failed');
    errObj.graphStatus = res.status;
    try {
      const errPayload = await res.json();
      const code    = errPayload?.error?.code;
      const subcode = errPayload?.error?.error_subcode;
      if (typeof code    === 'number') errObj.metaErrorCode = code;
      if (typeof subcode === 'number') errObj.metaSubcode   = subcode;
    } catch {
      // Body não é JSON válido — sem dados adicionais.
    }
    throw errObj;
  }

  // ── Validação da resposta 2xx ──────────────────────────────────────────────
  // O endpoint POST /{phoneNumberId} SEMPRE retorna { "success": true } em sucesso.
  // Diferente de registerPhoneNumber, NÃO aceitamos body vazio como sucesso válido.
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw makeError('set_pin_invalid_response', 'Meta set_pin invalid response');
  }

  // Sucesso somente se payload é objeto não-array com success === true
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.success !== true
  ) {
    throw makeError('set_pin_invalid_response', 'Meta set_pin invalid response');
  }

  return { ok: true };
}
