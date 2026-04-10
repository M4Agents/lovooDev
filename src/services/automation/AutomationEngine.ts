// =====================================================
// SERVICE: AUTOMATION ENGINE
// Data: 13/03/2026
// Objetivo: Motor de execução de fluxos de automação
// IMPORTANTE: Implementação incremental e não-destrutiva
// =====================================================
import { notificationService } from './NotificationService'
import { supabase } from '../../lib/supabase'
import type { AutomationFlow, AutomationExecution, AutomationLog, Node, Edge } from '../../types/automation'
import { whatsAppService } from './WhatsAppService'
import { crmService } from './CRMService'
import { scheduleService } from './ScheduleService'
import { webhookService } from './WebhookService'
import { activityService } from './ActivityService'
import { ChatApi } from '../chat/chatApi'

interface ExecutionContext {
  executionId: string
  flowId: string
  companyId: string
  triggerData: Record<string, any>
  variables: Record<string, any>
  leadId?: number
  opportunityId?: string
  instanceId?: string  // Instância WhatsApp definida no trigger
}

export class AutomationEngine {
  /**
   * Inicia a execução de um fluxo
   * @param flowId - ID do fluxo a ser executado
   * @param triggerData - Dados do gatilho que iniciou o fluxo
   * @param companyId - ID da empresa
   */
  async executeFlow(
    flowId: string,
    triggerData: Record<string, any>,
    companyId: string
  ): Promise<string | null> {
    try {
      console.log('🚀 AutomationEngine: Iniciando execução do fluxo', { flowId, companyId })

      // 1. Buscar fluxo
      const flow = await this.getFlow(flowId)
      if (!flow) {
        console.error('❌ Fluxo não encontrado:', flowId)
        return null
      }

      // 2. Validar se pode executar
      if (!this.canExecute(flow)) {
        console.warn('⚠️ Fluxo não pode ser executado (inativo ou inválido)', flowId)
        return null
      }

      // 3. Criar execução
      const execution = await this.createExecution(flow, triggerData, companyId)
      if (!execution) {
        console.error('❌ Erro ao criar execução')
        return null
      }

      console.log('✅ Execução criada:', execution.id)

      // 4. Processar fluxo em background (não bloquear)
      this.processFlowAsync(flow, execution).catch((error) => {
        console.error('❌ Erro ao processar fluxo:', error)
        this.completeExecution(execution.id, 'failed', error.message)
      })

      return execution.id
    } catch (error) {
      console.error('❌ Erro ao executar fluxo:', error)
      return null
    }
  }

  /**
   * Busca um fluxo pelo ID
   */
  private async getFlow(flowId: string): Promise<AutomationFlow | null> {
    try {
      const { data, error } = await supabase
        .from('automation_flows')
        .select('*')
        .eq('id', flowId)
        .single()

      if (error) throw error
      return data
    } catch (error) {
      console.error('Erro ao buscar fluxo:', error)
      return null
    }
  }

  /**
   * Valida se o fluxo pode ser executado
   */
  private canExecute(flow: AutomationFlow): boolean {
    // Verificar se está ativo
    if (!flow.is_active) {
      return false
    }

    // Verificar se tem nodes
    if (!flow.nodes || flow.nodes.length === 0) {
      return false
    }

    // Verificar se tem um trigger/start node
    const hasTrigger = flow.nodes.some((node: any) => node.type === 'trigger' || node.type === 'start')
    if (!hasTrigger) {
      return false
    }

    return true
  }

  /**
   * Cria um registro de execução
   */
  private async createExecution(
    flow: AutomationFlow,
    triggerData: Record<string, any>,
    companyId: string
  ): Promise<AutomationExecution | null> {
    try {
      const execution: Partial<AutomationExecution> = {
        flow_id: flow.id,
        company_id: companyId,
        trigger_data: triggerData,
        lead_id: triggerData.lead_id || triggerData.opportunity?.lead_id,
        opportunity_id: triggerData.opportunity_id || triggerData.opportunity?.id,
        status: 'running',
        variables: {},
        executed_nodes: [],
        started_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('automation_executions')
        .insert(execution)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error) {
      console.error('Erro ao criar execução:', error)
      return null
    }
  }

  /**
   * Processa o fluxo de forma assíncrona
   */
  private async processFlowAsync(
    flow: AutomationFlow,
    execution: AutomationExecution
  ): Promise<void> {
    try {
      console.log('🔄 Processando fluxo:', flow.id)

      // Encontrar o nó trigger/start (ponto de partida)
      const triggerNode = flow.nodes.find((node: any) => node.type === 'trigger' || node.type === 'start')
      if (!triggerNode) {
        throw new Error('Nó trigger/start não encontrado')
      }

      // Extrair instanceId do trigger (se configurado)
      // StartNode armazena triggers em data.triggers (array)
      const triggers = triggerNode?.data?.triggers || []
      const firstTrigger = triggers.find((t: any) => t.enabled)
      const instanceId = firstTrigger?.config?.instanceId
      if (instanceId) {
        console.log('📱 Instância WhatsApp definida no gatilho:', {
          instanceId,
          instanceName: firstTrigger?.config?.instanceName
        })
      }

      const context: ExecutionContext = {
        executionId: execution.id,
        flowId: flow.id,
        companyId: execution.company_id,
        triggerData: execution.trigger_data,
        variables: execution.variables || {},
        leadId: execution.lead_id,
        opportunityId: execution.opportunity_id,
        instanceId: instanceId  // Passa instância do trigger para todos os cards
      }

      // Processar a partir do trigger
      await this.processNode(triggerNode as Node, flow.nodes as Node[], flow.edges as Edge[], context)

      // Verificar se execução foi pausada (não marcar como completed)
      const { data: currentExecution } = await supabase
        .from('automation_executions')
        .select('status')
        .eq('id', execution.id)
        .single()

      if (currentExecution?.status === 'paused') {
        console.log('⏸️ Fluxo pausado - Aguardando resposta do usuário')
        return
      }

      // Marcar como completo
      await this.completeExecution(execution.id, 'completed')
      console.log('✅ Fluxo processado com sucesso:', flow.id)
    } catch (error: any) {
      console.error('❌ Erro ao processar fluxo:', error)
      await this.completeExecution(execution.id, 'failed', error.message)
    }
  }

  /**
   * Processa um nó individual
   */
  private async processNode(
    node: Node,
    allNodes: Node[],
    allEdges: Edge[],
    context: ExecutionContext
  ): Promise<void> {
    console.log('📦 Processando nó:', node.id, node.type)

    // Criar log de início
    await this.createLog(context, node, 'started')

    try {
      // Executar ação do nó
      const result = await this.executeNodeAction(node, context)

      // Verificar se o fluxo foi pausado (user_input)
      if (result?.paused === true) {
        console.log('⏸️ Fluxo pausado - Não processando próximos nós')
        await this.createLog(context, node, 'paused', result)
        await this.updateExecutedNodes(context.executionId, node.id, 'paused', result)
        return // INTERROMPER processamento
      }

      // Criar log de sucesso
      await this.createLog(context, node, 'success', result)

      // Atualizar executed_nodes
      await this.updateExecutedNodes(context.executionId, node.id, 'success', result)

      // Encontrar próximos nós
      const nextNodes = this.getNextNodes(node, allNodes, allEdges, result)

      // Processar próximos nós sequencialmente
      for (const nextNode of nextNodes) {
        await this.processNode(nextNode, allNodes, allEdges, context)
      }
    } catch (error: any) {
      console.error('❌ Erro ao processar nó:', node.id, error)
      await this.createLog(context, node, 'error', null, error.message)
      await this.updateExecutedNodes(context.executionId, node.id, 'error', null, error.message)
      throw error
    }
  }

  /**
   * Executa a ação de um nó
   */
  private async executeNodeAction(node: Node, context: ExecutionContext): Promise<any> {
    console.log('⚙️ Executando ação do nó:', node.type)

    switch (node.type) {
      case 'trigger':
      case 'start':
        // Trigger/Start não executa ação, apenas inicia o fluxo
        return { triggered: true, data: context.triggerData }

      case 'action':
        // Executar ação CRM REAL
        return await this.executeCRMAction(node, context)

      case 'message':
        // Verificar se é delay ou mensagem real
        if (node.data.config?.messageType === 'delay') {
          return await this.executeDelay(node, context)
        }
        // Verificar se é user_input (aguarda resposta do usuário)
        if (node.data.config?.messageType === 'user_input') {
          return await this.handleUserInput(node, context)
        }
        // Enviar mensagem WhatsApp REAL
        return await this.sendWhatsAppMessage(node, context)

      case 'condition':
        // Avaliar condição REAL
        return await this.evaluateCondition(node, context)

      case 'delay':
        // Implementar delay REAL com agendamento
        return await this.scheduleDelay(node, context)

      case 'distribution':
        // Executar distribuição de leads
        return await this.executeDistribution(node, context)

      case 'end':
        // Fim do fluxo
        console.log('🏁 Fim do fluxo')
        return { ended: true }

      default:
        console.warn('⚠️ Tipo de nó desconhecido:', node.type)
        return { skipped: true }
    }
  }

  /**
   * Encontra os próximos nós a serem executados
   * IMPORTANTE: Ordena por position.y para respeitar ordem visual do fluxo
   */
  private getNextNodes(
    currentNode: Node,
    allNodes: Node[],
    allEdges: Edge[],
    result: any
  ): Node[] {
    // Encontrar edges que saem do nó atual
    const outgoingEdges = allEdges.filter((edge) => edge.source === currentNode.id)

    if (outgoingEdges.length === 0) {
      console.log('📊 Nenhum próximo nó encontrado para:', currentNode.id)
      return []
    }

    // Para nós de condição, escolher o caminho baseado no resultado
    if (currentNode.type === 'condition') {
      const targetHandle = result?.result ? 'true' : 'false'
      const edge = outgoingEdges.find((e) => e.sourceHandle === targetHandle)
      if (edge) {
        const nextNode = allNodes.find((n) => n.id === edge.target)
        console.log('📊 Condição:', targetHandle, '→ Próximo nó:', nextNode?.id)
        return nextNode ? [nextNode] : []
      }
      return []
    }

    // CORREÇÃO: Ordenar EDGES por posY do target ANTES de mapear
    const sortedEdges = outgoingEdges.sort((edgeA, edgeB) => {
      const nodeA = allNodes.find(n => n.id === edgeA.target)
      const nodeB = allNodes.find(n => n.id === edgeB.target)
      const posA = nodeA?.position?.y || 0
      const posB = nodeB?.position?.y || 0
      return posA - posB
    })
    
    const nextNodes = sortedEdges
      .map((edge) => allNodes.find((n) => n.id === edge.target))
      .filter((node): node is Node => node !== undefined)

    console.log('📊 Próximos nós ordenados por posição Y:', nextNodes.map(n => ({
      id: n.id,
      type: n.type,
      posY: n.position?.y,
      label: n.data?.label || n.data?.config?.message?.substring(0, 30)
    })))

    return nextNodes
  }

  /**
   * Cria um log de execução
   */
  private async createLog(
    context: ExecutionContext,
    node: Node,
    status: 'started' | 'success' | 'error',
    output?: any,
    errorMessage?: string
  ): Promise<void> {
    try {
      const log: Partial<AutomationLog> = {
        execution_id: context.executionId,
        flow_id: context.flowId,
        company_id: context.companyId,
        node_id: node.id,
        node_type: node.type,
        action: node.data.label || node.type,
        status: status === 'started' ? 'success' : status,
        input_data: node.data.config,
        output_data: output,
        error_message: errorMessage,
        executed_at: new Date().toISOString()
      }

      await supabase.from('automation_logs').insert(log)
    } catch (error) {
      console.error('Erro ao criar log:', error)
    }
  }

  /**
   * Atualiza a lista de nós executados
   */
  private async updateExecutedNodes(
    executionId: string,
    nodeId: string,
    status: string,
    output?: any,
    errorMessage?: string
  ): Promise<void> {
    try {
      // Buscar execução atual
      const { data: execution } = await supabase
        .from('automation_executions')
        .select('executed_nodes')
        .eq('id', executionId)
        .single()

      if (!execution) return

      const executedNodes = execution.executed_nodes || []
      executedNodes.push({
        node_id: nodeId,
        executed_at: new Date().toISOString(),
        status,
        output,
        error_message: errorMessage
      })

      await supabase
        .from('automation_executions')
        .update({
          executed_nodes: executedNodes,
          current_node_id: nodeId
        })
        .eq('id', executionId)
    } catch (error) {
      console.error('Erro ao atualizar executed_nodes:', error)
    }
  }

  /**
   * Completa uma execução
   */
  private async completeExecution(
    executionId: string,
    status: 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    try {
      const updates: any = {
        status,
        completed_at: new Date().toISOString()
      }

      if (errorMessage) {
        updates.error_message = errorMessage
      }

      await supabase
        .from('automation_executions')
        .update(updates)
        .eq('id', executionId)

      console.log(`✅ Execução ${status}:`, executionId)
    } catch (error) {
      console.error('Erro ao completar execução:', error)
    }
  }

  /**
   * FASE 5.2: Executa ação CRM REAL
   */
  private async executeCRMAction(node: Node, context: ExecutionContext): Promise<any> {
    try {
      const actionType = node.data.config?.actionType
      console.log('🎯 Executando ação CRM:', actionType)

      if (!context.leadId) {
        throw new Error('Lead ID não encontrado no contexto')
      }

      switch (actionType) {
        case 'create_opportunity':
          // Criar oportunidade
          const opportunityResult = await crmService.createOpportunity({
            leadId: context.leadId,
            companyId: context.companyId,
            funnelId: node.data.config?.funnelId,
            stageId: node.data.config?.stageId,
            title: node.data.config?.title,
            value: node.data.config?.value,
            probability: node.data.config?.probability
          })

          // Atualizar contexto com ID da oportunidade criada
          context.opportunityId = opportunityResult.opportunityId

          return {
            executed: true,
            action: 'create_opportunity',
            opportunityId: opportunityResult.opportunityId
          }

        case 'update_lead':
          // Atualizar lead
          await crmService.updateLead({
            leadId: context.leadId,
            companyId: context.companyId,
            fields: node.data.config?.fields || {}
          })

          return {
            executed: true,
            action: 'update_lead',
            fields: Object.keys(node.data.config?.fields || {})
          }

        case 'add_tag':
          // Adicionar tag
          const tagName = node.data.config?.tagName
          if (!tagName) {
            throw new Error('Nome da tag não especificado')
          }

          await crmService.addTag({
            leadId: context.leadId,
            companyId: context.companyId,
            tagName
          })

          return {
            executed: true,
            action: 'add_tag',
            tagName
          }

        case 'remove_tag':
          // Remover tag
          const removeTagName = node.data.config?.tagName
          if (!removeTagName) {
            throw new Error('Nome da tag não especificado')
          }

          await crmService.removeTag({
            leadId: context.leadId,
            companyId: context.companyId,
            tagName: removeTagName
          })

          return {
            executed: true,
            action: 'remove_tag',
            tagName: removeTagName
          }

        case 'assign_owner':
          // Atribuir responsável
          const ownerId = node.data.config?.userId
          if (!ownerId) {
            throw new Error('ID do responsável não especificado')
          }

          const ownerResult = await crmService.assignOwner({
            leadId: context.leadId,
            companyId: context.companyId,
            ownerId
          })

          return {
            executed: true,
            action: 'assign_owner',
            ownerId,
            ownerName: ownerResult.ownerName
          }

        case 'move_opportunity':
          // Mover oportunidade
          if (!context.opportunityId) {
            throw new Error('ID da oportunidade não encontrado no contexto')
          }

          const stageId = node.data.config?.stageId
          if (!stageId) {
            throw new Error('ID da etapa não especificado')
          }

          await crmService.moveOpportunity(
            context.opportunityId,
            stageId,
            context.companyId
          )

          return {
            executed: true,
            action: 'move_opportunity',
            opportunityId: context.opportunityId,
            stageId
          }

        case 'win_opportunity':
          // Ganhar oportunidade
          if (!context.opportunityId) {
            throw new Error('ID da oportunidade não encontrado no contexto')
          }

          await crmService.winOpportunity(
            context.opportunityId,
            context.companyId,
            {
              finalValue: node.data.config?.finalValue,
              notes: node.data.config?.notes
            }
          )

          return {
            executed: true,
            action: 'win_opportunity',
            opportunityId: context.opportunityId
          }

        case 'lose_opportunity':
          // Perder oportunidade
          if (!context.opportunityId) {
            throw new Error('ID da oportunidade não encontrado no contexto')
          }

          await crmService.loseOpportunity(
            context.opportunityId,
            context.companyId,
            {
              lossReason: node.data.config?.lossReason,
              notes: node.data.config?.notes
            }
          )

          return {
            executed: true,
            action: 'lose_opportunity',
            opportunityId: context.opportunityId
          }

        case 'set_custom_field':
          // Definir campo personalizado
          const fieldId = node.data.config?.customFieldId
          const fieldValue = node.data.config?.customFieldValue

          if (!fieldId) {
            throw new Error('Campo personalizado não especificado')
          }

          if (fieldValue === undefined || fieldValue === '') {
            throw new Error('Valor do campo personalizado não especificado')
          }

          const customFieldResult = await crmService.setCustomField({
            leadId: context.leadId,
            companyId: context.companyId,
            fieldId,
            value: String(fieldValue)
          })

          return {
            executed: true,
            action: 'set_custom_field',
            fieldId,
            value: fieldValue,
            actionType: customFieldResult.action
          }

        case 'send_webhook':
          const webhookUrl = node.data.config?.webhookUrl
          const authToken = node.data.config?.authToken
          if (!webhookUrl) throw new Error('URL do webhook não especificada')
          const payload = webhookService.buildPayload(context)
          const webhookResult = await webhookService.sendWebhook(webhookUrl, payload, authToken)
          if (!webhookResult.success) throw new Error(webhookResult.error || 'Falha ao enviar webhook')
          return { executed: true, action: 'send_webhook', url: webhookUrl, status: webhookResult.status }

        case 'create_activity':
          if (!context.leadId) throw new Error('Lead ID não encontrado')
          const activityData = await activityService.createActivity({
            leadId: context.leadId,
            companyId: context.companyId,
            userId: context.triggerData.userId || context.triggerData.owner_user_id,
            title: node.data.config?.activityTitle,
            activityType: node.data.config?.activityType || 'call',
            scheduledDate: node.data.config?.scheduledDate,
            scheduledTime: node.data.config?.scheduledTime || '14:00',
            description: node.data.config?.activityDescription,
            priority: node.data.config?.activityPriority || 'medium'
          })
          return { executed: true, action: 'create_activity', activityId: activityData.id }

        case 'update_activity':
          if (!context.leadId) throw new Error('Lead ID não encontrado')
          const updateCount = await activityService.updateActivities(
            context.companyId,
            { leadId: context.leadId, status: node.data.config?.filterStatus || 'pending' },
            { priority: node.data.config?.newPriority }
          )
          return { executed: true, action: 'update_activity', count: updateCount }

        case 'complete_activity':
          if (!context.leadId) throw new Error('Lead ID não encontrado')
          const completeCount = await activityService.completeActivities(
            context.companyId,
            context.triggerData.userId || context.triggerData.owner_user_id,
            { leadId: context.leadId, status: 'pending' },
            node.data.config?.completionNotes
          )
          return { executed: true, action: 'complete_activity', count: completeCount }

        case 'cancel_activity':
          if (!context.leadId) throw new Error('Lead ID não encontrado')
          const cancelCount = await activityService.cancelActivities(
            context.companyId,
            { leadId: context.leadId, status: 'pending' },
            node.data.config?.cancellationReason
          )
          return { executed: true, action: 'cancel_activity', count: cancelCount }

        case 'reschedule_activity':
          if (!context.leadId) throw new Error('Lead ID não encontrado')
          const rescheduleCount = await activityService.rescheduleActivities(
            context.companyId,
            { leadId: context.leadId, status: 'pending' },
            node.data.config?.daysOffset || 0,
            node.data.config?.newTime
          )
          return { executed: true, action: 'reschedule_activity', count: rescheduleCount }
        case 'send_notification':
          const recipientType = node.data.config?.recipientType || 'owner'
          const recipients = await notificationService.resolveRecipients(recipientType, {
            ...context,
            specificUserId: node.data.config?.specificUserId
          })
          
          for (const userId of recipients) {
            await notificationService.sendNotification({
              companyId: context.companyId,
              userId,
              title: node.data.config?.notificationTitle || 'Notificação',
              message: node.data.config?.notificationMessage || '',
              notificationType: node.data.config?.notificationType || 'info',
              priority: node.data.config?.notificationPriority || 'normal',
              actionType: 'open_lead',
              actionData: { leadId: context.leadId },
              source: 'automation',
              sourceFlowId: context.flowId,
              leadId: context.leadId,
              opportunityId: context.opportunityId
            })
          }
          return { executed: true, action: 'send_notification', count: recipients.length }
        case 'trigger_automation':
  const targetFlowId = node.data.config?.targetFlowId
  if (!targetFlowId) throw new Error('Automação não especificada')
  
  if (node.data.config?.onlyIfActive !== false) {
    const targetFlow = await this.getFlow(targetFlowId)
    if (!targetFlow?.is_active) {
      return { executed: false, action: 'trigger_automation', reason: 'inactive' }
    }
  }
  
  const triggerData = node.data.config?.passCurrentContext ? {
    ...context.triggerData,
    leadId: context.leadId,
    opportunityId: context.opportunityId
  } : {}
  
  this.executeFlow(targetFlowId, triggerData, context.companyId)
  return { executed: true, action: 'trigger_automation', targetFlowId }

        default:
          console.warn('⚠️ Tipo de ação desconhecido:', actionType)
          return {
            executed: false,
            error: 'Tipo de ação desconhecido'
          }
      }
    } catch (error: any) {
      console.error('❌ Erro ao executar ação CRM:', error)
      throw error
    }
  }

  /**
   * FASE 5.4: Avalia condição REAL (refatorado para suportar múltiplos tipos)
   */
  private async evaluateCondition(node: Node, context: ExecutionContext): Promise<any> {
    try {
      console.log('❓ Avaliando condição...', node.data.config)

      const config = node.data.config
      const conditionType = config?.type

      if (!conditionType) {
        // Fallback para condições antigas (compatibilidade)
        return await this.evaluateLegacyCondition(node, context)
      }

      // Avaliar baseado no tipo de condição
      let result = false

      switch (conditionType) {
        case 'lead_field':
          result = await this.evaluateLeadField(config, context)
          break

        case 'lead_tags':
          result = await this.evaluateLeadTags(config, context)
          break

        case 'lead_source':
          result = await this.evaluateLeadSource(config, context)
          break

        case 'lead_created_date':
          result = await this.evaluateLeadCreatedDate(config, context)
          break

        case 'last_interaction':
          result = await this.evaluateLastInteraction(config, context)
          break

        case 'lead_score':
          result = await this.evaluateLeadScore(config, context)
          break

        case 'opportunity_stage':
          result = await this.evaluateOpportunityStage(config, context)
          break

        case 'opportunity_value':
          result = await this.evaluateOpportunityValue(config, context)
          break

        case 'opportunity_owner':
          result = await this.evaluateOpportunityOwner(config, context)
          break

        case 'opportunity_stage_duration':
          result = await this.evaluateOpportunityStageDuration(config, context)
          break

        case 'day_of_week':
          result = await this.evaluateDayOfWeek(config, context)
          break

        case 'time_of_day':
          result = await this.evaluateTimeOfDay(config, context)
          break

        case 'day_of_month':
          result = await this.evaluateDayOfMonth(config, context)
          break

        default:
          console.warn('⚠️ Tipo de condição não implementado:', conditionType)
          result = false
      }

      console.log('✅ Condição avaliada:', {
        type: conditionType,
        operator: config.operator,
        result
      })

      return {
        result,
        type: conditionType,
        operator: config.operator,
        value: config.value
      }
    } catch (error: any) {
      console.error('❌ Erro ao avaliar condição:', error)
      throw error
    }
  }

  /**
   * Avalia condição legada (compatibilidade com sistema antigo)
   */
  private async evaluateLegacyCondition(node: Node, context: ExecutionContext): Promise<any> {
    const field = node.data.config?.field
    const operator = node.data.config?.operator || 'equals'
    const value = node.data.config?.value

    if (!field) {
      throw new Error('Campo não especificado na condição')
    }

    let fieldValue: any = null

    if (context.leadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('*')
        .eq('id', Number(context.leadId))
        .single()

      if (lead) {
        fieldValue = this.getNestedValue(lead, field)
      }
    }

    let result = false

    switch (operator) {
      case 'equals':
        result = fieldValue == value
        break
      case 'not_equals':
        result = fieldValue != value
        break
      case 'contains':
        result = String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase())
        break
      case 'not_contains':
        result = !String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase())
        break
      case 'is_empty':
        result = !fieldValue || fieldValue === '' || fieldValue === null
        break
      case 'is_not_empty':
        result = !!fieldValue && fieldValue !== ''
        break
      case 'greater_than':
        result = Number(fieldValue) > Number(value)
        break
      case 'less_than':
        result = Number(fieldValue) < Number(value)
        break
      default:
        result = false
    }

    return { result, field, operator, expectedValue: value, actualValue: fieldValue }
  }

  /**
   * AVALIADORES ESPECÍFICOS POR TIPO DE CONDIÇÃO
   */

  private async evaluateLeadField(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.leadId) return false

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', Number(context.leadId))
      .single()

    if (!lead) return false

    const fieldValue = this.getNestedValue(lead, config.field)
    const { operator, value } = config

    switch (operator) {
      case 'equals':
        return fieldValue == value
      case 'not_equals':
        return fieldValue != value
      case 'contains':
        return String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase())
      case 'not_contains':
        return !String(fieldValue || '').toLowerCase().includes(String(value || '').toLowerCase())
      case 'is_empty':
        return !fieldValue || fieldValue === '' || fieldValue === null
      case 'is_not_empty':
        return !!fieldValue && fieldValue !== ''
      default:
        return false
    }
  }

  private async evaluateLeadTags(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.leadId) return false

    const { data: leadTags } = await supabase
      .from('lead_tag_assignments')
      .select('tag_id')
      .eq('lead_id', Number(context.leadId))

    const leadTagIds = leadTags?.map(lt => lt.tag_id) || []
    const { operator, tags } = config

    switch (operator) {
      case 'has_tag':
        return tags.some((tagId: string) => leadTagIds.includes(tagId))
      case 'not_has_tag':
        return !tags.some((tagId: string) => leadTagIds.includes(tagId))
      case 'has_any_tag':
        return tags.some((tagId: string) => leadTagIds.includes(tagId))
      case 'has_all_tags':
        return tags.every((tagId: string) => leadTagIds.includes(tagId))
      default:
        return false
    }
  }

  private async evaluateLeadSource(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.leadId) return false

    const { data: lead } = await supabase
      .from('leads')
      .select('source')
      .eq('id', Number(context.leadId))
      .single()

    if (!lead) return false

    const { operator, value } = config

    switch (operator) {
      case 'equals':
        return lead.source === value
      case 'not_equals':
        return lead.source !== value
      case 'contains':
        return String(lead.source || '').toLowerCase().includes(String(value || '').toLowerCase())
      default:
        return false
    }
  }

  private async evaluateLeadCreatedDate(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.leadId) return false

    const { data: lead } = await supabase
      .from('leads')
      .select('created_at')
      .eq('id', Number(context.leadId))
      .single()

    if (!lead) return false

    const createdAt = new Date(lead.created_at)
    const now = new Date()
    const { operator, value, unit } = config

    const diffMs = now.getTime() - createdAt.getTime()
    const diffDays = diffMs / (1000 * 60 * 60 * 24)

    switch (operator) {
      case 'is_today':
        return createdAt.toDateString() === now.toDateString()
      case 'is_yesterday':
        const yesterday = new Date(now)
        yesterday.setDate(yesterday.getDate() - 1)
        return createdAt.toDateString() === yesterday.toDateString()
      case 'is_this_week':
        return diffDays <= 7
      case 'is_this_month':
        return createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear()
      case 'is_older_than':
        const unitMultiplier = unit === 'weeks' ? 7 : unit === 'months' ? 30 : 1
        return diffDays > (value * unitMultiplier)
      case 'is_newer_than':
        const unitMult = unit === 'weeks' ? 7 : unit === 'months' ? 30 : 1
        return diffDays < (value * unitMult)
      default:
        return false
    }
  }

  private async evaluateLastInteraction(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.leadId) return false

    const { data: messages } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('lead_id', Number(context.leadId))
      .order('created_at', { ascending: false })
      .limit(1)

    if (!messages || messages.length === 0) {
      return config.operator === 'never_interacted'
    }

    const lastInteraction = new Date(messages[0].created_at)
    const now = new Date()
    const diffMs = now.getTime() - lastInteraction.getTime()
    
    const { operator, value, unit } = config
    let diffInUnit = 0

    switch (unit) {
      case 'hours':
        diffInUnit = diffMs / (1000 * 60 * 60)
        break
      case 'days':
        diffInUnit = diffMs / (1000 * 60 * 60 * 24)
        break
      case 'weeks':
        diffInUnit = diffMs / (1000 * 60 * 60 * 24 * 7)
        break
      default:
        diffInUnit = diffMs / (1000 * 60 * 60 * 24)
    }

    switch (operator) {
      case 'is_older_than':
        return diffInUnit > value
      case 'is_newer_than':
        return diffInUnit < value
      case 'never_interacted':
        return false
      default:
        return false
    }
  }

  private async evaluateLeadScore(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.leadId) return false

    const { data: lead } = await supabase
      .from('leads')
      .select('score')
      .eq('id', Number(context.leadId))
      .single()

    if (!lead) return false

    const score = lead.score || 0
    const { operator, value } = config

    switch (operator) {
      case 'equals':
        return score === value
      case 'greater_than':
        return score > value
      case 'less_than':
        return score < value
      case 'between':
        return score >= value.min && score <= value.max
      default:
        return false
    }
  }

  private async evaluateOpportunityStage(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.opportunityId) return false

    const { data: opportunity } = await supabase
      .from('opportunities')
      .select('stage_id')
      .eq('id', context.opportunityId)
      .single()

    if (!opportunity) return false

    const { operator, value } = config

    switch (operator) {
      case 'is':
        return opportunity.stage_id === value
      case 'is_not':
        return opportunity.stage_id !== value
      case 'is_in':
        return Array.isArray(value) && value.includes(opportunity.stage_id)
      default:
        return false
    }
  }

  private async evaluateOpportunityValue(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.opportunityId) return false

    const { data: opportunity } = await supabase
      .from('opportunities')
      .select('value')
      .eq('id', context.opportunityId)
      .single()

    if (!opportunity) return false

    const oppValue = opportunity.value || 0
    const { operator, value } = config

    switch (operator) {
      case 'equals':
        return oppValue === value
      case 'greater_than':
        return oppValue > value
      case 'less_than':
        return oppValue < value
      case 'between':
        return oppValue >= value.min && oppValue <= value.max
      default:
        return false
    }
  }

  private async evaluateOpportunityOwner(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.opportunityId) return false

    const { data: opportunity } = await supabase
      .from('opportunities')
      .select('owner_id')
      .eq('id', context.opportunityId)
      .single()

    if (!opportunity) return false

    const { operator, value } = config

    switch (operator) {
      case 'is':
        return opportunity.owner_id === value
      case 'is_not':
        return opportunity.owner_id !== value
      case 'has_no_owner':
        return !opportunity.owner_id
      default:
        return false
    }
  }

  private async evaluateOpportunityStageDuration(config: any, context: ExecutionContext): Promise<boolean> {
    if (!context.opportunityId) return false

    const { data: opportunity } = await supabase
      .from('opportunities')
      .select('stage_changed_at')
      .eq('id', context.opportunityId)
      .single()

    if (!opportunity || !opportunity.stage_changed_at) return false

    const stageChangedAt = new Date(opportunity.stage_changed_at)
    const now = new Date()
    const diffMs = now.getTime() - stageChangedAt.getTime()
    
    const { operator, value, unit } = config
    let diffInUnit = 0

    switch (unit) {
      case 'hours':
        diffInUnit = diffMs / (1000 * 60 * 60)
        break
      case 'days':
        diffInUnit = diffMs / (1000 * 60 * 60 * 24)
        break
      case 'weeks':
        diffInUnit = diffMs / (1000 * 60 * 60 * 24 * 7)
        break
      default:
        diffInUnit = diffMs / (1000 * 60 * 60 * 24)
    }

    switch (operator) {
      case 'is_longer_than':
        return diffInUnit > value
      case 'is_shorter_than':
        return diffInUnit < value
      default:
        return false
    }
  }

  private async evaluateDayOfWeek(config: any, context: ExecutionContext): Promise<boolean> {
    const now = new Date()
    const currentDay = now.getDay()
    const { operator, value } = config

    switch (operator) {
      case 'is':
        return currentDay === value
      case 'is_not':
        return currentDay !== value
      case 'is_in':
        return Array.isArray(value) && value.includes(currentDay)
      default:
        return false
    }
  }

  private async evaluateTimeOfDay(config: any, context: ExecutionContext): Promise<boolean> {
    const now = new Date()
    const currentTime = now.getHours() * 60 + now.getMinutes()
    const { operator, value } = config

    const parseTime = (timeStr: string) => {
      const [hours, minutes] = timeStr.split(':').map(Number)
      return hours * 60 + minutes
    }

    switch (operator) {
      case 'is_between':
        const start = parseTime(value.start)
        const end = parseTime(value.end)
        return currentTime >= start && currentTime <= end
      case 'is_before':
        const before = parseTime(value)
        return currentTime < before
      case 'is_after':
        const after = parseTime(value)
        return currentTime > after
      default:
        return false
    }
  }

  private async evaluateDayOfMonth(config: any, context: ExecutionContext): Promise<boolean> {
    const now = new Date()
    const currentDay = now.getDate()
    const { operator, value } = config

    switch (operator) {
      case 'is':
        return currentDay === value
      case 'is_between':
        return currentDay >= value.start && currentDay <= value.end
      case 'is_first_day':
        return currentDay === 1
      case 'is_last_day':
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        return currentDay === lastDay
      default:
        return false
    }
  }

  /**
   * Obtém valor de campo aninhado (ex: "company.name")
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj)
  }

  /**
   * FASE 5.2: Executa delay síncrono (para delays curtos)
   */
  private async executeDelay(node: Node, context: ExecutionContext): Promise<any> {
    try {
      const duration = node.data.config?.duration || 1
      const unit = node.data.config?.unit || 'seconds'

      // Converter para milissegundos
      let delayMs = duration * 1000 // padrão: segundos
      if (unit === 'minutes') {
        delayMs = duration * 60 * 1000
      } else if (unit === 'hours') {
        delayMs = duration * 60 * 60 * 1000
      }

      console.log(`⏱️ Aguardando ${duration} ${unit}...`)

      // Aguardar o tempo configurado
      await new Promise(resolve => setTimeout(resolve, delayMs))

      console.log(`✅ Delay de ${duration} ${unit} concluído`)

      return {
        delayed: true,
        duration,
        unit,
        delayMs
      }
    } catch (error: any) {
      console.error('❌ Erro ao executar delay:', error)
      throw error
    }
  }

  /**
   * FASE 5.3: Agenda delay REAL
   */
  private async scheduleDelay(node: Node, context: ExecutionContext): Promise<any> {
    try {
      console.log('⏱️ Agendando delay...')

      const duration = node.data.config?.duration || 1
      const unit = node.data.config?.unit || 'minutes'
      const businessHoursOnly = node.data.config?.businessHoursOnly || false

      // Calcular quando retomar
      const resumeAt = scheduleService.calculateResumeAt(duration, unit)

      // Criar agendamento
      const scheduleId = await scheduleService.createSchedule({
        executionId: context.executionId,
        flowId: context.flowId,
        companyId: context.companyId,
        currentNodeId: node.id,
        resumeAt,
        delayConfig: {
          duration,
          unit,
          businessHoursOnly
        }
      })

      console.log('✅ Delay agendado:', {
        scheduleId,
        resumeAt: resumeAt.toISOString(),
        duration,
        unit
      })

      // Retornar informação do agendamento
      // IMPORTANTE: Quando há delay, a execução é pausada
      // e será retomada pelo cron job
      return {
        delayed: true,
        scheduleId,
        resumeAt: resumeAt.toISOString(),
        duration,
        unit,
        businessHoursOnly,
        // Flag especial para indicar que a execução deve pausar
        pauseExecution: true
      }
    } catch (error: any) {
      console.error('❌ Erro ao agendar delay:', error)
      throw error
    }
  }

  /**
   * FASE 5.1: Envia mensagem WhatsApp REAL
   */
  private async sendWhatsAppMessage(node: Node, context: ExecutionContext): Promise<any> {
    try {
      console.log('💬 Enviando mensagem WhatsApp...')

      // Tentar obter dados do lead do triggerData primeiro (evita problema de RLS)
      let lead: any = context.triggerData?.lead || context.triggerData?.opportunity?.lead

      // Se não tiver no triggerData, validar se tem IDs para buscar
      if (!lead) {
        if (!context.leadId && !context.opportunityId) {
          throw new Error('Lead ID ou Opportunity ID não encontrado no contexto')
        }

        // Fallback: buscar lead diretamente (pode falhar por RLS)
        const { data: leadData, error: leadError } = await supabase
          .from('leads')
          .select('phone, name, email, company, city, state')
          .eq('id', Number(context.leadId))
          .single()

        if (leadError || !leadData) {
          throw new Error('Lead não encontrado - certifique-se de incluir dados do lead no triggerData')
        }

        lead = leadData
      }

      if (!lead) {
        throw new Error('Dados do lead não disponíveis')
      }

      if (!lead.phone) {
        throw new Error('Lead não possui telefone cadastrado')
      }

      // Buscar variáveis do lead
      const leadVariables = context.leadId 
        ? await whatsAppService.getLeadVariables(context.leadId)
        : {}

      // Mesclar variáveis do contexto com variáveis do lead
      const allVariables = {
        ...context.variables,
        ...leadVariables
      }

      // Obter mensagem/caption/question configurada
      // Para nós user_input, a mensagem está no campo 'question'
      let message = node.data.config?.message || 
                    node.data.config?.caption || 
                    node.data.config?.question || 
                    ''

      // Substituir variáveis SEMPRE (não depende de flag)
      message = whatsAppService.replaceVariables(message, allVariables)

      // Detectar tipo de mensagem e preparar dados
      const messageType = node.data.config?.messageType || 'text'
      let mediaUrl = null
      let messageTypeForApi = 'text'

      // Processar arquivo se tipo for 'file'
      if (messageType === 'file') {
        mediaUrl = node.data.config?.fileUrl
        
        if (!mediaUrl) {
          throw new Error('Arquivo não configurado - fileUrl ausente')
        }
        
        // Mapear fileType para message_type da API
        const fileType = node.data.config?.fileType
        messageTypeForApi = fileType || 'document'  // image, video, audio, document
        
        console.log('📎 AutomationEngine: Enviando arquivo:', {
          fileType: fileType,
          fileUrl: mediaUrl.substring(0, 50) + '...',
          caption: message.substring(0, 50),
          messageTypeForApi: messageTypeForApi
        })
      } else if (messageType === 'audio') {
        // Processar áudio gravado ou anexado
        mediaUrl = node.data.config?.audioUrl
        
        if (!mediaUrl) {
          throw new Error('Áudio não configurado - audioUrl ausente')
        }
        
        messageTypeForApi = 'audio'
        
        console.log('🎙️ AutomationEngine: Enviando áudio:', {
          audioUrl: mediaUrl.substring(0, 50) + '...',
          messageTypeForApi: messageTypeForApi
        })
      } else {
        // Mensagem de texto pode ter mediaUrl opcional (retrocompatibilidade)
        mediaUrl = node.data.config?.mediaUrl
        messageTypeForApi = mediaUrl ? 'image' : 'text'
      }

      // Validar mensagem apenas se não for arquivo sem caption
      if (!message.trim() && !mediaUrl) {
        throw new Error('Mensagem vazia')
      }

      // ✅ PRIORIZAR instanceId sobre conversationId
      // Priorizar instanceId do trigger (context), fallback para instanceId do card
      const instanceId = context.instanceId || node.data.config?.instanceId
      let conversationId: string | undefined

      if (instanceId) {
        // ✅ TEM instanceId configurado: SEMPRE criar/buscar conversa com essa instância
        // ✅ IGNORA conversationId do triggerData para garantir instância correta
        
        console.log('📱 Instância configurada detectada:', {
          source: context.instanceId ? 'trigger' : 'card',
          instanceId
        })

        // ✅ Validar status da instância ANTES de criar conversa
        const { data: instance, error: instanceError } = await supabase
          .from('whatsapp_life_instances')
          .select('id, instance_name, status, phone_number')
          .eq('id', instanceId)
          .eq('company_id', context.companyId)
          .single()

        if (instanceError || !instance) {
          throw new Error(`Instância WhatsApp não encontrada (ID: ${instanceId})`)
        }

        if (instance.status !== 'connected') {
          // ✅ Notificar admins/owners sobre instância desconectada
          await this.notifyInstanceDisconnected(
            context,
            instance,
            node.data.label || 'Enviar Mensagem WhatsApp'
          )
          
          // ✅ Falhar com erro claro
          throw new Error(
            `Instância "${instance.instance_name}" está ${instance.status}. ` +
            `Conecte a instância antes de enviar mensagens.`
          )
        }

        console.log('✅ Instância validada:', {
          instanceName: instance.instance_name,
          status: instance.status,
          phone: instance.phone_number
        })

        console.log('📱 Criando/buscando conversa com instância:', {
          source: context.instanceId ? 'trigger' : 'card',
          instanceId,
          instanceName: instance.instance_name,
          phone: lead.phone
        })

        // Criar ou buscar conversa com instância específica
        const conversation = await ChatApi.createOrGetConversation(
          context.companyId,
          instanceId,
          lead.phone,
          lead.name
        )

        conversationId = conversation.id
        console.log('✅ Conversa criada/encontrada com instância configurada:', conversationId)

        // ✅ PROPAGAR instanceId para próximos nós (se não veio do trigger)
        if (!context.instanceId && instanceId) {
          context.instanceId = instanceId
          console.log('✅ instanceId propagado para próximos nós:', {
            instanceId,
            instanceName: instance.instance_name,
            source: 'primeiro card'
          })
        }
      } else {
        // ✅ NÃO tem instanceId: usar conversationId do triggerData (fallback)
        conversationId = context.triggerData?.conversation_id || 
                         context.triggerData?.opportunity?.conversation_id
        
        if (!conversationId) {
          throw new Error('Instância WhatsApp não configurada. Configure no gatilho ou no card de mensagem.')
        }

        console.log('✅ Usando conversationId do triggerData (sem instanceId configurado):', conversationId)
      }

      // Enviar mensagem
      const result = await whatsAppService.sendMessage({
        phone: lead.phone,
        message,
        leadId: context.leadId,
        companyId: context.companyId,
        conversationId: conversationId,
        mediaUrl: mediaUrl,
        messageType: messageTypeForApi,  // Passar tipo correto para API
        buttons: node.data.config?.buttons
      })

      if (!result.success) {
        throw new Error(result.error || 'Erro ao enviar mensagem')
      }

      console.log('✅ Mensagem WhatsApp enviada com sucesso')

      return {
        sent: true,
        messageId: result.messageId,
        to: lead.phone,
        message: message.substring(0, 100) // Primeiros 100 caracteres para log
      }
    } catch (error: any) {
      console.error('❌ Erro ao enviar mensagem WhatsApp:', error)
      throw error
    }
  }

  /**
   * Notifica admins/owners quando automação falha por instância desconectada
   */
  private async notifyInstanceDisconnected(
    context: ExecutionContext,
    instance: any,
    actionName: string
  ): Promise<void> {
    try {
      // Buscar admin/owner da empresa para notificar
      const { data: companyUsers } = await supabase
        .from('company_users')
        .select('user_id, role')
        .eq('company_id', context.companyId)
        .eq('is_active', true)
        .in('role', ['owner', 'admin'])
        .limit(5)

      if (!companyUsers || companyUsers.length === 0) {
        console.warn('⚠️ Nenhum admin/owner encontrado para notificar')
        return
      }

      // Buscar nome do fluxo
      const { data: flow } = await supabase
        .from('automation_flows')
        .select('name')
        .eq('id', context.flowId)
        .single()

      const flowName = flow?.name || 'Automação'

      // Enviar notificação para cada admin/owner
      for (const user of companyUsers) {
        await notificationService.sendNotification({
          companyId: context.companyId,
          userId: user.user_id,
          title: '⚠️ Automação Falhou - Instância Desconectada',
          message: 
            `A automação "${flowName}" falhou ao executar "${actionName}" ` +
            `porque a instância WhatsApp "${instance.instance_name}" está desconectada. ` +
            `Conecte a instância para que as automações funcionem corretamente.`,
          notificationType: 'error',
          priority: 'high',
          actionType: 'reconnect_whatsapp_instance',
          actionData: {
            instanceId: instance.id,
            instanceName: instance.instance_name,
            instanceStatus: instance.status,
            flowId: context.flowId,
            flowName: flowName,
            executionId: context.executionId
          },
          source: 'automation',
          sourceFlowId: context.flowId,
          leadId: context.leadId,
          opportunityId: context.opportunityId
        })
      }

      console.log('✅ Notificações enviadas para admins/owners:', {
        instanceName: instance.instance_name,
        recipients: companyUsers.length
      })
    } catch (error) {
      console.error('❌ Erro ao enviar notificação:', error)
      // Não propagar erro - notificação é secundária
    }
  }

  /**
   * Executa distribuição de leads entre usuários
   */
  private async executeDistribution(node: Node, context: ExecutionContext): Promise<any> {
    try {
      console.log('🔄 Executando distribuição de lead...', node.data.config)

      const config = node.data.config
      const { method, users } = config

      if (!users || users.length === 0) {
        throw new Error('Nenhum usuário configurado para distribuição')
      }

      if (!context.leadId) {
        throw new Error('Lead ID não encontrado no contexto')
      }

      let selectedUserId: string | null = null

      switch (method) {
        case 'round_robin':
          selectedUserId = await this.distributeRoundRobin(users, context.companyId)
          break
        case 'availability':
          selectedUserId = await this.distributeByAvailability(users, config)
          break
        case 'workload':
          selectedUserId = await this.distributeByWorkload(users, config, context.companyId)
          break
        case 'region':
          selectedUserId = await this.distributeByRegion(config, context.leadId)
          break
        default:
          throw new Error(`Método de distribuição desconhecido: ${method}`)
      }

      if (!selectedUserId) {
        console.warn('⚠️ Nenhum usuário disponível para distribuição')
        return { distributed: false, reason: 'no_user_available' }
      }

      // Atribuir lead ao usuário selecionado
      const { error } = await supabase
        .from('leads')
        .update({ owner_id: selectedUserId })
        .eq('id', context.leadId)

      if (error) {
        throw new Error(`Erro ao atribuir lead: ${error.message}`)
      }

      console.log('✅ Lead distribuído com sucesso para usuário:', selectedUserId)

      return {
        distributed: true,
        user_id: selectedUserId,
        method,
        lead_id: context.leadId
      }
    } catch (error: any) {
      console.error('❌ Erro ao executar distribuição:', error)
      throw error
    }
  }

  /**
   * Distribuição Round Robin (Rodízio)
   */
  private async distributeRoundRobin(users: string[], companyId: string): Promise<string | null> {
    try {
      // Buscar último índice usado
      const { data: state } = await supabase
        .from('distribution_state')
        .select('last_user_index')
        .eq('company_id', companyId)
        .single()

      const lastIndex = state?.last_user_index ?? -1
      const nextIndex = (lastIndex + 1) % users.length
      const selectedUserId = users[nextIndex]

      // Salvar novo índice
      await supabase
        .from('distribution_state')
        .upsert({
          company_id: companyId,
          last_user_index: nextIndex,
          updated_at: new Date().toISOString()
        })

      console.log('🔄 Round Robin:', { lastIndex, nextIndex, selectedUserId })
      return selectedUserId
    } catch (error) {
      console.error('Erro no Round Robin:', error)
      return users[0] // Fallback para primeiro usuário
    }
  }

  /**
   * Distribuição por Disponibilidade
   */
  private async distributeByAvailability(users: string[], config: any): Promise<string | null> {
    try {
      if (!config.check_online_status) {
        // Se não verificar status, retorna primeiro usuário
        return users[0]
      }

      // Buscar usuários online (implementação futura com presença real-time)
      // Por enquanto, retorna primeiro usuário disponível
      const availableUsers = users.filter(userId => userId) // Placeholder

      if (availableUsers.length === 0) {
        if (config.skip_unavailable) {
          return null
        }
        return users[0] // Fallback
      }

      // Distribuir aleatoriamente entre disponíveis
      const randomIndex = Math.floor(Math.random() * availableUsers.length)
      return availableUsers[randomIndex]
    } catch (error) {
      console.error('Erro na distribuição por disponibilidade:', error)
      return users[0]
    }
  }

  /**
   * Distribuição por Carga de Trabalho
   */
  private async distributeByWorkload(users: string[], config: any, companyId: string): Promise<string | null> {
    try {
      // Contar leads ativos por usuário
      const userLeadCounts = await Promise.all(
        users.map(async (userId) => {
          const { count } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('owner_id', userId)
            .eq('company_id', companyId)
            .is('archived_at', null)

          return { userId, count: count || 0 }
        })
      )

      // Filtrar usuários que não atingiram o limite
      let availableUsers = userLeadCounts
      if (config.max_leads_per_user) {
        availableUsers = userLeadCounts.filter(u => u.count < config.max_leads_per_user)
      }

      if (availableUsers.length === 0) {
        if (config.skip_unavailable) {
          return null
        }
        availableUsers = userLeadCounts // Usar todos se nenhum disponível
      }

      // Selecionar usuário com menos leads
      const userWithLeastLeads = availableUsers.reduce((min, current) =>
        current.count < min.count ? current : min
      )

      console.log('📊 Workload:', { userLeadCounts, selected: userWithLeastLeads })
      return userWithLeastLeads.userId
    } catch (error) {
      console.error('Erro na distribuição por workload:', error)
      return users[0]
    }
  }

  /**
   * FASE 5.2: Trata entrada de usuário (user_input)
   * Envia a pergunta e PAUSA o fluxo aguardando resposta
   */
  private async handleUserInput(node: Node, context: ExecutionContext): Promise<any> {
    try {
      console.log('❓ Processando entrada de usuário (user_input)...')

      // 1. Enviar a pergunta ao usuário
      const result = await this.sendWhatsAppMessage(node, context)
      const messageId = result.messageId

      // 2. Mensagem enviada para processamento assíncrono
      // O endpoint /api/uazapi-send-message processa em background
      // Não precisamos aguardar status 'sent' antes de pausar
      if (messageId) {
        console.log('✅ Pergunta enviada para processamento assíncrono')
        console.log('📤 Message ID:', messageId)
        console.log('🚀 Mensagem será enviada ao WhatsApp em background')
      }

      // 3. Calcular timeout
      const timeoutValue = node.data.config?.timeoutValue || 24
      const timeoutUnit = node.data.config?.timeoutUnit || 'hours'
      
      let timeoutMinutes = 0
      switch (timeoutUnit) {
        case 'minutes':
          timeoutMinutes = timeoutValue
          break
        case 'hours':
          timeoutMinutes = timeoutValue * 60
          break
        case 'days':
          timeoutMinutes = timeoutValue * 60 * 24
          break
      }
      
      const timeoutAt = new Date(Date.now() + timeoutMinutes * 60 * 1000)
      
      console.log('⏰ Timeout configurado:', {
        value: timeoutValue,
        unit: timeoutUnit,
        expiresAt: timeoutAt.toISOString()
      })

      // 4. Pausar a execução IMEDIATAMENTE
      console.log('⏸️ PAUSANDO fluxo - Aguardando resposta do usuário')
      
      const variableName = node.data.config?.variable || 'user_response'
      
      await supabase
        .from('automation_executions')
        .update({
          status: 'paused',
          current_node_id: node.id,
          paused_at: new Date().toISOString(),
          timeout_at: timeoutAt.toISOString(),
          variables: {
            ...context.variables,
            _awaiting_input: {
              node_id: node.id,
              variable_name: variableName,
              question: node.data.config?.question,
              message_id: messageId,
              timeout_value: timeoutValue,
              timeout_unit: timeoutUnit
            }
          }
        })
        .eq('id', context.executionId)

      console.log(`✅ Fluxo pausado - Aguardando resposta (timeout: ${timeoutValue} ${timeoutUnit})`)

      // 5. Retornar indicador de pausa (não continuar processamento)
      return {
        paused: true,
        awaiting_input: true,
        variable: variableName,
        message_id: messageId,
        timeout_at: timeoutAt.toISOString()
      }
    } catch (error: any) {
      console.error('❌ Erro ao processar entrada de usuário:', error)
      throw error
    }
  }

  /**
   * Retoma execução pausada após receber resposta do usuário
   */
  async resumeExecution(executionId: string, userResponse: string): Promise<void> {
    try {
      console.log('▶️ Retomando execução pausada:', executionId)

      // 1. Buscar execução pausada
      const { data: execution, error } = await supabase
        .from('automation_executions')
        .select('*')
        .eq('id', executionId)
        .eq('status', 'paused')
        .single()

      if (error || !execution) {
        throw new Error('Execução pausada não encontrada')
      }

      // 2. Extrair informações da pausa
      const awaitingInput = execution.variables?._awaiting_input
      if (!awaitingInput) {
        throw new Error('Informações de pausa não encontradas')
      }

      // 3. Salvar resposta do usuário na variável
      const updatedVariables = {
        ...execution.variables,
        [awaitingInput.variable_name]: userResponse
      }
      delete updatedVariables._awaiting_input

      // 4. Atualizar execução para running
      await supabase
        .from('automation_executions')
        .update({
          status: 'running',
          variables: updatedVariables,
          paused_at: null
        })
        .eq('id', executionId)

      console.log(`✅ Resposta salva na variável: ${awaitingInput.variable_name} = "${userResponse}"`)

      // 5. Buscar fluxo
      const { data: flow } = await supabase
        .from('automation_flows')
        .select('*')
        .eq('id', execution.flow_id)
        .single()

      if (!flow) {
        throw new Error('Fluxo não encontrado')
      }

      // 6. Reconstruir contexto
      const context: ExecutionContext = {
        executionId: execution.id,
        flowId: execution.flow_id,
        companyId: execution.company_id,
        triggerData: execution.trigger_data,
        variables: updatedVariables,
        leadId: execution.lead_id || undefined,
        opportunityId: execution.opportunity_id || undefined
      }

      // 7. Encontrar próximo nó após o nó pausado
      const currentNode = flow.nodes.find((n: Node) => n.id === awaitingInput.node_id)
      if (!currentNode) {
        throw new Error('Nó atual não encontrado')
      }

      const nextNodes = this.getNextNodes(currentNode, flow.edges)
      
      // 8. Continuar processamento a partir do próximo nó
      console.log('🔄 Continuando execução a partir do próximo nó...')
      
      for (const nextNode of nextNodes) {
        await this.processNode(nextNode, context, flow.nodes, flow.edges)
      }

      // 9. Marcar execução como concluída
      await supabase
        .from('automation_executions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', executionId)

      console.log('✅ Execução retomada e concluída com sucesso')
    } catch (error: any) {
      console.error('❌ Erro ao retomar execução:', error)
      
      // Marcar execução como failed
      await supabase
        .from('automation_executions')
        .update({
          status: 'failed',
          error_message: error.message
        })
        .eq('id', executionId)
    }
  }

  /**
   * Distribuição por Região
   */
  private async distributeByRegion(config: any, leadId: number): Promise<string | null> {
    try {
      // Buscar lead para obter região
      const { data: lead } = await supabase
        .from('leads')
        .select('city, state')
        .eq('id', leadId)
        .single()

      if (!lead) {
        return config.default_user_id || null
      }

      // Tentar mapear por cidade ou estado
      const region = lead.city || lead.state
      if (!region) {
        return config.default_user_id || null
      }

      // Buscar mapeamento
      const mapping = config.region_mappings?.find((m: any) =>
        region.toLowerCase().includes(m.region.toLowerCase()) ||
        m.region.toLowerCase().includes(region.toLowerCase())
      )

      if (mapping && mapping.user_id) {
        console.log('🗺️ Região mapeada:', { region, userId: mapping.user_id })
        return mapping.user_id
      }

      // Fallback para usuário padrão
      return config.default_user_id || null
    } catch (error) {
      console.error('Erro na distribuição por região:', error)
      return config.default_user_id || null
    }
  }
}

// Exportar instância singleton
export const automationEngine = new AutomationEngine()
