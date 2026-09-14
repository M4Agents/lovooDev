// =============================================================================
// graphClient.js — Meta WhatsApp Cloud API Graph Client
//
// Responsabilidade: comunicação HTTP com a Graph API da Meta.
// Módulo funcional — sem estado, sem retry, sem persistência, sem crypto.
//
// Funções exportadas:
//   exchangeCodeForToken(code)          → { accessToken }
//   listWabaPhoneNumbers(token, wabaId) → [{ id, displayPhoneNumber, verifiedName }]
//
// SEGURANÇA:
//   - URL de code exchange NUNCA logada (contém client_secret e code na query)
//   - accessToken vai SOMENTE no header Authorization: Bearer
//   - paging.next NUNCA executado como fetch destination (anti-SSRF)
//   - Próxima página sempre reconstruída internamente usando somente cursors.after
//   - Erros genéricos — nunca refletem secrets, tokens, wabaId ou Graph.message
//   - Cursors opacos — não interpretados, não logados
//
// Dependências:
//   - api/lib/meta-whatsapp/config.js (getMetaServerConfig)
//
// NÃO presente neste módulo:
//   debug_token | META_SYSTEM_USER_TOKEN | appsecret_proof
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
