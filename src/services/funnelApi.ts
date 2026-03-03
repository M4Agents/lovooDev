// =====================================================
// SALES FUNNEL API SERVICE
// Data: 03/03/2026
// Objetivo: Serviço para integração com APIs do sistema de funil
// =====================================================

import { createClient } from '@supabase/supabase-js'
import type {
  SalesFunnel,
  FunnelStage,
  LeadFunnelPosition,
  LeadStageHistory,
  LeadCardFieldPreference,
  CreateFunnelForm,
  UpdateFunnelForm,
  CreateStageForm,
  UpdateStageForm,
  MoveLeadForm,
  FunnelFilter,
  StageFilter,
  LeadPositionFilter,
  StageHistoryFilter
} from '../types/sales-funnel'

// =====================================================
// CONFIGURAÇÃO DO SUPABASE
// =====================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
        .order('created_at', { ascending: false })
      
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
    try {
      const { data: funnel, error } = await supabase
        .from('sales_funnels')
        .insert({
          company_id: companyId,
          name: data.name,
          description: data.description,
          is_default: data.is_default || false,
          is_active: data.is_active !== undefined ? data.is_active : true
        })
        .select()
        .single()
      
      if (error) throw error
      
      return funnel
    } catch (error) {
      console.error('Error creating funnel:', error)
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
   * Deletar funil
   */
  async deleteFunnel(funnelId: string): Promise<void> {
    try {
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
          lead:leads(
            id,
            name,
            email,
            phone,
            company_name,
            tags,
            created_at,
            origin,
            status,
            record_type
          )
        `)
        .eq('funnel_id', funnelId)
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
      const { data, error } = await supabase
        .from('lead_card_field_preferences')
        .upsert({
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
        .from('lead_funnel_positions')
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
}

// =====================================================
// EXPORTAR INSTÂNCIA SINGLETON
// =====================================================

export const funnelApi = new FunnelApiService()
export default funnelApi
