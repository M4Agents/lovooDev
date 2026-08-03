// =============================================================================
// nuvemshopClient — cliente centralizado para a API REST da Nuvemshop
//
// Responsabilidades:
//   - Autenticação (header Authentication: bearer — padrão Nuvemshop)
//   - User-Agent obrigatório (Nuvemshop rejeita requisições sem ele)
//   - Tratamento de erros tipados (NuvemshopError)
//   - Retry com backoff exponencial (429, 5xx)
//   - Rate limit awareness (Retry-After, X-Rate-Limit-Reset)
//   - Paginação via since_id (getAllPages)
//
// NÃO implementado nesta fase:
//   - Circuit Breaker (opcional, sem necessidade comprovada no MVP)
//   - Sync Services
//   - Workers
//
// Uso:
//   const client = createNuvemshopClient({ storeId, accessToken });
//   const store  = await client.get('store');
//   const orders = await client.getAllPages('orders', { per_page: 50 });
//
// Segurança:
//   - accessToken nunca logado
//   - Erros com status 4xx nunca rethrow dados do token
// =============================================================================

const API_BASE      = 'https://api.nuvemshop.com.br/v1';
const USER_AGENT    = 'LoovooCRM (suporte@lovoocrm.com)';
const MAX_RETRIES   = 3;
const PAGE_SIZE_MAX = 200;

/** Erros retornados pela API Nuvemshop com status HTTP. */
export class NuvemshopError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {object} [body]
   */
  constructor(status, message, body = {}) {
    super(message);
    this.name   = 'NuvemshopError';
    this.status = status;
    this.body   = body;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cria um cliente Nuvemshop autenticado para uma loja específica.
 *
 * @param {{ storeId: string|number, accessToken: string }} options
 * @returns {NuvemshopClientInstance}
 */
export function createNuvemshopClient({ storeId, accessToken, correlationId }) {
  if (!storeId || !accessToken) {
    throw new Error('[nuvemshopClient] storeId e accessToken são obrigatórios');
  }

  const baseUrl = `${API_BASE}/${storeId}`;

  function getHeaders() {
    return {
      // Nuvemshop usa "Authentication" (não "Authorization")
      'Authentication': `bearer ${accessToken}`,
      'User-Agent':     USER_AGENT,
      'Content-Type':   'application/json',
      'Accept':         'application/json',
      // Propaga correlation_id para facilitar rastreabilidade end-to-end
      ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
    };
  }

  /**
   * Executa uma requisição HTTP com retry automático.
   *
   * @param {string} method
   * @param {string} path    Caminho relativo ao store (ex: 'orders', 'store')
   * @param {{ params?: object, body?: object, attempt?: number }} [opts]
   * @returns {Promise<object|null>}
   */
  async function request(method, path, opts = {}) {
    const { params, body, attempt = 0 } = opts;

    const url = new URL(`${baseUrl}/${path.replace(/^\/+/, '')}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      });
    }

    let res;
    try {
      res = await fetch(url.toString(), {
        method,
        headers: getHeaders(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (networkErr) {
      // Erro de rede — retry com backoff
      if (attempt < MAX_RETRIES) {
        await sleep(Math.pow(2, attempt) * 1000);
        return request(method, path, { params, body, attempt: attempt + 1 });
      }
      throw new NuvemshopError(0, `Erro de rede: ${networkErr.message}`);
    }

    // ── Rate limit (429) ────────────────────────────────────────────────────
    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new NuvemshopError(429, 'Rate limit excedido após todas as tentativas');
      }
      const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
      const resetAt    = parseInt(res.headers.get('X-Rate-Limit-Reset') || '0', 10);
      const waitMs     = resetAt > 0
        ? Math.max(resetAt * 1000 - Date.now(), 1000)
        : retryAfter * 1000;

      console.warn('[nuvemshopClient] rate_limited storeId=%s attempt=%d waitMs=%d',
        storeId, attempt, waitMs);
      await sleep(waitMs);
      return request(method, path, { params, body, attempt: attempt + 1 });
    }

    // ── Erros de servidor (5xx) — retry com backoff exponencial ────────────
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const waitMs = Math.pow(2, attempt) * 1000;
      console.warn('[nuvemshopClient] server_error storeId=%s status=%d attempt=%d waitMs=%d',
        storeId, res.status, attempt, waitMs);
      await sleep(waitMs);
      return request(method, path, { params, body, attempt: attempt + 1 });
    }

    // ── Sem conteúdo ────────────────────────────────────────────────────────
    if (res.status === 204) return null;

    // ── Erros 4xx e outros não-retryable ────────────────────────────────────
    if (!res.ok) {
      let errBody = {};
      try { errBody = await res.json(); } catch { /* ignore parse error */ }
      // Nunca incluir token ou credenciais na mensagem de erro
      throw new NuvemshopError(
        res.status,
        errBody.description || errBody.message || `HTTP ${res.status}`,
        errBody,
      );
    }

    return res.json();
  }

  /**
   * Pagina todos os resultados de um recurso usando since_id.
   *
   * @param {string}  path        Recurso a paginar (ex: 'orders', 'customers')
   * @param {object}  [params]    Filtros adicionais
   * @param {object}  [opts]
   * @param {number}  [opts.perPage]   Itens por página (máx 200)
   * @param {number}  [opts.maxItems]  Limite absoluto de itens (segurança)
   * @returns {Promise<object[]>}
   */
  async function getAllPages(path, params = {}, opts = {}) {
    const perPage  = Math.min(opts.perPage ?? 50, PAGE_SIZE_MAX);
    const maxItems = opts.maxItems ?? 10_000;
    const results  = [];
    let sinceId    = 0;

    while (results.length < maxItems) {
      const pageParams = {
        ...params,
        per_page: perPage,
        ...(sinceId > 0 ? { since_id: sinceId } : {}),
      };

      const page = await request('GET', path, { params: pageParams });

      if (!Array.isArray(page) || page.length === 0) break;

      results.push(...page);

      if (page.length < perPage) break; // Última página

      sinceId = page[page.length - 1].id;
    }

    return results;
  }

  return {
    /** GET {path}?{params} */
    get:  (path, params)  => request('GET',    path, { params }),
    /** POST {path} com body JSON */
    post: (path, body)    => request('POST',   path, { body }),
    /** PUT {path} com body JSON */
    put:  (path, body)    => request('PUT',    path, { body }),
    /** DELETE {path} */
    delete: (path)        => request('DELETE', path),
    /** Pagina todos os registros via since_id */
    getAllPages,
  };
}
