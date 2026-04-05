// =====================================================
// SALES FUNNEL API SERVICE
// Data: 03/03/2026
// Objetivo: Serviço para integração com APIs do sistema de funil
// =====================================================

import { supabase } from '../lib/supabase'
import type {
  SalesFunnel,
  FunnelStage,
  Opportunity,
  OpportunityFunnelPosition,
  LeadFunnelPosition,
  LeadStageHistory,
  LeadCardFieldPreference,
  CreateFunnelForm,
  UpdateFunnelForm,
  CreateStageForm,
  UpdateStageForm,
  CreateOpportunityForm,
  UpdateOpportunityForm,
  UpdateOpportunityOptions,
  MoveOpportunityForm,
  MoveLeadForm,
  FunnelFilter,
  StageFilter,
  LeadPositionFilter,
  StageHistoryFilter,
  StageCount,
  OpportunityItemRow,
  DiscountType,
  OpportunityValueMode
} from '../types/sales-funnel'
import { normalizeOpportunityManualValue } from '../utils/opportunityCompositionErrors'

// =====================================================
// SUPABASE CLIENT
// =====================================================
// Usando cliente já configurado em src/lib/supabase.ts

// =====================================================
// CLASSE: FunnelApiService
// =====================================================


class FunnelApiService {
  
  // ===================================================
  // FUNIS (SALES_FUNNELS)
  // ===================================================
  
  /**
   * Buscar todos os funis da empresa
   */
  async getFunnels(companyId: string, filter?: FunnelFilter): Promise<SalesFunnel[]> {
    try {
      let query = supabase
        .from('sales_funnels')
        .select(`
          *,
          stages:funnel_stages(count)
        `)
        .eq('company_id', companyId)
        .order('display_order', { ascending: true })
      
      if (filter?.is_active !== undefined) {
        query = query.eq('is_active', filter.is_active)
      }
      
      if (filter?.search) {
        query = query.ilike('name', `%${filter.search}%`)
      }
      
      const { data, error } = await query
      
      if (error) throw error

      return data || []
    } catch (error) {
      console.error('Error fetching funnels:', error)
      throw error
    }
  }
  
  /**
   * Buscar funil por ID
   */
  async getFunnelById(funnelId: string): Promise<SalesFunnel | null> {
    try {
      const { data, error } = await supabase
        .from('sales_funnels')
        .select(`
          *,
          stages:funnel_stages(*)
        `)
        .eq('id', funnelId)
        .single()
      
      if (error) throw error
      
      return data
    } catch (error) {
      console.error('Error fetching funnel:', error)
      throw error
    }
  }
  
  /**
   * Buscar funil padrão da empresa
   */
  async getDefaultFunnel(companyId: string): Promise<SalesFunnel | null> {
    try {
      const { data, error } = await supabase
        .from('sales_funnels')
        .select(`
          *,
          stages:funnel_stages(*)
        `)
        .eq('company_id', companyId)
        .eq('is_default', true)
        .eq('is_active', true)
        .single()
      
      if (error) {
        // Se não encontrou funil padrão, retornar o primeiro ativo
        const { data: firstFunnel } = await supabase
          .from('sales_funnels')
          .select(`
            *,
            stages:funnel_stages(*)
          `)
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()
        
        return firstFunnel || null
      }
      
      return data
    } catch (error) {
      console.error('Error fetching default funnel:', error)
      return null
    }
  }
  
  /**
   * Criar novo funil
   */
  async createFunnel(companyId: string, data: CreateFunnelForm): Promise<SalesFunnel> {
    const insertPayload = {
      company_id: companyId,
      name: data.name,
      description: data.description,
      is_default: data.is_default || false,
      is_active: data.is_active !== undefined ? data.is_active : true,
      skip_default_stages: data.skip_default_stages || false
    }
    try {
      const { data: funnel, error } = await supabase
        .from('sales_funnels')
        .insert(insertPayload)
        .select()
        .single()
      
      if (error) throw error

      return funnel
    } catch (error) {
      console.error('Error creating funnel:', error)

      // Traduzir erros de constraint do Supabase (23505 = unique_violation)
      const supaErr = error as Record<string, unknown>
      if (supaErr?.code === '23505') {
        const detail = String(supaErr?.details || supaErr?.message || '')
        if (detail.includes('unique_company_funnel_slug') || detail.includes('slug')) {
          throw new Error('Já existe um funil com nome semelhante. Tente um nome diferente.')
        }
        throw new Error('Já existe um funil com este nome nesta empresa.')
      }

      throw error
    }
  }
  
  /**
   * Atualizar funil
   */
  async updateFunnel(funnelId: string, data: UpdateFunnelForm): Promise<SalesFunnel> {
    try {
      const { data: funnel, error } = await supabase
        .from('sales_funnels')
        .update(data)
        .eq('id', funnelId)
        .select()
        .single()
      
      if (error) throw error
      
      return funnel
    } catch (error) {
      console.error('Error updating funnel:', error)
      throw error
    }
  }
  
  /**
   * Verificar se funil pode ser deletado
   */
  async canDeleteFunnel(funnelId: string): Promise<{
    canDelete: boolean
    opportunityCount: number
    message?: string
  }> {
    try {
      const { count, error } = await supabase
        .from('opportunity_funnel_positions')
        .select('*', { count: 'exact', head: true })
        .eq('funnel_id', funnelId)
      
      if (error) throw error
      
      const opportunityCount = count || 0
      
      if (opportunityCount > 0) {
        return {
          canDelete: false,
          opportunityCount,
          message: `Este funil possui ${opportunityCount} oportunidade${opportunityCount > 1 ? 's' : ''} e não pode ser excluído. Mova ou conclua as oportunidades primeiro.`
        }
      }
      
      return {
        canDelete: true,
        opportunityCount: 0
      }
    } catch (error) {
      console.error('Error checking funnel:', error)
      throw error
    }
  }

  /**
   * Deletar funil
   */
  async deleteFunnel(funnelId: string): Promise<void> {
    try {
      // Verificar se pode deletar
      const check = await this.canDeleteFunnel(funnelId)
      
      if (!check.canDelete) {
        throw new Error(check.message)
      }
      
      const { error } = await supabase
        .from('sales_funnels')
        .delete()
        .eq('id', funnelId)
      
      if (error) throw error
    } catch (error) {
      console.error('Error deleting funnel:', error)
      throw error
    }
  }
  
  // ===================================================
  // ETAPAS (FUNNEL_STAGES)
  // ===================================================
  
  /**
   * Buscar etapas de um funil
   */
  async getStages(funnelId: string, filter?: StageFilter): Promise<FunnelStage[]> {
    try {
      let query = supabase
        .from('funnel_stages')
        .select('*')
        .eq('funnel_id', funnelId)
        .order('position', { ascending: true })
      
      if (filter?.stage_type) {
        query = query.eq('stage_type', filter.stage_type)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      
      return data || []
    } catch (error) {
      console.error('Error fetching stages:', error)
      throw error
    }
  }
  
  /**
   * Criar nova etapa
   */
  async createStage(data: CreateStageForm): Promise<FunnelStage> {
    try {
      const { data: stage, error } = await supabase
        .from('funnel_stages')
        .insert({
          funnel_id: data.funnel_id,
          name: data.name,
          description: data.description,
          color: data.color,
          position: data.position,
          stage_type: data.stage_type || 'active'
        })
        .select()
        .single()
      
      if (error) throw error
      
      return stage
    } catch (error) {
      console.error('Error creating stage:', error)
      throw error
    }
  }
  
  /**
   * Atualizar etapa
   */
  async updateStage(stageId: string, data: UpdateStageForm): Promise<FunnelStage> {
    try {
      const { data: stage, error } = await supabase
        .from('funnel_stages')
        .update(data)
        .eq('id', stageId)
        .select()
        .single()
      
      if (error) throw error
      
      return stage
    } catch (error) {
      console.error('Error updating stage:', error)
      throw error
    }
  }
  
  /**
   * Deletar etapa
   */
  async deleteStage(stageId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('funnel_stages')
        .delete()
        .eq('id', stageId)
      
      if (error) throw error
    } catch (error) {
      console.error('Error deleting stage:', error)
      throw error
    }
  }
  
  /**
   * Reordenar etapas
   */
  async reorderStages(stageIds: string[]): Promise<void> {
    try {
      // Atualizar posição de cada etapa
      const updates = stageIds.map((stageId, index) => 
        supabase
          .from('funnel_stages')
          .update({ position: index })
          .eq('id', stageId)
      )
      
      await Promise.all(updates)
    } catch (error) {
      console.error('Error reordering stages:', error)
      throw error
    }
  }
  
  // ===================================================
  // POSIÇÕES DOS LEADS (LEAD_FUNNEL_POSITIONS)
  // ===================================================
  
  /**
   * Buscar posições dos leads em um funil
   */
  async getLeadPositions(funnelId: string, filter?: LeadPositionFilter): Promise<LeadFunnelPosition[]> {
    try {
      let query = supabase
        .from('lead_funnel_positions')
        .select(`
          *,
          lead:leads!inner(
            id,
            name,
            email,
            phone,
            company_name,
            created_at,
            origin,
            status,
            record_type,
            deleted_at
          )
        `)
        .eq('funnel_id', funnelId)
        .is('lead.deleted_at', null)
        .order('position_in_stage', { ascending: true })
      
      if (filter?.stage_id) {
        query = query.eq('stage_id', filter.stage_id)
      }
      
      if (filter?.search) {
        // Buscar por nome do lead
        query = query.or(`lead.name.ilike.%${filter.search}%,lead.email.ilike.%${filter.search}%,lead.phone.ilike.%${filter.search}%`)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      
      // Calcular dias na etapa
      const positions = (data || []).map(pos => ({
        ...pos,
        days_in_stage: this.calculateDaysInStage(pos.entered_stage_at)
      }))
      
      return positions
    } catch (error) {
      console.error('Error fetching lead positions:', error)
      throw error
    }
  }
  
  /**
   * Mover lead para outra etapa
   */
  async moveLeadToStage(data: MoveLeadForm): Promise<LeadFunnelPosition> {
    try {
      const { data: position, error } = await supabase
        .from('lead_funnel_positions')
        .update({
          stage_id: data.to_stage_id,
          position_in_stage: data.position_in_stage,
          entered_stage_at: new Date().toISOString()
        })
        .eq('lead_id', data.lead_id)
        .eq('funnel_id', data.funnel_id)
        .select()
        .single()
      
      if (error) throw error
      
      return position
    } catch (error) {
      console.error('Error moving lead:', error)
      throw error
    }
  }
  
  /**
   * Adicionar lead ao funil
   */
  async addLeadToFunnel(leadId: number, funnelId: string, stageId: string): Promise<LeadFunnelPosition> {
    try {
      const { data: position, error } = await supabase
        .from('lead_funnel_positions')
        .insert({
          lead_id: leadId,
          funnel_id: funnelId,
          stage_id: stageId,
          position_in_stage: 0,
          entered_stage_at: new Date().toISOString()
        })
        .select()
        .single()
      
      if (error) throw error
      
      return position
    } catch (error) {
      console.error('Error adding lead to funnel:', error)
      throw error
    }
  }
  
  /**
   * Remover lead do funil
   */
  async removeLeadFromFunnel(leadId: number, funnelId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('lead_funnel_positions')
        .delete()
        .eq('lead_id', leadId)
        .eq('funnel_id', funnelId)
      
      if (error) throw error
    } catch (error) {
      console.error('Error removing lead from funnel:', error)
      throw error
    }
  }
  
  // ===================================================
  // HISTÓRICO (LEAD_STAGE_HISTORY)
  // ===================================================
  
  /**
   * Buscar histórico de movimentações
   */
  async getStageHistory(filter: StageHistoryFilter): Promise<LeadStageHistory[]> {
    try {
      let query = supabase
        .from('lead_stage_history')
        .select(`
          *,
          from_stage:funnel_stages!lead_stage_history_from_stage_id_fkey(name, color),
          to_stage:funnel_stages!lead_stage_history_to_stage_id_fkey(name, color)
        `)
        .order('moved_at', { ascending: false })
      
      if (filter.lead_id) {
        query = query.eq('lead_id', filter.lead_id)
      }
      
      if (filter.funnel_id) {
        query = query.eq('funnel_id', filter.funnel_id)
      }
      
      if (filter.from_date) {
        query = query.gte('moved_at', filter.from_date.toISOString())
      }
      
      if (filter.to_date) {
        query = query.lte('moved_at', filter.to_date.toISOString())
      }
      
      if (filter.limit) {
        query = query.limit(filter.limit)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      
      return data || []
    } catch (error) {
      console.error('Error fetching stage history:', error)
      throw error
    }
  }
  
  // ===================================================
  // PREFERÊNCIAS DE CARD (LEAD_CARD_FIELD_PREFERENCES)
  // ===================================================
  
  /**
   * Buscar preferências de campos do card
   */
  async getCardPreferences(companyId: string, userId?: string): Promise<LeadCardFieldPreference | null> {
    try {
      let query = supabase
        .from('lead_card_field_preferences')
        .select('*')
        .eq('company_id', companyId)
      
      if (userId) {
        query = query.eq('user_id', userId)
      } else {
        query = query.is('user_id', null)
      }
      
      const { data, error } = await query.single()
      
      if (error && error.code !== 'PGRST116') throw error
      
      return data || null
    } catch (error) {
      console.error('Error fetching card preferences:', error)
      return null
    }
  }
  
  /**
   * Atualizar preferências de campos do card
   */
  async updateCardPreferences(
    companyId: string,
    visibleFields: string[],
    userId?: string
  ): Promise<LeadCardFieldPreference> {
    try {
      // Primeiro, buscar se já existe um registro
      let query = supabase
        .from('lead_card_field_preferences')
        .select('*')
        .eq('company_id', companyId)
      
      if (userId) {
        query = query.eq('user_id', userId)
      } else {
        query = query.is('user_id', null)
      }
      
      const { data: existing } = await query.single()
      
      // Se existe, atualizar
      if (existing) {
        const { data, error } = await supabase
          .from('lead_card_field_preferences')
          .update({ visible_fields: visibleFields })
          .eq('id', existing.id)
          .select()
          .single()
        
        if (error) throw error
        return data
      }
      
      // Se não existe, criar novo
      const { data, error } = await supabase
        .from('lead_card_field_preferences')
        .insert({
          company_id: companyId,
          user_id: userId || null,
          visible_fields: visibleFields
        })
        .select()
        .single()
      
      if (error) throw error
      return data
    } catch (error) {
      console.error('Error updating card preferences:', error)
      throw error
    }
  }
  
  /**
   * Buscar leads disponíveis (que não estão no funil)
   */
  async getAvailableLeads(companyId: string, funnelId: string): Promise<Array<{
    id: number
    name: string
    email?: string
    phone?: string
    company_name?: string
  }>> {
    try {
      // Buscar IDs dos leads que já estão no funil
      const { data: leadsInFunnel } = await supabase
        .from('opportunity_funnel_positions')
        .select('lead_id')
        .eq('funnel_id', funnelId)
      
      const leadsInFunnelIds = leadsInFunnel?.map(l => l.lead_id) || []
      
      // Buscar todos os leads da empresa que NÃO estão no funil
      let query = supabase
        .from('leads')
        .select('id, name, email, phone, company_name')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('name')
      
      // Excluir leads que já estão no funil
      if (leadsInFunnelIds.length > 0) {
        query = query.not('id', 'in', `(${leadsInFunnelIds.join(',')})`)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      
      return data || []
    } catch (error) {
      console.error('Error fetching available leads:', error)
      throw error
    }
  }
  
  // ===================================================
  // OPORTUNIDADES (OPPORTUNITIES) - NOVO MODELO
  // ===================================================
  
  /**
   * Criar nova oportunidade
   */
  async createOpportunity(data: CreateOpportunityForm): Promise<Opportunity> {
    try {
      const value = normalizeOpportunityManualValue(data.value)
      const { data: opportunity, error } = await supabase
        .from('opportunities')
        .insert({
          lead_id: data.lead_id,
          company_id: data.company_id,
          title: data.title,
          description: data.description,
          value,
          /** Coerente com default do banco (`manual`); explícito evita ambiguidade com composição por itens. */
          value_mode: 'manual' satisfies OpportunityValueMode,
          currency: data.currency || 'BRL',
          probability: data.probability || 50,
          expected_close_date: data.expected_close_date,
          source: data.source,
          owner_user_id: data.owner_user_id,
          status: 'open'
        })
        .select()
        .single()
      
      if (error) throw error
      
      return opportunity
    } catch (error) {
      console.error('Error creating opportunity:', error)
      throw error
    }
  }
  
  /**
   * Atualizar oportunidade.
   * Com feature de composição ativa e `useCompositionManualValueRpc`, o campo `value` em modo manual
   * é persistido somente via RPC `opportunity_set_manual_value` (sem UPDATE direto de `value`).
   */
  async updateOpportunity(
    id: string,
    data: UpdateOpportunityForm,
    options?: UpdateOpportunityOptions
  ): Promise<Opportunity> {
    try {
      // Moeda é imutável após criação (trigger no banco); nunca enviar currency no update.
      const { currency: _c, ...payload } = data as UpdateOpportunityForm & { currency?: string }
      void _c

      const isDev =
        (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ||
        process.env.NODE_ENV === 'development'
      if (
        isDev &&
        payload.value !== undefined &&
        options?.useCompositionManualValueRpc === undefined
      ) {
        console.warn(
          '[funnelApi.updateOpportunity] O payload inclui `value`, mas `useCompositionManualValueRpc` não foi informado. ' +
            'Com composição por itens ativa e valor em modo manual, passe `{ companyId, useCompositionManualValueRpc: true }` ' +
            'para persistir via RPC `opportunity_set_manual_value`.'
        )
      }

      const useRpc =
        options?.useCompositionManualValueRpc === true &&
        options.companyId != null &&
        payload.value !== undefined

      if (useRpc) {
        await this.opportunitySetManualValue(options.companyId!, id, payload.value as number)
        const { value: _val, ...rest } = payload
        void _val
        if (Object.keys(rest).length === 0) {
          const o = await this.getOpportunityById(id)
          if (!o) throw new Error('Opportunity not found')
          return o
        }
        const { data: opportunity, error } = await supabase
          .from('opportunities')
          .update(rest)
          .eq('id', id)
          .select()
          .single()
        if (error) throw error
        return opportunity as Opportunity
      }

      const { data: opportunity, error } = await supabase
        .from('opportunities')
        .update(payload)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      return opportunity
    } catch (error) {
      console.error('Error updating opportunity:', error)
      throw error
    }
  }
  
  /**
   * Buscar oportunidades de um lead
   */
  async getOpportunitiesByLead(leadId: number): Promise<Opportunity[]> {
    try {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      
      return data || []
    } catch (error) {
      console.error('Error fetching opportunities by lead:', error)
      throw error
    }
  }
  
  /**
   * Buscar posições das oportunidades em um funil
   */
  async getOpportunityPositions(funnelId: string, filter?: LeadPositionFilter, companyId?: string): Promise<OpportunityFunnelPosition[]> {
    try {
      // Usar RPC quando companyId disponível: traz foto via JOIN, sem N+1
      if (companyId) {
        const { data, error } = await supabase.rpc('get_funnel_positions_with_photos', {
          p_funnel_id:   funnelId,
          p_company_id:  companyId,
          p_stage_id:    filter?.stage_id    ?? null,
          p_search:      filter?.search      ?? null,
          p_origin:      filter?.origin      ?? null,
          p_period_days: filter?.period_days ?? null
        })

        if (error) throw error

        return ((data as OpportunityFunnelPosition[]) || []).map(pos => ({
          ...pos,
          days_in_stage: pos.entered_stage_at ? this.calculateDaysInStage(pos.entered_stage_at as unknown as string) : 0
        }))
      }

      // Fallback: query PostgREST sem foto (companyId não disponível)
      let query = supabase
        .from('opportunity_funnel_positions')
        .select(`
          *,
          opportunity:opportunities(
            id,
            lead_id,
            company_id,
            title,
            description,
            value,
            currency,
            status,
            probability,
            expected_close_date,
            actual_close_date,
            source,
            owner_user_id,
            created_at,
            updated_at,
            closed_at,
            lead:leads(
              id,
              name,
              email,
              phone,
              company_name,
              created_at,
              origin,
              status,
              record_type,
              last_contact_at,
              chat_conversations(id)
            )
          )
        `)
        .eq('funnel_id', funnelId)
        .order('position_in_stage', { ascending: true })

      if (filter?.stage_id) {
        query = query.eq('stage_id', filter.stage_id)
      }

      const { data, error } = await query

      if (error) throw error

      const filteredData = (data || []).filter(pos =>
        pos.opportunity?.lead && !pos.opportunity.lead.deleted_at
      )

      return filteredData.map(pos => ({
        ...pos,
        days_in_stage: pos.entered_stage_at ? this.calculateDaysInStage(pos.entered_stage_at) : 0
      }))
    } catch (error) {
      console.error('Error fetching opportunity positions:', error)
      throw error
    }
  }
  
  /**
   * Mover oportunidade para outra etapa.
   * Usa a RPC move_opportunity que registra o histórico de etapa atomicamente.
   */
  async moveOpportunityToStage(data: MoveOpportunityForm): Promise<OpportunityFunnelPosition> {
    try {
      const { data: position, error } = await supabase.rpc('move_opportunity', {
        p_opportunity_id:    data.opportunity_id,
        p_funnel_id:         data.funnel_id,
        p_from_stage_id:     data.from_stage_id,
        p_to_stage_id:       data.to_stage_id,
        p_position_in_stage: data.position_in_stage
      })

      if (error) throw error

      // A RPC retorna SETOF; pegar o primeiro (e único) registro
      const result = Array.isArray(position) ? position[0] : position
      if (!result) throw new Error('move_opportunity não retornou resultado')

      return result as OpportunityFunnelPosition
    } catch (error) {
      console.error('Error moving opportunity:', error)
      throw error
    }
  }
  
  /**
   * Adicionar oportunidade ao funil
   */
  async addOpportunityToFunnel(opportunityId: string, funnelId: string, stageId: string, leadId?: number): Promise<OpportunityFunnelPosition> {
    try {
      const { data: position, error } = await supabase
        .from('opportunity_funnel_positions')
        .insert({
          opportunity_id: opportunityId,
          funnel_id: funnelId,
          stage_id: stageId,
          lead_id: leadId,
          position_in_stage: 0,
          entered_stage_at: new Date().toISOString()
        })
        .select()
        .single()
      
      if (error) throw error
      
      return position
    } catch (error) {
      console.error('Error adding opportunity to funnel:', error)
      throw error
    }
  }
  
  /**
   * Remover oportunidade do funil
   */
  async removeOpportunityFromFunnel(opportunityId: string, funnelId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('opportunity_funnel_positions')
        .delete()
        .eq('opportunity_id', opportunityId)
        .eq('funnel_id', funnelId)
      
      if (error) throw error
    } catch (error) {
      console.error('Error removing opportunity from funnel:', error)
      throw error
    }
  }
  
  /**
   * Reordenar funis (drag & drop)
   */
  async reorderFunnels(companyId: string, funnels: Array<{id: string, display_order: number}>): Promise<void> {
    try {
      const response = await fetch('/api/funnel/reorder-funnels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          funnels
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Erro ao reordenar funis')
      }

      return await response.json()
    } catch (error) {
      console.error('Error reordering funnels:', error)
      throw error
    }
  }
  
  // ===================================================
  // FASE 3 — CARREGAMENTO POR COLUNA
  // ===================================================

  /**
   * Buscar posições de uma única etapa com paginação.
   * p_funnel_id é obrigatório como segunda barreira de isolamento
   * (stage_id + funnel_id + company_id).
   */
  async getStagePositionsPaged(
    funnelId: string,
    stageId: string,
    companyId: string,
    filter?: Pick<LeadPositionFilter, 'search' | 'origin' | 'period_days'>,
    limit = 20,
    offset = 0
  ): Promise<OpportunityFunnelPosition[]> {
    try {
      const { data, error } = await supabase.rpc('get_stage_positions_paged', {
        p_funnel_id:   funnelId,
        p_stage_id:    stageId,
        p_company_id:  companyId,
        p_search:      filter?.search      ?? null,
        p_origin:      filter?.origin      ?? null,
        p_period_days: filter?.period_days ?? null,
        p_limit:       limit,
        p_offset:      offset
      })

      if (error) throw error

      return ((data as OpportunityFunnelPosition[]) || []).map(pos => ({
        ...pos,
        days_in_stage: pos.entered_stage_at
          ? this.calculateDaysInStage(pos.entered_stage_at as unknown as string)
          : 0
      }))
    } catch (error) {
      console.error('Error fetching stage positions paged:', error)
      throw error
    }
  }

  /**
   * Buscar contadores (count + total_value) por etapa para um funil inteiro.
   * Uma única query com os mesmos filtros da listagem de cards.
   */
  async getStageCounts(
    funnelId: string,
    companyId: string,
    filter?: Pick<LeadPositionFilter, 'search' | 'origin' | 'period_days'>
  ): Promise<StageCount[]> {
    try {
      const { data, error } = await supabase.rpc('get_funnel_stage_counts', {
        p_funnel_id:   funnelId,
        p_company_id:  companyId,
        p_search:      filter?.search      ?? null,
        p_origin:      filter?.origin      ?? null,
        p_period_days: filter?.period_days ?? null
      })

      if (error) throw error

      return (data as StageCount[]) || []
    } catch (error) {
      console.error('Error fetching stage counts:', error)
      throw error
    }
  }

  // ===================================================
  // HELPERS
  // ===================================================
  
  /**
   * Calcular dias na etapa
   */
  private calculateDaysInStage(enteredAt: string): number {
    const now = new Date()
    const entered = new Date(enteredAt)
    const diffTime = Math.abs(now.getTime() - entered.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  // ===================================================
  // COMPOSIÇÃO DE VALOR (produtos/serviços) — RPCs
  // ===================================================

  async getOpportunityById(opportunityId: string): Promise<Opportunity | null> {
    const { data, error } = await supabase
      .from('opportunities')
      .select('*')
      .eq('id', opportunityId)
      .maybeSingle()
    if (error) throw error
    return data as Opportunity | null
  }

  async listOpportunityItems(companyId: string, opportunityId: string): Promise<OpportunityItemRow[]> {
    const { data, error } = await supabase
      .from('opportunity_items')
      .select('*')
      .eq('company_id', companyId)
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data || []) as OpportunityItemRow[]
  }

  async opportunityAddItem(params: {
    companyId: string
    opportunityId: string
    productId?: string | null
    serviceId?: string | null
    quantity: number
    unitPrice?: number | null
    discountType: DiscountType
    discountValue: number
    nameSnapshot?: string | null
    descriptionSnapshot?: string | null
  }): Promise<string> {
    const { data, error } = await supabase.rpc('opportunity_add_item', {
      p_company_id: params.companyId,
      p_opportunity_id: params.opportunityId,
      p_product_id: params.productId ?? null,
      p_service_id: params.serviceId ?? null,
      p_quantity: params.quantity,
      p_unit_price: params.unitPrice ?? null,
      p_discount_type: params.discountType,
      p_discount_value: params.discountValue,
      p_name_snapshot: params.nameSnapshot ?? null,
      p_description_snapshot: params.descriptionSnapshot ?? null,
    })
    if (error) throw error
    return data as string
  }

  async opportunityUpdateItem(params: {
    companyId: string
    itemId: string
    unitPrice?: number | null
    quantity?: number | null
    discountType?: DiscountType | null
    discountValue?: number | null
  }): Promise<void> {
    const { error } = await supabase.rpc('opportunity_update_item', {
      p_company_id: params.companyId,
      p_item_id: params.itemId,
      p_unit_price: params.unitPrice ?? null,
      p_quantity: params.quantity ?? null,
      p_discount_type: params.discountType ?? null,
      p_discount_value: params.discountValue ?? null,
    })
    if (error) throw error
  }

  async opportunityRemoveItem(companyId: string, itemId: string): Promise<void> {
    const { error } = await supabase.rpc('opportunity_remove_item', {
      p_company_id: companyId,
      p_item_id: itemId,
    })
    if (error) throw error
  }

  async opportunitySetValueMode(
    companyId: string,
    opportunityId: string,
    mode: OpportunityValueMode
  ): Promise<void> {
    const { error } = await supabase.rpc('opportunity_set_value_mode', {
      p_company_id: companyId,
      p_opportunity_id: opportunityId,
      p_mode: mode,
    })
    if (error) throw error
  }

  async opportunitySetGlobalDiscount(
    companyId: string,
    opportunityId: string,
    discountType: DiscountType,
    discountValue: number
  ): Promise<void> {
    const { error } = await supabase.rpc('opportunity_set_global_discount', {
      p_company_id: companyId,
      p_opportunity_id: opportunityId,
      p_discount_type: discountType,
      p_discount_value: discountValue,
    })
    if (error) throw error
  }

  async opportunitySetManualValue(
    companyId: string,
    opportunityId: string,
    value: number
  ): Promise<void> {
    const { error } = await supabase.rpc('opportunity_set_manual_value', {
      p_company_id: companyId,
      p_opportunity_id: opportunityId,
      p_value: value,
    })
    if (error) throw error
  }

  async opportunitySyncTotals(companyId: string, opportunityId: string): Promise<void> {
    const { error } = await supabase.rpc('opportunity_sync_totals', {
      p_company_id: companyId,
      p_opportunity_id: opportunityId,
    })
    if (error) throw error
  }
}

// =====================================================
// EXPORTAR INSTÂNCIA SINGLETON
// =====================================================

export const funnelApi = new FunnelApiService()
export default funnelApi
