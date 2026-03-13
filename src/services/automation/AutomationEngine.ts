// =====================================================
// SERVICE: AUTOMATION ENGINE
// Data: 13/03/2026
// Objetivo: Motor de execução de fluxos de automação
// IMPORTANTE: Implementação incremental e não-destrutiva
// =====================================================

import { supabase } from '../../lib/supabase'
import type { AutomationFlow, AutomationExecution, AutomationLog } from '../../types/automation'
import { Node, Edge } from 'reactflow'

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

    // Verificar se tem um trigger node
    const hasTrigger = flow.nodes.some((node: any) => node.type === 'trigger')
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
        lead_id: triggerData.lead_id,
        opportunity_id: triggerData.opportunity_id,
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

      // Encontrar o nó trigger (ponto de partida)
      const triggerNode = flow.nodes.find((node: any) => node.type === 'trigger')
      if (!triggerNode) {
        throw new Error('Nó trigger não encontrado')
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
        // Trigger não executa ação, apenas inicia o fluxo
        return { triggered: true, data: context.triggerData }

      case 'action':
        // TODO: Implementar ações (criar oportunidade, atualizar lead, etc)
        console.log('🎯 Ação:', node.data.config)
        return { executed: true, action: node.data.config?.actionType }

      case 'message':
        // TODO: Implementar envio de mensagem WhatsApp
        console.log('💬 Mensagem:', node.data.config?.message)
        return { sent: true, message: node.data.config?.message }

      case 'condition':
        // TODO: Implementar avaliação de condição
        console.log('❓ Condição:', node.data.config)
        return { result: true } // Por enquanto sempre true

      case 'delay':
        // TODO: Implementar delay (agendar próxima execução)
        console.log('⏱️ Delay:', node.data.config)
        return { delayed: true, duration: node.data.config?.duration }

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
      return []
    }

    // Para nós de condição, escolher o caminho baseado no resultado
    if (currentNode.type === 'condition') {
      const targetHandle = result?.result ? 'true' : 'false'
      const edge = outgoingEdges.find((e) => e.sourceHandle === targetHandle)
      if (edge) {
        const nextNode = allNodes.find((n) => n.id === edge.target)
        return nextNode ? [nextNode] : []
      }
      return []
    }

    // Para outros nós, seguir todas as conexões
    const nextNodes = outgoingEdges
      .map((edge) => allNodes.find((n) => n.id === edge.target))
      .filter((node): node is Node => node !== undefined)

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
}

// Exportar instância singleton
export const automationEngine = new AutomationEngine()
