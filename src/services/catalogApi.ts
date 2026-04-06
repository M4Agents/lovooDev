/**
 * CRUD catálogo produtos/serviços — RLS por tenant.
 *
 * Relacionamentos (`catalog_item_relations`):
 * - Persistência: apenas vínculo origem→destino, tipo (`alternative` | `addon`) e `sort_order`.
 * - Consumo (agente de IA / automações): aplicar aqui ou na camada de prompt:
 *   - Ignorar destinos com `is_active === false` ou `available_for_ai === false` quando o contexto for IA.
 *   - Respeitar `availability_status` (ex.: sugerir só `available` / `on_demand` em vendas).
 *   - Ordenar por `sort_order` ascendente (menor = maior prioridade); limitar quantidade sugerida (ex.: top 3–5).
 *   - `alternative`: substitutos quando o item de origem não serve; `addon`: complementos.
 *   - Se a lista filtrada ficar vazia, usar só `ai_unavailable_guidance` / texto do item, sem inventar catálogo.
 */

import { supabase } from '../lib/supabase'
import type {
  CatalogItemRelation,
  CatalogProduct,
  CatalogRelationResolvedRow,
  CatalogRelationType,
  CatalogService,
} from '../types/sales-funnel'

export const catalogApi = {
  async getProducts(companyId: string): Promise<CatalogProduct[]> {
    const { data, error } = await supabase
      .from('products')
      .select('*, catalog_categories(name)')
      .eq('company_id', companyId)
      .order('name')
    if (error) throw error
    return (data || []) as CatalogProduct[]
  },

  async getServices(companyId: string): Promise<CatalogService[]> {
    const { data, error } = await supabase
      .from('services')
      .select('*, catalog_categories(name)')
      .eq('company_id', companyId)
      .order('name')
    if (error) throw error
    return (data || []) as CatalogService[]
  },

  async createProduct(
    companyId: string,
    row: Partial<CatalogProduct> & { name: string; default_price: number }
  ): Promise<CatalogProduct> {
    const { data, error } = await supabase
      .from('products')
      .insert({
        company_id: companyId,
        name: row.name,
        description: row.description ?? null,
        default_price: row.default_price,
        category_id: row.category_id ?? null,
        is_active: row.is_active ?? true,
        availability_status: row.availability_status ?? 'available',
        stock_status: row.stock_status ?? 'unknown',
        track_inventory: row.track_inventory ?? false,
        ai_notes: row.ai_notes ?? null,
        ai_unavailable_guidance: row.ai_unavailable_guidance ?? null,
        available_for_ai: row.available_for_ai ?? true,
      })
      .select()
      .single()
    if (error) throw error
    return data as CatalogProduct
  },

  async updateProduct(id: string, patch: Partial<CatalogProduct>): Promise<CatalogProduct> {
    const { data, error } = await supabase
      .from('products')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as CatalogProduct
  },

  async createService(
    companyId: string,
    row: Partial<CatalogService> & { name: string; default_price: number }
  ): Promise<CatalogService> {
    const { data, error } = await supabase
      .from('services')
      .insert({
        company_id: companyId,
        name: row.name,
        description: row.description ?? null,
        default_price: row.default_price,
        category_id: row.category_id ?? null,
        is_active: row.is_active ?? true,
        availability_status: row.availability_status ?? 'available',
        stock_status: row.stock_status ?? 'not_applicable',
        track_inventory: false,
        ai_notes: row.ai_notes ?? null,
        ai_unavailable_guidance: row.ai_unavailable_guidance ?? null,
        available_for_ai: row.available_for_ai ?? true,
      })
      .select()
      .single()
    if (error) throw error
    return data as CatalogService
  },

  async updateService(id: string, patch: Partial<CatalogService>): Promise<CatalogService> {
    const { data, error } = await supabase
      .from('services')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as CatalogService
  },

  async getOpportunityItemsEntitlement(companyId: string): Promise<{
    allowed: boolean
    plan?: string
    company_enabled?: boolean
    plan_ok?: boolean
  }> {
    const { data, error } = await supabase.rpc('get_opportunity_items_entitlement', {
      p_company_id: companyId,
    })
    if (error) throw error
    const d = data as Record<string, unknown> | null
    return {
      allowed: Boolean(d?.allowed),
      plan: d?.plan as string | undefined,
      company_enabled: d?.company_enabled as boolean | undefined,
      plan_ok: d?.plan_ok as boolean | undefined,
    }
  },

  async setCompanyOpportunityItemsEnabled(companyId: string, enabled: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_company_opportunity_items_enabled', {
      p_company_id: companyId,
      p_enabled: enabled,
    })
    if (error) throw error
  },

  /**
   * Lista relações a partir de um item de origem, com destino resolvido (RPC `list_catalog_relations_for_source`).
   * Ordenação no banco: `sort_order ASC`, depois `created_at ASC`.
   * O consumidor (agente/UI) filtra `is_active` / `available_for_ai` / disponibilidade e pode limitar quantidade (ver comentário do módulo).
   */
  async listCatalogRelationsForSource(
    companyId: string,
    sourceType: 'product' | 'service',
    sourceId: string,
    relationType: CatalogRelationType
  ): Promise<CatalogRelationResolvedRow[]> {
    const { data, error } = await supabase.rpc('list_catalog_relations_for_source', {
      p_company_id: companyId,
      p_source_type: sourceType,
      p_source_id: sourceId,
      p_relation_type: relationType,
    })
    if (error) throw error
    const rows = (data || []) as Record<string, unknown>[]
    return rows.map((r) => ({
      relation_id: String(r.relation_id),
      sort_order: Number(r.sort_order),
      target_kind: r.target_kind === 'service' ? 'service' : 'product',
      target_id: String(r.target_id),
      name: String(r.name ?? ''),
      description: r.description != null ? String(r.description) : null,
      availability_status: String(r.availability_status ?? ''),
      is_active: Boolean(r.is_active),
      available_for_ai: Boolean(r.available_for_ai),
      default_price: Number(r.default_price ?? 0),
    }))
  },

  async createCatalogItemRelation(params: {
    companyId: string
    relationType: CatalogRelationType
    sourceProductId: string | null
    sourceServiceId: string | null
    targetProductId: string | null
    targetServiceId: string | null
    sortOrder?: number
  }): Promise<CatalogItemRelation> {
    const { data, error } = await supabase
      .from('catalog_item_relations')
      .insert({
        company_id: params.companyId,
        relation_type: params.relationType,
        source_product_id: params.sourceProductId,
        source_service_id: params.sourceServiceId,
        target_product_id: params.targetProductId,
        target_service_id: params.targetServiceId,
        sort_order: params.sortOrder ?? 0,
      })
      .select()
      .single()
    if (error) throw error
    return data as CatalogItemRelation
  },

  async updateCatalogItemRelationSortOrder(
    relationId: string,
    sortOrder: number
  ): Promise<CatalogItemRelation> {
    const { data, error } = await supabase
      .from('catalog_item_relations')
      .update({ sort_order: sortOrder })
      .eq('id', relationId)
      .select()
      .single()
    if (error) throw error
    return data as CatalogItemRelation
  },

  async deleteCatalogItemRelation(relationId: string): Promise<void> {
    const { error } = await supabase.from('catalog_item_relations').delete().eq('id', relationId)
    if (error) throw error
  },
}
