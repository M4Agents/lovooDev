// =====================================================
// SERVICE: USER INPUT HANDLER
// Data: 22/03/2026
// Objetivo: Capturar respostas de usuários e retomar execuções pausadas
// =====================================================

import { supabase } from '../../lib/supabase'
import { AutomationEngine } from './AutomationEngine'

export class UserInputHandler {
  private automationEngine: AutomationEngine

  constructor() {
    this.automationEngine = new AutomationEngine()
  }

  /**
   * Processa mensagem recebida e verifica se há execução pausada aguardando resposta
   */
  async handleIncomingMessage(
    conversationId: string,
    messageContent: string,
    leadId: number,
    companyId: string
  ): Promise<boolean> {
    try {
      console.log('🔍 Verificando execuções pausadas para conversation:', conversationId)

      // Buscar execuções pausadas para este lead/conversation
      const { data: pausedExecutions, error } = await supabase
        .from('automation_executions')
        .select('*')
        .eq('company_id', companyId)
        .eq('lead_id', leadId)
        .eq('status', 'paused')
        .order('paused_at', { ascending: false })
        .limit(1)

      if (error) {
        console.error('Erro ao buscar execuções pausadas:', error)
        return false
      }

      if (!pausedExecutions || pausedExecutions.length === 0) {
        console.log('ℹ️ Nenhuma execução pausada encontrada')
        return false
      }

      const execution = pausedExecutions[0]
      console.log('✅ Execução pausada encontrada:', execution.id)

      // Verificar se está aguardando input
      const awaitingInput = execution.variables?._awaiting_input
      if (!awaitingInput) {
        console.log('⚠️ Execução pausada mas não está aguardando input')
        return false
      }

      console.log(`📝 Retomando execução com resposta: "${messageContent}"`)

      // Retomar execução com a resposta do usuário
      await this.automationEngine.resumeExecution(execution.id, messageContent)

      return true
    } catch (error) {
      console.error('❌ Erro ao processar resposta de usuário:', error)
      return false
    }
  }

  /**
   * Verifica se há execuções pausadas para um lead específico
   */
  async hasPausedExecution(leadId: number, companyId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('automation_executions')
        .select('id')
        .eq('company_id', companyId)
        .eq('lead_id', leadId)
        .eq('status', 'paused')
        .limit(1)

      if (error) {
        console.error('Erro ao verificar execuções pausadas:', error)
        return false
      }

      return data && data.length > 0
    } catch (error) {
      console.error('❌ Erro ao verificar execuções pausadas:', error)
      return false
    }
  }

  /**
   * Lista todas as execuções pausadas de uma empresa
   */
  async listPausedExecutions(companyId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('automation_executions')
        .select(`
          id,
          flow_id,
          lead_id,
          status,
          current_node_id,
          variables,
          paused_at,
          automation_flows (
            name
          )
        `)
        .eq('company_id', companyId)
        .eq('status', 'paused')
        .order('paused_at', { ascending: false })

      if (error) {
        console.error('Erro ao listar execuções pausadas:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('❌ Erro ao listar execuções pausadas:', error)
      return []
    }
  }

  /**
   * Cancela uma execução pausada
   */
  async cancelPausedExecution(executionId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('automation_executions')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          error_message: 'Execução cancelada manualmente'
        })
        .eq('id', executionId)
        .eq('status', 'paused')

      if (error) {
        console.error('Erro ao cancelar execução:', error)
        return false
      }

      console.log('✅ Execução cancelada:', executionId)
      return true
    } catch (error) {
      console.error('❌ Erro ao cancelar execução:', error)
      return false
    }
  }
}

// Exportar instância singleton
export const userInputHandler = new UserInputHandler()
