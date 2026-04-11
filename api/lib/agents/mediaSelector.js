// =============================================================================
// api/lib/agents/mediaSelector.js
//
// Seleção de mídias do catálogo para envio pelo agente (send_media).
// Ordenação exclusiva em catalog_item_media:
//   ORDER BY sort_order ASC, created_at ASC, id ASC
// Sem priorização por media_type. Multi-tenant: company_id obrigatório.
// =============================================================================

import { INTENT_TO_USAGE_ROLE } from './mediaConstants.js'

/** @typedef {'product'|'service'} ItemType */

const GLOBAL_FALLBACK_TODO = false // Fase futura: company_ai_media

/**
 * @param {string} intent
 * @returns {string|null}
 */
function usageRoleForIntent(intent) {
  if (intent == null || typeof intent !== 'string') return null
  return INTENT_TO_USAGE_ROLE[intent] ?? null
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {object} params
 * @param {string} params.company_id
 * @param {ItemType} params.item_type
 * @param {string} params.item_id
 * @param {string} params.intent - chave de INTENT_TO_USAGE_ROLE
 * @param {string[]} params.alreadySentAssetIds
 * @param {number} params.limit
 * @returns {Promise<Array<{ asset_id: string, url: string, type: string }>>}
 */
export async function mediaSelector(svc, params) {
  const {
    company_id: companyId,
    item_type: itemType,
    item_id: itemId,
    intent,
    alreadySentAssetIds = [],
    limit: rawLimit,
  } = params

  const limit = Math.max(0, Math.min(Number(rawLimit) || 0, 100))
  if (!svc || !companyId || !itemId || limit === 0) return []

  const usageRole = usageRoleForIntent(intent)
  if (!usageRole) return []

  const sent = new Set((alreadySentAssetIds || []).filter(Boolean))

  const fkCol = itemType === 'product' ? 'product_id' : 'service_id'
  const tableName = itemType === 'product' ? 'products' : 'services'

  const picked = []
  const seen = new Set()

  /**
   * Ordenação determinística obrigatória (produto/serviço e fallback categoria).
   */
  async function fetchOrderedRows(filterCol, filterVal) {
    const { data, error } = await svc
      .from('catalog_item_media')
      .select('id, library_asset_id, media_type, sort_order, created_at')
      .eq('company_id', companyId)
      .eq(filterCol, filterVal)
      .eq('usage_role', usageRole)
      .eq('is_active', true)
      .eq('use_in_ai', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (error) {
      console.error('[mediaSelector] catalog_item_media:', error.message)
      return []
    }
    return data ?? []
  }

  async function resolveUrls(assetIds) {
    if (assetIds.length === 0) return new Map()
    const { data: libRows, error } = await svc
      .from('company_media_library')
      .select('id, preview_url')
      .eq('company_id', companyId)
      .in('id', assetIds)

    if (error) {
      console.error('[mediaSelector] company_media_library:', error.message)
      return new Map()
    }
    const m = new Map()
    for (const row of libRows ?? []) {
      if (row.preview_url) m.set(row.id, row.preview_url)
    }
    return m
  }

  function takeFromRows(rows, cap) {
    for (const row of rows) {
      if (picked.length >= cap) break
      const aid = row.library_asset_id
      if (!aid || sent.has(aid) || seen.has(aid)) continue
      seen.add(aid)
      picked.push({
        asset_id: aid,
        media_type: row.media_type,
      })
    }
  }

  // Passo 1 — vínculo direto ao item
  const primaryRows = await fetchOrderedRows(fkCol, itemId)
  takeFromRows(primaryRows, limit)

  // Passo 2 — fallback por categoria (mesmo tipo produto/serviço); ordem de cada query = fetchOrderedRows
  if (picked.length < limit && !GLOBAL_FALLBACK_TODO) {
    const { data: itemRow, error: catErr } = await svc
      .from(tableName)
      .select('category')
      .eq('id', itemId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (!catErr && itemRow?.category) {
      const { data: siblings, error: sibErr } = await svc
        .from(tableName)
        .select('id')
        .eq('company_id', companyId)
        .eq('category', itemRow.category)
        .neq('id', itemId)
        .order('id', { ascending: true })

      if (!sibErr && siblings?.length) {
        for (const s of siblings) {
          if (picked.length >= limit) break
          const rows = await fetchOrderedRows(fkCol, s.id)
          takeFromRows(rows, limit)
        }
      }
    }
  }

  if (GLOBAL_FALLBACK_TODO) {
    // TODO: company_ai_media — mesma ordenação sort_order, created_at, id
  }

  const slice = picked.slice(0, limit)
  const urlMap = await resolveUrls(slice.map(p => p.asset_id))

  const out = []
  for (const p of slice) {
    const url = urlMap.get(p.asset_id)
    if (!url) continue
    out.push({
      asset_id: p.asset_id,
      url,
      type: p.media_type === 'video' ? 'video' : 'image',
    })
  }
  return out
}
