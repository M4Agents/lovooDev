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
  | 'opportunity.won'
  | 'opportunity.lost'
  | 'opportunity.owner_assigned'
  | 'opportunity.owner_removed'
  | 'tag.added'
  | 'tag.removed'
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
      // #region agent log
      console.warn('[DEBUG-7a137a] [H2] TriggerManager.trigger() called', { eventType: event.type, companyId: event.companyId, isBrowser: typeof window !== 'undefined' })
      // #endregion

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
      const matchingFlows = flows.filter(flow => {
        return this.matchesTriggerConditions(flow, event)
      })

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
    private matchesTriggerConditions(flow: AutomationFlow, event: TriggerEvent): boolean {
    // Buscar configuração do trigger no StartNode
    const startNode = flow.nodes.find((node: any) => node.type === 'start')
    if (!startNode) return false
    
    const triggers = startNode.data?.triggers || []
    if (triggers.length === 0) return false
    
    // Obter operador lógico (padrão: OR para compatibilidade)
    const operator = startNode.data?.triggerOperator || flow.trigger_operator || 'OR'
    
    // Filtrar apenas triggers habilitados do tipo do evento
    const relevantTriggers = triggers.filter((t: any) => t.enabled && t.type === event.type)
    if (relevantTriggers.length === 0) return false
    
    // Avaliar cada trigger relevante
    const results = relevantTriggers.map((trigger: any) => {
      switch (event.type) {
        case 'opportunity.stage_changed':
          return this.matchesOpportunityStageChanged(trigger, event.data)
        
        case 'opportunity.created':
          return this.matchesOpportunityCreated(trigger, event.data)
        
        case 'opportunity.won':
          return this.matchesOpportunityWon(trigger, event.data)
        
        case 'opportunity.lost':
          return this.matchesOpportunityLost(trigger, event.data)
        
        case 'opportunity.owner_assigned':
        case 'opportunity.owner_removed':
          return this.matchesOpportunityOwner(trigger, event.data)
        
        case 'tag.added':
        case 'tag.removed':
          return this.matchesTag(trigger, event.data)
        
        case 'message.received':
          return this.matchesMessageReceived(trigger, event.data)
        
        default:
          // Triggers sem validação específica (lead.created, etc)
          return true
      }
    })
    
    // Aplicar operador lógico
    if (operator === 'AND') {
      // Todos os triggers devem corresponder
      const allMatch = results.every((r: boolean) => r === true)
      console.log(`🔗 Operador AND: ${allMatch ? '✅ Todos correspondem' : '❌ Nem todos correspondem'}`, {
        flowId: flow.id,
        flowName: flow.name,
        totalTriggers: relevantTriggers.length,
        results
      })
      return allMatch
    } else {
      // Pelo menos um trigger deve corresponder (OR - comportamento atual)
      const anyMatch = results.some((r: boolean) => r === true)
      console.log(`🔗 Operador OR: ${anyMatch ? '✅ Pelo menos um corresponde' : '❌ Nenhum corresponde'}`, {
        flowId: flow.id,
        flowName: flow.name,
        totalTriggers: relevantTriggers.length,
        results
      })
      return anyMatch
    }
  }

  /**
   * Valida condições para opportunity.stage_changed
   */
  private matchesOpportunityStageChanged(trigger: any, eventData: any): boolean {
    const config = trigger.config || {}
    
    // Validar funil (se especificado)
    if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) {
      console.log('❌ Funil não corresponde:', config.funnelId, '!=', eventData.opportunity?.funnel_id)
      return false
    }
    
    // Validar etapa de destino (obrigatório)
    if (config.toStageId && config.toStageId !== eventData.new_stage) {
      console.log('❌ Etapa destino não corresponde:', config.toStageId, '!=', eventData.new_stage)
      return false
    }
    
    // Validar etapa de origem (se especificado)
    if (config.fromStageId && config.fromStageId !== eventData.old_stage) {
      console.log('❌ Etapa origem não corresponde:', config.fromStageId, '!=', eventData.old_stage)
      return false
    }
    
    // Validar valor mínimo (se especificado)
    if (config.minValue && eventData.opportunity?.value < config.minValue) {
      console.log('❌ Valor abaixo do mínimo:', eventData.opportunity?.value, '<', config.minValue)
      return false
    }
    
    // Validar valor máximo (se especificado)
    if (config.maxValue && eventData.opportunity?.value > config.maxValue) {
      console.log('❌ Valor acima do máximo:', eventData.opportunity?.value, '>', config.maxValue)
      return false
    }
    
    console.log('✅ Condições de opportunity.stage_changed correspondem')
    return true
  }

  /**
   * Valida condições para opportunity.created
   */
  private matchesOpportunityCreated(trigger: any, eventData: any): boolean {
    const config = trigger.config || {}
    
    // Validar funil (se especificado)
    if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) {
      return false
    }
    
    // Validar etapa inicial (se especificado)
    if (config.initialStageId && config.initialStageId !== eventData.opportunity?.stage_id) {
      return false
    }
    
    // Validar valor mínimo (se especificado)
    if (config.minValue && eventData.opportunity?.value < config.minValue) {
      return false
    }
    
    // Validar valor máximo (se especificado)
    if (config.maxValue && eventData.opportunity?.value > config.maxValue) {
      return false
    }
    
    return true
  }

  /**
   * Valida condições para message.received
   */
  private matchesMessageReceived(trigger: any, eventData: any): boolean {
    const config = trigger.config || {}
    
    // Validar instância WhatsApp (se especificada)
    if (config.instanceId && config.instanceId !== eventData.instance_id) {
      console.log('❌ Instância não corresponde:', {
        configured: config.instanceId,
        received: eventData.instance_id,
        configuredName: config.instanceName
      })
      return false
    }
    
    console.log('✅ Trigger message.received corresponde', {
      instanceId: eventData.instance_id,
      hasFilter: !!config.instanceId
    })
    return true
  }

  /**
   * Valida condições para opportunity.won
   */
  private matchesOpportunityWon(trigger: any, eventData: any): boolean {
    const config = trigger.config || {}
    
    // Validar funil (se especificado)
    if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) {
      return false
    }
    
    // Validar valor mínimo (se especificado)
    if (config.minValue && eventData.opportunity?.value < config.minValue) {
      return false
    }
    
    // Validar valor máximo (se especificado)
    if (config.maxValue && eventData.opportunity?.value > config.maxValue) {
      return false
    }
    
    return true
  }

  /**
   * Valida condições para opportunity.lost
   */
  private matchesOpportunityLost(trigger: any, eventData: any): boolean {
    const config = trigger.config || {}
    
    // Validar funil (se especificado)
    if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) {
      return false
    }
    
    // Validar motivo da perda (se especificado)
    if (config.lostReason && config.lostReason !== eventData.lost_reason) {
      return false
    }
    
    // Validar valor mínimo (se especificado)
    if (config.minValue && eventData.opportunity?.value < config.minValue) {
      return false
    }
    
    // Validar valor máximo (se especificado)
    if (config.maxValue && eventData.opportunity?.value > config.maxValue) {
      return false
    }
    
    return true
  }

  /**
   * Valida condições para opportunity.owner_assigned/removed
   */
  private matchesOpportunityOwner(trigger: any, eventData: any): boolean {
    const config = trigger.config || {}
    
    // Validar funil (se especificado)
    if (config.funnelId && config.funnelId !== eventData.opportunity?.funnel_id) {
      return false
    }
    
    // Validar vendedor específico (se especificado)
    if (config.ownerId && config.ownerId !== eventData.owner_id) {
      return false
    }
    
    return true
  }

  /**
   * Valida condições para tag.added/removed
   */
  private matchesTag(trigger: any, eventData: any): boolean {
    const config = trigger.config || {}
    
    // Validar tag específica (se especificado)
    if (config.tagId && config.tagId !== eventData.tag_id) {
      return false
    }
    
    return true
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
