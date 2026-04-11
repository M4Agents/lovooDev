// =====================================================
// API: PROCESS SCHEDULES
// Data: 13/03/2026
// Objetivo: Processar agendamentos pendentes (chamado por cron job)
// =====================================================

import { createClient } from '@supabase/supabase-js'
import { scheduleService } from '../../src/services/automation/ScheduleService'
import { automationEngine } from '../../src/services/automation/AutomationEngine'

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('🔄 Processando schedules pendentes...')

    // Buscar schedules prontos para executar
    const schedules = await scheduleService.getPendingSchedules()

    if (schedules.length === 0) {
      return res.status(200).json({
        success: true,
        processed: 0,
        message: 'Nenhum schedule pendente'
      })
    }

    console.log(`📋 Encontrados ${schedules.length} schedules para processar`)

    const results = {
      processed: 0,
      failed: 0,
      errors: [] as string[]
    }

    // Processar cada schedule
    for (const schedule of schedules) {
      try {
        console.log('⏱️ Processando schedule:', schedule.id)

        // Buscar execução
        const { data: execution } = await supabase
          .from('automation_executions')
          .select('*')
          .eq('id', schedule.execution_id)
          .single()

        if (!execution) {
          throw new Error('Execução não encontrada')
        }

        // Buscar fluxo
        const { data: flow } = await supabase
          .from('automation_flows')
          .select('*')
          .eq('id', schedule.flow_id)
          .single()

        if (!flow) {
          throw new Error('Fluxo não encontrado')
        }

        // Retomar execução a partir do próximo nó após o delay
        await resumeExecution(execution, flow, schedule.current_node_id)

        // Marcar schedule como processado
        await scheduleService.markAsProcessed(schedule.id)

        results.processed++
        console.log('✅ Schedule processado:', schedule.id)
      } catch (error: any) {
        console.error('❌ Erro ao processar schedule:', schedule.id, error)
        await scheduleService.markAsFailed(schedule.id, error.message)
        results.failed++
        results.errors.push(`Schedule ${schedule.id}: ${error.message}`)
      }
    }

    return res.status(200).json({
      success: true,
      ...results,
      total: schedules.length
    })
  } catch (error: any) {
    console.error('❌ Erro ao processar schedules:', error)
    return res.status(500).json({ error: 'Erro ao processar schedules' })
  }
}

/**
 * Retoma execução após delay.
 * Passa currentNodeId diretamente para o engine, sem injetar dados sintéticos.
 */
async function resumeExecution(execution: any, flow: any, delayNodeId: string) {
  const edges = flow.edges || []
  const nextEdges = edges.filter((e: any) => e.source === delayNodeId)

  if (nextEdges.length === 0) {
    await supabase
      .from('automation_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', execution.id)

    console.log('✅ Execução completada (sem próximos nós após delay)')
    return
  }

  console.log('🔄 Retomando execução após delay via engine:', execution.id)
  await automationEngine.resumeExecution(execution.id, '', delayNodeId)
}
