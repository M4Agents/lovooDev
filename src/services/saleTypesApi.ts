/**
 * Serviço de Tipos de Venda.
 *
 * CRUD de sale_types via PostgREST (RLS garante isolamento por company_id).
 * Operações de vínculo (opportunity_sale_types) passam obrigatoriamente
 * por RPCs SECURITY DEFINER — não há escrita direta pelo frontend.
 */

import { supabase } from '../lib/supabase'
import type { SaleType, OpportunitySaleTypeLink } from '../types/sales-funnel'

export type SaleTypeFilters = {
  isActive?: boolean
  name?: string
}

export const saleTypesApi = {

  // ── Listar tipos de venda ──────────────────────────
  async getSaleTypes(companyId: string, filters?: SaleTypeFilters): Promise<SaleType[]> {
    let query = supabase
      .from('sale_types')
      .select('*')
      .eq('company_id', companyId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (filters?.isActive !== undefined) {
      query = query.eq('is_active', filters.isActive)
    }
    if (filters?.name) {
      query = query.ilike('name', `%${filters.name}%`)
    }

    const { data, error } = await query
    if (error) throw error
    return (data || []) as SaleType[]
  },

  // ── Listar apenas tipos visíveis (para seletores) ─
  // Regra: custom (is_active=true) + sistema (is_active=true AND is_hidden=false)
  async getVisibleSaleTypes(companyId: string): Promise<SaleType[]> {
    const { data, error } = await supabase
      .from('sale_types')
      .select('*')
      .eq('company_id', companyId)
      .or('is_system.eq.false,is_hidden.eq.false')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error

    // Filtro secundário no cliente para garantir a regra composta:
    // custom: is_system=false AND is_active=true
    // sistema: is_system=true AND is_active=true AND is_hidden=false
    return ((data || []) as SaleType[]).filter(st =>
      (!st.is_system && st.is_active) ||
      (st.is_system && st.is_active && !st.is_hidden)
    )
  },

  // ── Criar tipo de venda ────────────────────────────
  // Campos is_system, system_key e is_hidden são ignorados — o banco bloqueia via trigger.
  async createSaleType(
    companyId: string,
    payload: { name: string; description?: string | null; sort_order?: number }
  ): Promise<SaleType> {
    const { data, error } = await supabase
      .from('sale_types')
      .insert({
        company_id:  companyId,
        name:        payload.name.trim(),
        description: payload.description ?? null,
        sort_order:  payload.sort_order ?? 1000,
      })
      .select()
      .single()

    if (error) throw error
    return data as SaleType
  },

  // ── Atualizar tipo de venda ────────────────────────
  // is_system, system_key e is_hidden nunca são enviados — protegidos via trigger.
  async updateSaleType(
    id: string,
    companyId: string,
    patch: Partial<Pick<SaleType, 'name' | 'description' | 'is_active' | 'sort_order'>>
  ): Promise<SaleType> {
    const { data, error } = await supabase
      .from('sale_types')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single()

    if (error) throw error
    return data as SaleType
  },

  // ── Ocultar / exibir tipo de sistema via RPC ──────
  async setSystemSaleTypeHidden(
    companyId: string,
    saleTypeId: string,
    isHidden: boolean
  ): Promise<void> {
    const { error } = await supabase.rpc('set_system_sale_type_hidden', {
      p_company_id:   companyId,
      p_sale_type_id: saleTypeId,
      p_is_hidden:    isHidden,
    })

    if (error) throw error
  },

  // ── Deletar tipo de venda ──────────────────────────
  // Pode falhar com FK violation se já usado em opportunity_sale_types.
  // O chamador deve tratar o erro e orientar desativação.
  async deleteSaleType(id: string, companyId: string): Promise<void> {
    const { error } = await supabase
      .from('sale_types')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)

    if (error) throw error
  },

  // ── Listar tipos vinculados a uma oportunidade ─────
  async getOpportunitySaleTypes(
    companyId: string,
    opportunityId: string
  ): Promise<OpportunitySaleTypeLink[]> {
    const { data, error } = await supabase
      .from('opportunity_sale_types')
      .select('*, sale_types(*)')
      .eq('company_id', companyId)
      .eq('opportunity_id', opportunityId)

    if (error) throw error
    return (data || []) as OpportunitySaleTypeLink[]
  },

  // ── Vincular tipo de venda via RPC ─────────────────
  async addOpportunitySaleType(
    companyId: string,
    opportunityId: string,
    saleTypeId: string
  ): Promise<string> {
    const { data, error } = await supabase.rpc('opportunity_add_sale_type', {
      p_company_id:     companyId,
      p_opportunity_id: opportunityId,
      p_sale_type_id:   saleTypeId,
    })

    if (error) throw error
    return data as string
  },

  // ── Remover vínculo via RPC ────────────────────────
  async removeOpportunitySaleType(
    companyId: string,
    opportunitySaleTypeId: string
  ): Promise<void> {
    const { error } = await supabase.rpc('opportunity_remove_sale_type', {
      p_company_id:               companyId,
      p_opportunity_sale_type_id: opportunitySaleTypeId,
    })

    if (error) throw error
  },

  // ── Configurar require_won_sale_type em funil via RPC ──
  async setFunnelRequireWonSaleType(
    companyId: string,
    funnelId: string,
    value: boolean
  ): Promise<void> {
    const { error } = await supabase.rpc('set_funnel_require_won_sale_type', {
      p_company_id: companyId,
      p_funnel_id:  funnelId,
      p_value:      value,
    })

    if (error) throw error
  },
}
