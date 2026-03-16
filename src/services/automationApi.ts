// =====================================================
// SERVICE: AUTOMATION API
// Data: 13/03/2026
// Objetivo: Serviço para comunicação com APIs de automação
// =====================================================

import { supabase } from '../lib/supabase'
import type {
  AutomationFlow,
  AutomationExecution,
  AutomationLog,
  AutomationTemplate,
  CreateFlowForm,
  UpdateFlowForm,
  CompanyStats,
  FlowStats
} from '../types/automation'

// =====================================================
// FLOWS (Fluxos de Automação)
// =====================================================

export const automationApi = {
  // Listar todos os fluxos da empresa
  async getFlows(companyId: string): Promise<AutomationFlow[]> {
    const { data, error } = await supabase
      .from('automation_flows')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
  },

  // Buscar um fluxo específico
  async getFlow(id: string): Promise<AutomationFlow | null> {
    const { data, error } = await supabase
      .from('automation_flows')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  },

  // Criar novo fluxo
  async createFlow(companyId: string, flowData: CreateFlowForm): Promise<AutomationFlow> {
    const { data: userData } = await supabase.auth.getUser()
    
    const { data, error } = await supabase
      .from('automation_flows')
      .insert({
        company_id: companyId,
        name: flowData.name,
        description: flowData.description,
        category: flowData.category,
        triggers: flowData.triggers || [],
        trigger_type: flowData.trigger_type || 'pending',
        trigger_config: flowData.trigger_config || {},
        nodes: [],
        edges: [],
        is_active: false,
        created_by: userData?.user?.id
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Atualizar fluxo
  async updateFlow(id: string, updates: UpdateFlowForm): Promise<AutomationFlow> {
    const { data, error } = await supabase
      .from('automation_flows')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Salvar canvas do fluxo (nodes e edges)
  async saveFlowCanvas(id: string, canvasData: any): Promise<AutomationFlow> {
    const { data, error } = await supabase
      .from('automation_flows')
      .update({
        nodes: canvasData.nodes,
        edges: canvasData.edges,
        variables: canvasData.variables || {},
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Ativar/Desativar fluxo
  async toggleFlowActive(id: string, isActive: boolean): Promise<AutomationFlow> {
    const { data, error } = await supabase
      .from('automation_flows')
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Deletar fluxo
  async deleteFlow(id: string): Promise<void> {
    const { error } = await supabase
      .from('automation_flows')
      .delete()
      .eq('id', id)

    if (error) throw error
  },

  // Duplicar fluxo
  async duplicateFlow(id: string, companyId: string): Promise<AutomationFlow> {
    const original = await this.getFlow(id)
    if (!original) throw new Error('Fluxo não encontrado')

    const { data: userData } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('automation_flows')
      .insert({
        company_id: companyId,
        name: `${original.name} (Cópia)`,
        description: original.description,
        category: original.category,
        trigger_type: original.trigger_type,
        trigger_config: original.trigger_config,
        nodes: original.nodes,
        edges: original.edges,
        variables: original.variables,
        is_active: false,
        max_executions_per_day: original.max_executions_per_day,
        max_executions_per_lead: original.max_executions_per_lead,
        business_hours_only: original.business_hours_only,
        allowed_days_of_week: original.allowed_days_of_week,
        start_time: original.start_time,
        end_time: original.end_time,
        created_by: userData?.user?.id
      })
      .select()
      .single()

    if (error) throw error
    return data
  }
}

// =====================================================
// EXECUTIONS (Execuções)
// =====================================================

export const executionApi = {
  // Executar fluxo manualmente
  async executeFlow(flowId: string, companyId: string, triggerData?: any): Promise<string> {
    const response = await fetch('/api/automation/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flowId,
        companyId,
        triggerData: triggerData || {}
      })
    })

    if (!response.ok) {
      throw new Error('Erro ao executar fluxo')
    }

    const data = await response.json()
    return data.executionId
  },

  // Listar execuções de um fluxo
  async getExecutions(flowId: string, limit = 50): Promise<AutomationExecution[]> {
    const { data, error } = await supabase
      .from('automation_executions')
      .select('*')
      .eq('flow_id', flowId)
      .order('started_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data || []
  },

  // Buscar execução específica
  async getExecution(id: string): Promise<AutomationExecution | null> {
    const { data, error } = await supabase
      .from('automation_executions')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  },

  // Listar execuções por lead
  async getExecutionsByLead(leadId: number, limit = 20): Promise<AutomationExecution[]> {
    const { data, error } = await supabase
      .from('automation_executions')
      .select('*')
      .eq('lead_id', leadId)
      .order('started_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data || []
  },

  // Listar execuções por status
  async getExecutionsByStatus(
    companyId: string,
    status: string,
    limit = 50
  ): Promise<AutomationExecution[]> {
    const { data, error } = await supabase
      .from('automation_executions')
      .select('*')
      .eq('company_id', companyId)
      .eq('status', status)
      .order('started_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data || []
  }
}

// =====================================================
// LOGS
// =====================================================

export const logsApi = {
  // Listar logs de uma execução
  async getExecutionLogs(executionId: string): Promise<AutomationLog[]> {
    const { data, error } = await supabase
      .from('automation_logs')
      .select('*')
      .eq('execution_id', executionId)
      .order('executed_at', { ascending: true })

    if (error) throw error
    return data || []
  },

  // Listar logs de um fluxo
  async getFlowLogs(flowId: string, limit = 100): Promise<AutomationLog[]> {
    const { data, error } = await supabase
      .from('automation_logs')
      .select('*')
      .eq('flow_id', flowId)
      .order('executed_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data || []
  }
}

// =====================================================
// TEMPLATES
// =====================================================

export const templateApi = {
  // Listar templates disponíveis
  async getTemplates(companyId?: string): Promise<AutomationTemplate[]> {
    let query = supabase
      .from('automation_templates')
      .select('*')
      .order('usage_count', { ascending: false })

    // Templates públicos, de sistema ou da empresa
    if (companyId) {
      query = query.or(`is_public.eq.true,is_system.eq.true,company_id.eq.${companyId}`)
    } else {
      query = query.or('is_public.eq.true,is_system.eq.true')
    }

    const { data, error } = await query

    if (error) throw error
    return data || []
  },

  // Buscar template específico
  async getTemplate(id: string): Promise<AutomationTemplate | null> {
    const { data, error } = await supabase
      .from('automation_templates')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error
    return data
  },

  // Criar template a partir de um fluxo
  async createTemplateFromFlow(
    flowId: string,
    companyId: string,
    name: string,
    description?: string,
    isPublic = false
  ): Promise<AutomationTemplate> {
    const flow = await automationApi.getFlow(flowId)
    if (!flow) throw new Error('Fluxo não encontrado')

    const { data, error } = await supabase
      .from('automation_templates')
      .insert({
        company_id: companyId,
        name,
        description,
        category: flow.category,
        nodes: flow.nodes,
        edges: flow.edges,
        trigger_type: flow.trigger_type,
        trigger_config: flow.trigger_config,
        is_public: isPublic,
        is_system: false
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Criar fluxo a partir de um template
  async createFlowFromTemplate(
    templateId: string,
    companyId: string,
    name: string
  ): Promise<AutomationFlow> {
    const template = await this.getTemplate(templateId)
    if (!template) throw new Error('Template não encontrado')

    const { data: userData } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('automation_flows')
      .insert({
        company_id: companyId,
        name,
        description: template.description,
        category: template.category,
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config,
        nodes: template.nodes,
        edges: template.edges,
        is_active: false,
        created_by: userData?.user?.id
      })
      .select()
      .single()

    if (error) throw error

    // Incrementar contador de uso do template
    await supabase
      .from('automation_templates')
      .update({ usage_count: (template.usage_count || 0) + 1 })
      .eq('id', templateId)

    return data
  }
}

// =====================================================
// STATISTICS (Estatísticas)
// =====================================================

export const statsApi = {
  async getCompanyStats(companyId: string): Promise<CompanyStats> {
    const { data: flows } = await supabase
      .from('automation_flows')
      .select('*')
      .eq('company_id', companyId)

    const totalFlows = flows?.length || 0
    const activeFlows = flows?.filter((f: any) => f.is_active).length || 0
    const totalExecutions = flows?.reduce((sum: number, f: any) => sum + (f.execution_count || 0), 0) || 0
    const totalSuccess = flows?.reduce((sum: number, f: any) => sum + (f.success_count || 0), 0) || 0
    const successRate = totalExecutions > 0 ? (totalSuccess / totalExecutions) * 100 : 0

    return {
      totalFlows,
      activeFlows,
      totalExecutions,
      successRate: Math.round(successRate * 10) / 10
    }
  },

  async getFlowStats(flowId: string): Promise<FlowStats> {
    const { data: flow } = await supabase
      .from('automation_flows')
      .select('*')
      .eq('id', flowId)
      .single()

    if (!flow) {
      throw new Error('Fluxo não encontrado')
    }

    return {
      executionCount: flow.execution_count || 0,
      successCount: flow.success_count || 0,
      errorCount: flow.error_count || 0,
      successRate: flow.execution_count > 0 
        ? Math.round((flow.success_count / flow.execution_count) * 100 * 10) / 10
        : 0,
      lastExecutedAt: flow.last_executed_at
    }
  }
}
