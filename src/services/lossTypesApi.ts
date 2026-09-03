/**
 * Serviço de Tipos de Perda.
 *
 * CRUD de loss_types via PostgREST (RLS garante isolamento por company_id).
 * Operações de vínculo (opportunity_loss_types) passam obrigatoriamente
 * por RPCs SECURITY DEFINER — não há escrita direta pelo frontend.
 *
 * Espelho de saleTypesApi.ts.
 */

import { supabase } from '../lib/supabase'
import type { LossType, OpportunityLossTypeLink } from '../types/sales-funnel'

export type LossTypeFilters = {
  isActive?: boolean
  name?: string
}

export const lossTypesApi = {

  // ── Listar tipos de perda ──────────────────────────
  async getLossTypes(companyId: string, filters?: LossTypeFilters): Promise<LossType[]> {
    let query = supabase
      .from('loss_types')
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
    return (data || []) as LossType[]
  },

  // ── Listar apenas tipos visíveis (para seletores) ─
  // Regra: custom (is_active=true) + sistema (is_active=true AND is_hidden=false)
  async getVisibleLossTypes(companyId: string): Promise<LossType[]> {
    const { data, error } = await supabase
      .from('loss_types')
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
    return ((data || []) as LossType[]).filter(lt =>
      (!lt.is_system && lt.is_active) ||
      (lt.is_system && lt.is_active && !lt.is_hidden)
    )
  },

  // ── Criar tipo de perda ────────────────────────────
  // Campos is_system, system_key e is_hidden são ignorados — o banco bloqueia via trigger.
  async createLossType(
    companyId: string,
    payload: { name: string; description?: string | null; sort_order?: number }
  ): Promise<LossType> {
    const { data, error } = await supabase
      .from('loss_types')
      .insert({
        company_id:  companyId,
        name:        payload.name.trim(),
        description: payload.description ?? null,
        sort_order:  payload.sort_order ?? 1000,
      })
      .select()
      .single()

    if (error) throw error
    return data as LossType
  },

  // ── Atualizar tipo de perda ────────────────────────
  // is_system, system_key e is_hidden nunca são enviados — protegidos via trigger.
  async updateLossType(
    id: string,
    companyId: string,
    patch: Partial<Pick<LossType, 'name' | 'description' | 'is_active' | 'sort_order'>>
  ): Promise<LossType> {
    const { data, error } = await supabase
      .from('loss_types')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single()

    if (error) throw error
    return data as LossType
  },

  // ── Ocultar / exibir tipo de sistema via RPC ──────
  async setSystemLossTypeHidden(
    companyId: string,
    lossTypeId: string,
    isHidden: boolean
  ): Promise<void> {
    const { error } = await supabase.rpc('set_system_loss_type_hidden', {
      p_company_id:  companyId,
      p_loss_type_id: lossTypeId,
      p_is_hidden:   isHidden,
    })

    if (error) throw error
  },

  // ── Deletar tipo de perda ──────────────────────────
  // Pode falhar com FK violation se já usado em opportunity_loss_types.
  // O chamador deve tratar o erro e orientar desativação.
  async deleteLossType(id: string, companyId: string): Promise<void> {
    const { error } = await supabase
      .from('loss_types')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)

    if (error) throw error
  },

  // ── Listar tipos vinculados a uma oportunidade ─────
  async getOpportunityLossTypes(
    companyId: string,
    opportunityId: string
  ): Promise<OpportunityLossTypeLink[]> {
    const { data, error } = await supabase
      .from('opportunity_loss_types')
      .select('*, loss_types(*)')
      .eq('company_id', companyId)
      .eq('opportunity_id', opportunityId)

    if (error) throw error
    return (data || []) as OpportunityLossTypeLink[]
  },

  // ── Vincular tipo de perda via RPC ─────────────────
  async addOpportunityLossType(
    companyId: string,
    opportunityId: string,
    lossTypeId: string
  ): Promise<string> {
    const { data, error } = await supabase.rpc('opportunity_add_loss_type', {
      p_company_id:     companyId,
      p_opportunity_id: opportunityId,
      p_loss_type_id:   lossTypeId,
    })

    if (error) throw error
    return data as string
  },

  // ── Remover vínculo via RPC ────────────────────────
  async removeOpportunityLossType(
    companyId: string,
    opportunityLossTypeId: string
  ): Promise<void> {
    const { error } = await supabase.rpc('opportunity_remove_loss_type', {
      p_company_id:                companyId,
      p_opportunity_loss_type_id:  opportunityLossTypeId,
    })

    if (error) throw error
  },

  // ── Configurar require_lost_loss_type em funil via RPC ──
  async setFunnelRequireLostLossType(
    companyId: string,
    funnelId: string,
    value: boolean
  ): Promise<void> {
    const { error } = await supabase.rpc('set_funnel_require_lost_loss_type', {
      p_funnel_id:  funnelId,
      p_company_id: companyId,
      p_value:      value,
    })

    if (error) throw error
  },
}
