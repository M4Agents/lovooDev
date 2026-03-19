// =====================================================
// SERVICE: AUTOMATION ENGINE
// Data: 13/03/2026
// Objetivo: Motor de execução de fluxos de automação
// IMPORTANTE: Implementação incremental e não-destrutiva
// =====================================================
import { notificationService } from './NotificationService'
import { supabase } from '../../lib/supabase'
import type { AutomationFlow, AutomationExecution, AutomationLog } from '../../types/automation'
import { Node, Edge } from 'reactflow'
import { whatsAppService } from './WhatsAppService'
import { crmService } from './CRMService'
import { scheduleService } from './ScheduleService'
import { webhookService } from './WebhookService'
import { activityService } from './ActivityService'

interface ExecutionContext {
  executionId: string
  flowId: string
  companyId: string
  triggerData: Record<string, any>
  variables: Record<string, any>
  leadId?: number
  opportunityId?: string
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

      const context: ExecutionContext = {
        executionId: execution.id,
        flowId: flow.id,
        companyId: execution.company_id,
        triggerData: execution.trigger_data,
        variables: execution.variables || {},
        leadId: execution.lead_id,
        opportunityId: execution.opportunity_id
      }

      // Encontrar o nó trigger/start (ponto de partida)
      const triggerNode = flow.nodes.find((node: any) => node.type === 'trigger' || node.type === 'start')
      if (!triggerNode) {
        throw new Error('Nó trigger/start não encontrado')
      }

      // Processar a partir do trigger
      await this.processNode(triggerNode as Node, flow.nodes as Node[], flow.edges as Edge[], context)

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
        // Enviar mensagem WhatsApp REAL
        return await this.sendWhatsAppMessage(node, context)

      case 'condition':
        // Avaliar condição REAL
        return await this.evaluateCondition(node, context)

      case 'delay':
        // Implementar delay REAL com agendamento
        return await this.scheduleDelay(node, context)

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
   * FASE 5.4: Avalia condição REAL
   */
  private async evaluateCondition(node: Node, context: ExecutionContext): Promise<any> {
    try {
      console.log('❓ Avaliando condição...')

      const field = node.data.config?.field
      const operator = node.data.config?.operator || 'equals'
      const value = node.data.config?.value

      if (!field) {
        throw new Error('Campo não especificado na condição')
      }

      // Buscar valor do campo no lead
      let fieldValue: any = null

      if (context.leadId) {
        const { data: lead } = await supabase
          .from('leads')
          .select('*')
          .eq('id', Number(context.leadId))
          .single()

        if (lead) {
          // Suportar campos aninhados (ex: "company.name")
          fieldValue = this.getNestedValue(lead, field)
        }
      }

      // Avaliar condição baseado no operador
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

        case 'greater_or_equal':
          result = Number(fieldValue) >= Number(value)
          break

        case 'less_or_equal':
          result = Number(fieldValue) <= Number(value)
          break

        default:
          console.warn('⚠️ Operador desconhecido:', operator)
          result = false
      }

      console.log('✅ Condição avaliada:', {
        field,
        operator,
        value,
        fieldValue,
        result
      })

      return {
        result,
        field,
        operator,
        expectedValue: value,
        actualValue: fieldValue
      }
    } catch (error: any) {
      console.error('❌ Erro ao avaliar condição:', error)
      throw error
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

      // Obter mensagem/caption configurada
      let message = node.data.config?.message || node.data.config?.caption || ''

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

      // Buscar conversationId do triggerData (mais eficiente)
      const conversationId = context.triggerData?.conversation_id || 
                            context.triggerData?.opportunity?.conversation_id

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
}

// Exportar instância singleton
export const automationEngine = new AutomationEngine()
