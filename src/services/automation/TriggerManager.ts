// =====================================================
// SERVICE: TRIGGER MANAGER
// Data: 13/03/2026
// Objetivo: Gerenciar triggers e disparar fluxos automaticamente
// IMPORTANTE: Não-destrutivo, apenas adiciona funcionalidade
// =====================================================

import { supabase } from '../../lib/supabase'
import { automationEngine } from './AutomationEngine'
import type { AutomationFlow } from '../../types/automation'

export type TriggerType =
  | 'lead.created'
  | 'message.received'
  | 'opportunity.created'
  | 'opportunity.stage_changed'
  | 'tag.added'
  | 'schedule.time'

interface TriggerEvent {
  type: TriggerType
  companyId: string
  data: Record<string, any>
}

export class TriggerManager {
  private activeFlows: Map<string, AutomationFlow[]> = new Map()
  private isInitialized = false

  /**
   * Inicializa o gerenciador de triggers
   * Carrega todos os fluxos ativos em memória
   */
  async initialize(companyId: string): Promise<void> {
    if (this.isInitialized) {
      console.log('⚠️ TriggerManager já inicializado')
      return
    }

    try {
      console.log('🔧 Inicializando TriggerManager para empresa:', companyId)

      // Carregar fluxos ativos
      await this.loadActiveFlows(companyId)

      this.isInitialized = true
      console.log('✅ TriggerManager inicializado')
    } catch (error) {
      console.error('❌ Erro ao inicializar TriggerManager:', error)
    }
  }

  /**
   * Carrega fluxos ativos da empresa
   */
  private async loadActiveFlows(companyId: string): Promise<void> {
    try {
      const { data: flows, error } = await supabase
        .from('automation_flows')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true)

      if (error) throw error

      if (flows && flows.length > 0) {
        this.activeFlows.set(companyId, flows)
        console.log(`📋 Carregados ${flows.length} fluxos ativos para empresa ${companyId}`)
      }
    } catch (error) {
      console.error('Erro ao carregar fluxos ativos:', error)
    }
  }

  /**
   * Recarrega fluxos ativos (chamar quando um fluxo é ativado/desativado)
   */
  async reloadFlows(companyId: string): Promise<void> {
    console.log('🔄 Recarregando fluxos ativos...')
    await this.loadActiveFlows(companyId)
  }

  /**
   * Dispara um evento de trigger
   * Encontra fluxos que escutam este trigger e os executa
   */
  async trigger(event: TriggerEvent): Promise<void> {
    try {
      console.log('🎯 Trigger disparado:', event.type, 'Empresa:', event.companyId)

      // Buscar fluxos que escutam este trigger
      const flows = await this.findMatchingFlows(event)

      if (flows.length === 0) {
        console.log('ℹ️ Nenhum fluxo encontrado para este trigger')
        return
      }

      console.log(`🚀 Executando ${flows.length} fluxo(s)...`)

      // Executar cada fluxo
      for (const flow of flows) {
        try {
          await automationEngine.executeFlow(flow.id, event.data, event.companyId)
        } catch (error) {
          console.error(`❌ Erro ao executar fluxo ${flow.id}:`, error)
          // Continuar executando outros fluxos mesmo se um falhar
        }
      }
    } catch (error) {
      console.error('❌ Erro ao processar trigger:', error)
    }
  }

  /**
   * Encontra fluxos que correspondem ao trigger
   */
  private async findMatchingFlows(event: TriggerEvent): Promise<AutomationFlow[]> {
    try {
      // Buscar fluxos ativos da empresa
      const { data: flows, error } = await supabase
        .from('automation_flows')
        .select('*')
        .eq('company_id', event.companyId)
        .eq('is_active', true)
        .eq('trigger_type', event.type)

      if (error) throw error

      return flows || []
    } catch (error) {
      console.error('Erro ao buscar fluxos:', error)
      return []
    }
  }

  /**
   * Helpers para disparar triggers específicos
   */

  /**
   * Dispara quando um novo lead é criado
   */
  async onLeadCreated(companyId: string, leadId: number, leadData: any): Promise<void> {
    await this.trigger({
      type: 'lead.created',
      companyId,
      data: {
        lead_id: leadId,
        lead: leadData,
        timestamp: new Date().toISOString()
      }
    })
  }

  /**
   * Dispara quando uma mensagem é recebida
   */
  async onMessageReceived(
    companyId: string,
    leadId: number,
    message: any
  ): Promise<void> {
    await this.trigger({
      type: 'message.received',
      companyId,
      data: {
        lead_id: leadId,
        message,
        timestamp: new Date().toISOString()
      }
    })
  }

  /**
   * Dispara quando uma oportunidade é criada
   */
  async onOpportunityCreated(
    companyId: string,
    opportunityId: string,
    opportunityData: any
  ): Promise<void> {
    await this.trigger({
      type: 'opportunity.created',
      companyId,
      data: {
        opportunity_id: opportunityId,
        opportunity: opportunityData,
        timestamp: new Date().toISOString()
      }
    })
  }

  /**
   * Dispara quando uma oportunidade muda de etapa
   */
  async onOpportunityStageChanged(
    companyId: string,
    opportunityId: string,
    oldStage: string,
    newStage: string,
    opportunityData: any
  ): Promise<void> {
    await this.trigger({
      type: 'opportunity.stage_changed',
      companyId,
      data: {
        opportunity_id: opportunityId,
        old_stage: oldStage,
        new_stage: newStage,
        opportunity: opportunityData,
        timestamp: new Date().toISOString()
      }
    })
  }

  /**
   * Dispara quando uma tag é adicionada
   */
  async onTagAdded(
    companyId: string,
    leadId: number,
    tagId: string,
    tagName: string
  ): Promise<void> {
    await this.trigger({
      type: 'tag.added',
      companyId,
      data: {
        lead_id: leadId,
        tag_id: tagId,
        tag_name: tagName,
        timestamp: new Date().toISOString()
      }
    })
  }
}

// Exportar instância singleton
export const triggerManager = new TriggerManager()
