// =============================================================================
// couponSync — Sync Service de Cupons Nuvemshop
//
// Responsabilidade: centralizar toda a lógica de cupons entre o CRM e a
// Nuvemshop. Endpoints delegam aqui; nenhuma chamada direta de endpoints
// à API Nuvemshop.
//
// ── Fonte de verdade ──────────────────────────────────────────────────────────
// A Nuvemshop é a fonte de verdade para cupons. Não existe tabela local.
// As operações são sempre proxy para a API Nuvemshop via nuvemshopClient.
//
// ── Operações disponíveis ─────────────────────────────────────────────────────
//   createCoupon → POST /coupons  — valida dados + cria na Nuvemshop
//   listCoupons  → GET  /coupons  — lista cupons ativos com paginação
//
// ── Validação ────────────────────────────────────────────────────────────────
// Validação de campos obrigatórios e regras de negócio é feita aqui,
// ANTES de qualquer chamada à API. Erros de validação retornam sem chamada.
//
// ── Tratamento de erros específicos ──────────────────────────────────────────
//   422 + description.code includes "taken"  → cupom já existe → 409 (Conflict)
//   422 + outros campos                      → dados inválidos → 422
//   401/403              → token inválido/expirado
//   429                  → rate limit (cliente pode retransmitir)
//   5xx                  → falha temporária da API
//
// ── Segurança ────────────────────────────────────────────────────────────────
//   - company_id e store_id obrigatórios em todas as operações de banco
//   - Validação de conexão ativa antes de qualquer chamada à API
//   - Nenhum dado sensível retornado (token nunca exposto)
// =============================================================================

import { getSupabaseAdmin }       from '../automation/supabaseAdmin.js';
import { decryptToken }           from './tokenCrypto.js';
import { createNuvemshopClient }  from './nuvemshopClient.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const COUPON_TYPES         = ['percentage', 'absolute', 'shipping'];
const MAX_LIST_PER_PAGE    = 50;
const MAX_CODE_LENGTH      = 50;
const MIN_CODE_LENGTH      = 3;
const CODE_REGEX           = /^[A-Za-z0-9_-]+$/;

// ── Resolução de conexão ──────────────────────────────────────────────────────

/**
 * Busca conexão ativa e retorna client Nuvemshop pronto para uso.
 * Lança erro descritivo se não encontrada.
 */
async function resolveClient({ svc, companyId, storeId, correlationId }) {
  const { data: conn, error } = await svc
    .from('nuvemshop_connections')
    .select('id, encrypted_access_token, status')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw { code: 'db_error', message: error.message, status: 500 };

  if (!conn) {
    throw {
      code:    'connection_not_found',
      message: 'Integração Nuvemshop não encontrada ou inativa para esta empresa.',
      status:  404,
    };
  }

  let accessToken;
  try {
    accessToken = decryptToken(conn.encrypted_access_token);
  } catch {
    throw { code: 'token_decrypt_error', message: 'Erro interno de configuração.', status: 500 };
  }

  const client = createNuvemshopClient({ storeId, accessToken, correlationId });
  return { client, connectionId: conn.id };
}

// ── Validação de cupom ────────────────────────────────────────────────────────

/**
 * Valida os campos de um cupom antes de enviá-los à API Nuvemshop.
 *
 * @param {object} data  Dados do cupom a criar
 * @throws {{ code, message, status, field? }}
 */
function validateCouponData(data) {
  const { code, type, value } = data;

  if (!code?.trim()) {
    throw { code: 'validation_error', message: 'O código do cupom é obrigatório.', field: 'code', status: 400 };
  }
  const cleanCode = code.trim().toUpperCase();
  if (cleanCode.length < MIN_CODE_LENGTH || cleanCode.length > MAX_CODE_LENGTH) {
    throw {
      code:    'validation_error',
      message: `O código deve ter entre ${MIN_CODE_LENGTH} e ${MAX_CODE_LENGTH} caracteres.`,
      field:   'code', status: 400,
    };
  }
  if (!CODE_REGEX.test(cleanCode)) {
    throw {
      code:    'validation_error',
      message: 'O código aceita apenas letras, números, hífen e underscore.',
      field:   'code', status: 400,
    };
  }

  if (!type || !COUPON_TYPES.includes(type)) {
    throw {
      code:    'validation_error',
      message: `O tipo do cupom deve ser um de: ${COUPON_TYPES.join(', ')}.`,
      field:   'type', status: 400,
    };
  }

  const numValue = Number(value);
  if (isNaN(numValue) || numValue <= 0) {
    throw { code: 'validation_error', message: 'O valor deve ser um número positivo.', field: 'value', status: 400 };
  }
  if (type === 'percentage' && numValue > 100) {
    throw {
      code:    'validation_error',
      message: 'O desconto percentual não pode ultrapassar 100%.',
      field:   'value', status: 400,
    };
  }

  if (data.max_uses !== undefined && data.max_uses !== null) {
    const maxUses = Number(data.max_uses);
    if (!Number.isInteger(maxUses) || maxUses < 1) {
      throw { code: 'validation_error', message: 'max_uses deve ser um inteiro positivo.', field: 'max_uses', status: 400 };
    }
  }

  if (data.start_date && isNaN(Date.parse(data.start_date))) {
    throw { code: 'validation_error', message: 'start_date deve ser uma data válida (YYYY-MM-DD).', field: 'start_date', status: 400 };
  }
  if (data.end_date && isNaN(Date.parse(data.end_date))) {
    throw { code: 'validation_error', message: 'end_date deve ser uma data válida (YYYY-MM-DD).', field: 'end_date', status: 400 };
  }
  if (data.start_date && data.end_date && new Date(data.start_date) > new Date(data.end_date)) {
    throw { code: 'validation_error', message: 'A data de início não pode ser posterior à data de fim.', field: 'end_date', status: 400 };
  }

  return cleanCode;  // Retorna código normalizado
}

// ── Mapeamento de erros da API ────────────────────────────────────────────────

/**
 * Determina se um erro 422 da Nuvemshop é uma duplicidade de código.
 *
 * A Nuvemshop retorna 422 para dois cenários distintos:
 *   (A) Duplicidade de código:
 *       { description: { code: ["has already been taken"] } }
 *   (B) Validação genérica de campo:
 *       { description: { value: ["must be greater than 0"] } }
 *
 * Apenas o cenário (A) deve ser mapeado para 409 (Conflict).
 * O cenário (B) é uma falha de validação e deve retornar 422.
 */
function is422Duplicate(err) {
  const desc =
    err?.body?.description ??
    err?.data?.description ??
    err?.response?.description ??
    {};

  const codeErrors = Array.isArray(desc?.code) ? desc.code : [];
  return codeErrors.some(
    (msg) =>
      typeof msg === 'string' &&
      (msg.toLowerCase().includes('taken') || msg.toLowerCase().includes('already')),
  );
}

function mapApiError(err) {
  const status = err?.status ?? 500;

  if (status === 422) {
    if (is422Duplicate(err)) {
      return {
        code:    'coupon_code_exists',
        message: 'Este código de cupom já existe na loja. Escolha um código diferente.',
        status:  409,
      };
    }
    // Outra validação recusada pela Nuvemshop (campo com valor inválido, regra de negócio etc.)
    return {
      code:    'coupon_invalid_data',
      message: 'Os dados do cupom são inválidos segundo a Nuvemshop. Verifique os campos e tente novamente.',
      status:  422,
    };
  }
  if (status === 401 || status === 403) {
    return {
      code:    'token_invalid',
      message: 'O token de acesso à Nuvemshop é inválido ou expirou.',
      status:  401,
    };
  }
  if (status === 429) {
    return {
      code:    'rate_limit',
      message: 'Limite de requisições atingido. Tente novamente em instantes.',
      status:  429,
    };
  }
  return {
    code:    'api_error',
    message: 'Falha temporária na API Nuvemshop. Tente novamente.',
    status:  502,
  };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Cria um cupom na loja Nuvemshop.
 *
 * @param {{
 *   companyId:     string,
 *   storeId:       string,
 *   couponData: {
 *     code:              string,   Obrigatório
 *     type:              string,   'percentage'|'absolute'|'shipping'
 *     value:             number,   Obrigatório, positivo
 *     max_uses?:         number|null,
 *     valid?:            boolean,
 *     start_date?:       string,   YYYY-MM-DD
 *     end_date?:         string,   YYYY-MM-DD
 *     min_price?:        number|null,
 *     includes_shipping?: boolean,
 *   },
 *   userId:        string,         Para log de auditoria
 *   correlationId?: string,
 *   svc?:          object
 * }} params
 * @returns {Promise<{ ok: true, coupon: object } | { ok: false, error: object }>}
 */
export async function createCoupon({ companyId, storeId, couponData, userId, correlationId, svc: _svc }) {
  const svc = _svc ?? getSupabaseAdmin();

  // 1. Validar campos antes de qualquer chamada
  let normalizedCode;
  try {
    normalizedCode = validateCouponData(couponData);
  } catch (err) {
    return { ok: false, error: err };
  }

  // 2. Resolver conexão ativa
  let client;
  try {
    ({ client } = await resolveClient({ svc, companyId, storeId, correlationId }));
  } catch (err) {
    return { ok: false, error: err };
  }

  // 3. Montar payload seguro para a API (apenas campos permitidos)
  const payload = {
    code:              normalizedCode,
    type:              couponData.type,
    value:             String(Number(couponData.value)),
    max_uses:          couponData.max_uses ?? null,
    valid:             couponData.valid !== false,  // default true
    start_date:        couponData.start_date        ?? null,
    end_date:          couponData.end_date          ?? null,
    min_price:         couponData.min_price != null ? String(Number(couponData.min_price)) : null,
    includes_shipping: couponData.includes_shipping ?? false,
  };

  // 4. Chamar API
  let created;
  try {
    created = await client.post('coupons', payload);
  } catch (err) {
    const mappedError = mapApiError(err);
    console.warn(JSON.stringify({
      level:          'warn',
      event:          'coupon_create_failed',
      company_id:     companyId,
      store_id:       storeId,
      error_code:     mappedError.code,
      user_id:        userId,
      correlation_id: correlationId,
    }));
    return { ok: false, error: mappedError };
  }

  console.info(JSON.stringify({
    level:          'info',
    event:          'coupon_created',
    company_id:     companyId,
    store_id:       storeId,
    coupon_id:      created?.id,
    coupon_code:    normalizedCode,
    coupon_type:    couponData.type,
    user_id:        userId,
    correlation_id: correlationId,
  }));

  return { ok: true, coupon: sanitizeCoupon(created) };
}

/**
 * Lista cupons da loja Nuvemshop.
 *
 * @param {{
 *   companyId:     string,
 *   storeId:       string,
 *   page?:         number,   Página (default 1)
 *   perPage?:      number,   Itens por página (default 20, max 50)
 *   correlationId?: string,
 *   svc?:          object
 * }} params
 * @returns {Promise<{ ok: true, coupons: object[], page: number } | { ok: false, error: object }>}
 */
export async function listCoupons({ companyId, storeId, page = 1, perPage = 20, correlationId, svc: _svc }) {
  const svc = _svc ?? getSupabaseAdmin();

  // Resolver conexão ativa
  let client;
  try {
    ({ client } = await resolveClient({ svc, companyId, storeId, correlationId }));
  } catch (err) {
    return { ok: false, error: err };
  }

  const safePage    = Math.max(1, parseInt(page, 10) || 1);
  const safePerPage = Math.min(MAX_LIST_PER_PAGE, Math.max(1, parseInt(perPage, 10) || 20));

  let raw;
  try {
    raw = await client.get(`coupons?page=${safePage}&per_page=${safePerPage}`);
  } catch (err) {
    const mappedError = mapApiError(err);
    return { ok: false, error: mappedError };
  }

  const coupons = Array.isArray(raw) ? raw.map(sanitizeCoupon) : [];

  return { ok: true, coupons, page: safePage, perPage: safePerPage };
}

// ── Sanitização da resposta ───────────────────────────────────────────────────

/**
 * Retorna apenas os campos seguros de um cupom para exibição no CRM.
 * Nunca expõe campos internos da API desnecessários.
 */
function sanitizeCoupon(coupon) {
  if (!coupon) return null;
  return {
    id:                coupon.id,
    code:              coupon.code,
    type:              coupon.type,
    value:             coupon.value,
    max_uses:          coupon.max_uses          ?? null,
    used_times:        coupon.used_times        ?? 0,
    valid:             coupon.valid             ?? true,
    start_date:        coupon.start_date        ?? null,
    end_date:          coupon.end_date          ?? null,
    min_price:         coupon.min_price         ?? null,
    includes_shipping: coupon.includes_shipping ?? false,
    created_at:        coupon.created_at        ?? null,
    updated_at:        coupon.updated_at        ?? null,
  };
}
