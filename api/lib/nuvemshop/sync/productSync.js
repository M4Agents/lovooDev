// =============================================================================
// productSync — Sync Service de Produtos e Variantes Nuvemshop
//
// Responsabilidade exclusiva: operações de escrita em products e
// enqueue na nuvemshop_media_queue. NÃO faz chamadas à API Nuvemshop.
//
// ── Estratégia de identidade ─────────────────────────────────────────────────
// external_source = 'nuvemshop'  (padrão existente da tabela products)
// external_id     = String(product.id)
// external_reference = SKU da variante principal ou product.sku
//
// Upsert: ON CONFLICT (company_id, external_source, external_id) DO UPDATE
// Habilitado pela constraint uq_products_external (Migration 20260803340000).
//
// ── Variantes ────────────────────────────────────────────────────────────────
// Armazenadas em nuvemshop_variants (JSONB). Cada entrada contém:
//   { id, sku, price, promotional_price, stock_management, stock, attributes,
//     weight, position }
// O campo 'id' é preservado para localização por variant_id em
// opportunity_items (Fase 8+).
//
// ── Categorias (todas preservadas) ────────────────────────────────────────────
// Nuvemshop associa um produto a múltiplas categorias. Todas são preservadas:
//   nuvemshop_categories JSONB → array de nuvemshop_category_id (strings)
//
// Para a FK category_id: lookup de todas as categorias do produto.
// Usa a primeira encontrada no banco como categoria principal.
// Categorias não sincronizadas: log estruturado, product salvo sem category_id.
// A reconciliação (Fase 16) resolverá os vínculos pendentes via nuvemshop_categories.
//
// Nenhuma categoria é criada automaticamente por este serviço.
//
// ── Soft Delete ──────────────────────────────────────────────────────────────
// NUNCA excluir fisicamente produtos.
// is_active = false, nuvemshop_sync_status = 'deleted', availability_status = 'discontinued'.
// UUID interno preservado. Reativação via upsertProduct (ON CONFLICT por external_id).
//
// ── Mídias ───────────────────────────────────────────────────────────────────
// Fase 6: apenas enqueue idempotente em nuvemshop_media_queue.
// Download e upload serão implementados na Fase 7 (media worker).
// =============================================================================

import { getSupabaseAdmin } from '../../automation/supabaseAdmin.js';

const EXTERNAL_SOURCE = 'nuvemshop';

// ── Mapeamento de status ───────────────────────────────────────────────────────

function mapAvailabilityStatus(product) {
  if (!product.published) return 'unavailable';
  if (product.stock_management && (product.stock ?? 0) === 0) return 'on_demand';
  return 'available';
}

function mapStockStatus(product) {
  if (!product.stock_management) return 'unknown';
  return (product.stock ?? 0) > 0 ? 'in_stock' : 'out_of_stock';
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function extractMultilingual(obj) {
  if (!obj || typeof obj !== 'object') {
    return typeof obj === 'string' ? obj : null;
  }
  return obj.pt ?? obj.es ?? obj.en
    ?? Object.values(obj).find(v => v && typeof v === 'string')
    ?? null;
}

/**
 * Remove tags HTML e decodifica entidades HTML para texto limpo.
 * A Nuvemshop retorna description como HTML bruto (ex: <p>&eacute;</p>).
 * O campo description do CRM é texto puro — sem markup.
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return html;

  // Tabela de entidades HTML comuns (incluindo português)
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&apos;': "'", '&nbsp;': ' ',
    '&agrave;': 'à', '&aacute;': 'á', '&acirc;': 'â', '&atilde;': 'ã', '&auml;': 'ä',
    '&egrave;': 'è', '&eacute;': 'é', '&ecirc;': 'ê', '&euml;': 'ë',
    '&igrave;': 'ì', '&iacute;': 'í', '&icirc;': 'î', '&iuml;': 'ï',
    '&ograve;': 'ò', '&oacute;': 'ó', '&ocirc;': 'ô', '&otilde;': 'õ', '&ouml;': 'ö',
    '&ugrave;': 'ù', '&uacute;': 'ú', '&ucirc;': 'û', '&uuml;': 'ü',
    '&ccedil;': 'ç', '&ntilde;': 'ñ',
    '&Agrave;': 'À', '&Aacute;': 'Á', '&Acirc;': 'Â', '&Atilde;': 'Ã',
    '&Eacute;': 'É', '&Ecirc;': 'Ê',
    '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Ocirc;': 'Ô', '&Otilde;': 'Õ',
    '&Uacute;': 'Ú', '&Ccedil;': 'Ç',
    '&laquo;': '«', '&raquo;': '»', '&mdash;': '—', '&ndash;': '–',
    '&ldquo;': '\u201C', '&rdquo;': '\u201D', '&lsquo;': '\u2018', '&rsquo;': '\u2019',
    '&hellip;': '…', '&trade;': '™', '&copy;': '©', '&reg;': '®',
  };

  return html
    // Substituir <br>, <p>, <div>, <li> por quebra de linha antes de remover tags
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    // Remover todas as tags HTML restantes
    .replace(/<[^>]+>/g, '')
    // Decodificar entidades nomeadas
    .replace(/&[a-zA-Z]+;/g, match => entities[match] ?? match)
    // Decodificar entidades numéricas (ex: &#233; → é, &#xE9; → é)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    // Normalizar espaços e quebras de linha
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeVariants(variants) {
  if (!Array.isArray(variants)) return [];

  return variants.map(v => ({
    id:                v.id,
    sku:               v.sku  || null,
    price:             v.price             ? parseFloat(v.price)             : null,
    promotional_price: v.promotional_price ? parseFloat(v.promotional_price) : null,
    stock_management:  v.stock_management  ?? false,
    stock:             v.stock_management  ? (v.quantity ?? 0) : null,
    attributes:        (v.values ?? []).map(val => extractMultilingual(val)).filter(Boolean),
    weight:            v.weight ? parseFloat(v.weight) : null,
    position:          v.position ?? 0,
  }));
}

function extractMainSku(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const first    = variants.find(v => v.position === 0) ?? variants[0];
  return first?.sku || product.sku || null;
}

function extractDefaultPrice(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0) {
    const prices = variants
      .map(v => parseFloat(v.price ?? '0'))
      .filter(p => !isNaN(p) && p >= 0);
    if (prices.length > 0) return Math.min(...prices);
  }
  const price = parseFloat(product.price ?? '0');
  return isNaN(price) || price < 0 ? 0 : price;
}

// ── Resolução de categorias ────────────────────────────────────────────────────

/**
 * Busca todos os nuvemshop_category_ids do produto no banco.
 * Retorna o UUID interno da primeira categoria encontrada (categoria principal).
 * Todas as categorias não sincronizadas são logadas.
 *
 * @param {{ svc, companyId, categories: Array, nuvemshopProductId: string }}
 * @returns {Promise<{ primaryCategoryId: string|null, nuvemshopCategoryIds: string[] }>}
 */
async function resolveCategories({ svc, companyId, categories, nuvemshopProductId }) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return { primaryCategoryId: null, nuvemshopCategoryIds: [] };
  }

  // Todos os nuvemshop_category_id associados ao produto
  const nuvemshopCategoryIds = categories.map(c => String(c.id));

  // Lookup de todas as categorias em uma única query
  const { data: found, error } = await svc
    .from('catalog_categories')
    .select('id, nuvemshop_category_id')
    .eq('company_id', companyId)
    .in('nuvemshop_category_id', nuvemshopCategoryIds)
    .eq('is_active', true);

  if (error) {
    console.warn(JSON.stringify({
      level:               'warn',
      event:               'product_categories_lookup_error',
      nuvemshop_product_id: nuvemshopProductId,
      company_id:          companyId,
      error:               error.message,
    }));
    return { primaryCategoryId: null, nuvemshopCategoryIds };
  }

  const foundIds = new Set((found ?? []).map(c => c.nuvemshop_category_id));

  // Registrar categorias ainda não sincronizadas
  const notSynced = nuvemshopCategoryIds.filter(id => !foundIds.has(id));
  if (notSynced.length > 0) {
    console.log(JSON.stringify({
      level:               'info',
      event:               'product_categories_not_synced_yet',
      nuvemshop_product_id: nuvemshopProductId,
      company_id:          companyId,
      not_synced:          notSynced,
      resolution:          'nuvemshop_categories_stored_reconciliation_will_link_category_id',
    }));
  }

  // Categoria principal: primeira do array original que já exista no banco
  let primaryCategoryId = null;
  for (const nsCatId of nuvemshopCategoryIds) {
    const match = (found ?? []).find(c => c.nuvemshop_category_id === nsCatId);
    if (match) { primaryCategoryId = match.id; break; }
  }

  return { primaryCategoryId, nuvemshopCategoryIds };
}

// ── Enqueue de mídias ─────────────────────────────────────────────────────────

/**
 * Enfileira imagens na nuvemshop_media_queue de forma idempotente.
 * Falha não bloqueia o upsert do produto (pipeline independente).
 */
async function enqueueProductMedia({ svc, companyId, storeId, nuvemshopProductId, productUuid, images }) {
  if (!Array.isArray(images) || images.length === 0) return;

  const rows = images
    .filter(img => img?.id && img?.src)
    .map(img => ({
      company_id:           companyId,
      store_id:             storeId,
      product_id:           productUuid,
      nuvemshop_product_id: String(nuvemshopProductId),
      nuvemshop_image_id:   String(img.id),
      source_url:           img.src,
      position:             img.position ?? 0,
      status:               'pending',
      idempotency_key:      `${companyId}:${nuvemshopProductId}:${img.id}`,
    }));

  if (rows.length === 0) return;

  const { error } = await svc
    .from('nuvemshop_media_queue')
    .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true });

  if (error) {
    console.warn(JSON.stringify({
      level:               'warn',
      event:               'product_media_enqueue_error',
      nuvemshop_product_id: nuvemshopProductId,
      company_id:          companyId,
      images_count:        rows.length,
      error:               error.message,
    }));
  }
}

// ── upsertProduct ─────────────────────────────────────────────────────────────

/**
 * Cria ou atualiza um produto sincronizado da Nuvemshop.
 *
 * Também:
 *  - Preserva todos os nuvemshop_category_ids em nuvemshop_categories JSONB
 *  - Associa a categoria principal (primeiro match no banco)
 *  - Enfileira imagens na nuvemshop_media_queue (idempotente)
 *
 * @param {{
 *   companyId:   string,
 *   storeId:     string,
 *   productData: object,  // Objeto completo retornado pela API Nuvemshop
 *   svc?:        object
 * }} params
 * @returns {Promise<{ ok: boolean, productUuid: string, action: 'created'|'updated' }>}
 */
export async function upsertProduct({ companyId, storeId, productData, svc: _svc }) {
  const svc         = _svc ?? getSupabaseAdmin();
  const nuvemshopId = String(productData.id);
  const now         = new Date().toISOString();

  // ── Resolver categorias (todas preservadas) ────────────────────────────────
  const { primaryCategoryId, nuvemshopCategoryIds } = await resolveCategories({
    svc,
    companyId,
    categories:          productData.categories ?? [],
    nuvemshopProductId:  nuvemshopId,
  });

  // ── Normalizar variantes ───────────────────────────────────────────────────
  const variants     = normalizeVariants(productData.variants);
  const mainSku      = extractMainSku(productData);
  const defaultPrice = extractDefaultPrice(productData);

  // ── Montar row ────────────────────────────────────────────────────────────
  const productRow = {
    company_id:            companyId,
    external_source:       EXTERNAL_SOURCE,
    external_id:           nuvemshopId,
    external_reference:    mainSku,

    name:                  extractMultilingual(productData.name) ?? `Produto #${nuvemshopId}`,
    description:           stripHtml(extractMultilingual(productData.description)) ?? null,
    default_price:         defaultPrice,

    is_active:             productData.published ?? true,
    availability_status:   mapAvailabilityStatus(productData),
    stock_status:          mapStockStatus(productData),
    track_inventory:       productData.stock_management ?? false,

    nuvemshop_store_id:    storeId,
    nuvemshop_sync_status: 'synced',
    nuvemshop_variants:    variants.length > 0 ? variants : null,

    // Todas as categorias Nuvemshop do produto (para reconciliação)
    nuvemshop_categories:  nuvemshopCategoryIds.length > 0 ? nuvemshopCategoryIds : null,

    updated_at:            now,
  };

  // category_id apenas se categoria encontrada no banco
  if (primaryCategoryId !== null) {
    productRow.category_id = primaryCategoryId;
  }

  const { data: upserted, error } = await svc
    .from('products')
    .upsert(productRow, { onConflict: 'company_id,external_source,external_id' })
    .select('id, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(`[productSync.upsertProduct] DB error: ${error.message} (code=${error.code})`);
  }

  const isNew = Math.abs(
    new Date(upserted.created_at).getTime() - new Date(upserted.updated_at).getTime()
  ) < 2000;

  // ── Enfileirar mídias (pipeline independente) ─────────────────────────────
  await enqueueProductMedia({
    svc,
    companyId,
    storeId,
    nuvemshopProductId: nuvemshopId,
    productUuid:        upserted.id,
    images:             productData.images ?? [],
  });

  return { ok: true, productUuid: upserted.id, action: isNew ? 'created' : 'updated' };
}

// ── softDeleteProduct ─────────────────────────────────────────────────────────

/**
 * Marca um produto como deletado (soft delete). NUNCA executa DELETE físico.
 *
 * UUID interno preservado. Reativação via upsertProduct (ON CONFLICT por external_id).
 * Histórico em opportunity_items permanece válido.
 *
 * Idempotente: se não encontrado, retorna ok: true, found: false.
 *
 * @param {{
 *   companyId:          string,
 *   storeId:            string,
 *   nuvemshopProductId: string,
 *   svc?:               object
 * }} params
 * @returns {Promise<{ ok: boolean, found: boolean }>}
 */
export async function softDeleteProduct({ companyId, storeId, nuvemshopProductId, svc: _svc }) {
  const svc = _svc ?? getSupabaseAdmin();
  const now = new Date().toISOString();

  const { data: updated, error } = await svc
    .from('products')
    .update({
      is_active:             false,
      nuvemshop_sync_status: 'deleted',
      availability_status:   'discontinued',
      updated_at:            now,
    })
    .eq('company_id', companyId)
    .eq('external_source', EXTERNAL_SOURCE)
    .eq('external_id', String(nuvemshopProductId))
    .eq('nuvemshop_store_id', storeId)
    .select('id');

  if (error) {
    throw new Error(`[productSync.softDeleteProduct] DB error: ${error.message}`);
  }

  return { ok: true, found: (updated?.length ?? 0) > 0 };
}
