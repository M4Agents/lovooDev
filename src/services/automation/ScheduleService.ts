// =====================================================
// SERVICE: SCHEDULE SERVICE (AUTOMATION)
// Data: 13/03/2026
// Objetivo: Sistema de agendamento para delays em automações
// IMPORTANTE: Não altera sistema existente, apenas adiciona funcionalidade
// =====================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Cliente criado sob demanda para evitar crash em contexto browser (Vite),
// onde process.env.SUPABASE_URL é undefined. Os métodos desta classe são
// chamados apenas em contexto backend (cron/serverless), nunca no browser.
let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

interface CreateScheduleParams {
  executionId: string
  flowId: string
  companyId: string
  currentNodeId: string
  resumeAt: Date
  delayConfig: {
    duration: number
    unit: 'minutes' | 'hours' | 'days'
    businessHoursOnly?: boolean
  }
}

export class ScheduleService {
  /**
   * Cria um agendamento para retomar execução após delay
   */
  async createSchedule(params: CreateScheduleParams): Promise<string> {
    try {
      console.log('⏱️ ScheduleService: Criando agendamento', {
        executionId: params.executionId,
        resumeAt: params.resumeAt
      })

      // Se businessHoursOnly, ajustar para próximo horário comercial
      let finalResumeAt = params.resumeAt

      if (params.delayConfig.businessHoursOnly) {
        finalResumeAt = this.adjustToBusinessHours(params.resumeAt)
      }

      // Criar registro de agendamento
      const schedule = {
        execution_id: params.executionId,
        flow_id: params.flowId,
        company_id: params.companyId,
        current_node_id: params.currentNodeId,
        resume_at: finalResumeAt.toISOString(),
        status: 'pending',
        delay_config: params.delayConfig,
        created_at: new Date().toISOString()
      }

      const { data, error } = await getSupabase()
        .from('automation_schedules')
        .insert(schedule)
        .select()
        .single()

      if (error) throw error

      // Atualizar execução para status 'paused'
      await getSupabase()
        .from('automation_executions')
        .update({
          status: 'paused',
          current_node_id: params.currentNodeId,
          paused_at: new Date().toISOString(),
          resume_at: finalResumeAt.toISOString()
        })
        .eq('id', params.executionId)

      console.log('✅ Agendamento criado:', data.id)

      return data.id
    } catch (error: any) {
      console.error('❌ Erro ao criar agendamento:', error)
      throw error
    }
  }

  /**
   * Busca agendamentos prontos para executar
   */
  async getPendingSchedules(): Promise<any[]> {
    try {
      const now = new Date().toISOString()

      const { data, error } = await getSupabase()
        .from('automation_schedules')
        .select('*')
        .eq('status', 'pending')
        .lte('resume_at', now)
        .order('resume_at', { ascending: true })
        .limit(50)

      if (error) throw error

      return data || []
    } catch (error) {
      console.error('Erro ao buscar agendamentos pendentes:', error)
      return []
    }
  }

  /**
   * Marca agendamento como processado
   */
  async markAsProcessed(scheduleId: string): Promise<void> {
    try {
      await getSupabase()
        .from('automation_schedules')
        .update({
          status: 'processed',
          processed_at: new Date().toISOString()
        })
        .eq('id', scheduleId)
    } catch (error) {
      console.error('Erro ao marcar agendamento como processado:', error)
    }
  }

  /**
   * Marca agendamento como falho
   */
  async markAsFailed(scheduleId: string, errorMessage: string): Promise<void> {
    try {
      await getSupabase()
        .from('automation_schedules')
        .update({
          status: 'failed',
          error_message: errorMessage,
          processed_at: new Date().toISOString()
        })
        .eq('id', scheduleId)
    } catch (error) {
      console.error('Erro ao marcar agendamento como falho:', error)
    }
  }

  /**
   * Cancela um agendamento
   */
  async cancelSchedule(scheduleId: string): Promise<void> {
    try {
      await getSupabase()
        .from('automation_schedules')
        .update({
          status: 'cancelled',
          processed_at: new Date().toISOString()
        })
        .eq('id', scheduleId)

      console.log('✅ Agendamento cancelado:', scheduleId)
    } catch (error) {
      console.error('Erro ao cancelar agendamento:', error)
    }
  }

  /**
   * Ajusta data/hora para próximo horário comercial
   * Horário comercial: Segunda a Sexta, 9h às 18h
   */
  private adjustToBusinessHours(date: Date): Date {
    const result = new Date(date)
    const hour = result.getHours()
    const day = result.getDay() // 0 = Domingo, 6 = Sábado

    // Se é fim de semana, mover para segunda-feira 9h
    if (day === 0) {
      // Domingo -> Segunda
      result.setDate(result.getDate() + 1)
      result.setHours(9, 0, 0, 0)
    } else if (day === 6) {
      // Sábado -> Segunda
      result.setDate(result.getDate() + 2)
      result.setHours(9, 0, 0, 0)
    }
    // Se é antes das 9h, mover para 9h
    else if (hour < 9) {
      result.setHours(9, 0, 0, 0)
    }
    // Se é depois das 18h, mover para próximo dia útil 9h
    else if (hour >= 18) {
      result.setDate(result.getDate() + 1)
      result.setHours(9, 0, 0, 0)

      // Se o próximo dia é sábado, pular para segunda
      if (result.getDay() === 6) {
        result.setDate(result.getDate() + 2)
      }
      // Se o próximo dia é domingo, pular para segunda
      else if (result.getDay() === 0) {
        result.setDate(result.getDate() + 1)
      }
    }

    return result
  }

  /**
   * Calcula data de retomada baseado em duração e unidade
   */
  calculateResumeAt(duration: number, unit: 'minutes' | 'hours' | 'days'): Date {
    const now = new Date()

    switch (unit) {
      case 'minutes':
        now.setMinutes(now.getMinutes() + duration)
        break
      case 'hours':
        now.setHours(now.getHours() + duration)
        break
      case 'days':
        now.setDate(now.getDate() + duration)
        break
    }

    return now
  }

  /**
   * Verifica se uma data está em horário comercial
   */
  isBusinessHours(date: Date): boolean {
    const hour = date.getHours()
    const day = date.getDay()

    // Segunda a Sexta (1-5), 9h às 18h
    return day >= 1 && day <= 5 && hour >= 9 && hour < 18
  }
}

// Exportar instância singleton
export const scheduleService = new ScheduleService()
