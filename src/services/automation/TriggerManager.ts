// =====================================================
// SERVICE: TRIGGER MANAGER
// Data: 13/03/2026
// Objetivo: Gerenciar triggers e disparar fluxos automaticamente
// IMPORTANTE: Não-destrutivo, apenas adiciona funcionalidade
// =====================================================

import { supabase } from '../../lib/supabase'
import { automationEngine } from './AutomationEngine'
import { matchesTriggerConditions } from './triggerEvaluator'
import type { AutomationFlow } from '../../types/automation'
import type { TriggerType, TriggerEvent } from './triggerEvaluator'

export type { TriggerType }

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
      // Buscar todos os fluxos ativos da empresa sem filtrar por trigger_type.
      // O campo trigger_type é legado e pode estar nulo ou desatualizado em
      // fluxos criados após a migration add_triggers_column.sql, que migrou
      // a configuração real para startNode.data.triggers (JSONB).
      // A filtragem por tipo e condições é feita inteiramente por matchesTriggerConditions,
      // que lê o StartNode diretamente — fonte de verdade atual.
      const { data: flows, error } = await supabase
        .from('automation_flows')
        .select('*')
        .eq('company_id', event.companyId)
        .eq('is_active', true)

      if (error) throw error
      if (!flows || flows.length === 0) return []

      // Filtrar fluxos que correspondem ao tipo de trigger e às condições específicas
      const matchingFlows = flows.filter(flow => matchesTriggerConditions(flow, event))

      console.log(`🔍 Encontrados ${matchingFlows.length} de ${flows.length} fluxos que correspondem às condições`)

      return matchingFlows
    } catch (error) {
      console.error('Erro ao buscar fluxos:', error)
      return []
    }
  }

  /**
   * Valida se o fluxo corresponde às condições do trigger
   */
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
   * @deprecated Migrado para /api/automation/trigger-event (backend novo).
   * Mantido como no-op para evitar erros em call sites não identificados.
   */
  async onOpportunityStageChanged(
    _companyId: string,
    _opportunityId: string,
    _oldStage: string,
    _newStage: string,
    _opportunityData: any
  ): Promise<void> {
    console.warn('[LEGACY DISABLED] TriggerManager.onOpportunityStageChanged — use /api/automation/trigger-event')
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
