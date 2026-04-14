// =====================================================
// API: GET FLOW EXECUTIONS
// Retorna execuções detalhadas de um flow com estado derivado e logs resumidos.
// =====================================================

import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      ?? process.env.SUPABASE_URL      ?? process.env.NEXT_PUBLIC_SUPABASE_URL      ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const MAX_EXECUTIONS = 20   // cap da lista de execuções por request
const LOGS_PER_EXEC  = 15   // logs retornados por execução

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface ExecutedNodeEntry {
  node_id: string
  status: string
  executed_at: string
  output: Record<string, any> | null
  error_message: string | null
}

interface RawExecution {
  id: string
  flow_id: string
  company_id: string
  status: string
  lead_id: number | null
  opportunity_id: string | null
  current_node_id: string | null
  started_at: string
  completed_at: string | null
  paused_at: string | null
  resume_at: string | null
  timeout_at: string | null
  error_message: string | null
  error_node_id: string | null
  duration_ms: number | null
  variables: Record<string, any> | null
  executed_nodes: ExecutedNodeEntry[] | null
}

type NodeDebugStatus = {
  status: 'success' | 'error' | 'paused' | 'skipped'
  executed_at: string
  error_message: string | null
  output: Record<string, any> | null
}

function computeNodeStatusMap(executedNodes: ExecutedNodeEntry[] | null): Record<string, NodeDebugStatus> {
  const map: Record<string, NodeDebugStatus> = {}
  if (!executedNodes) return map

  const VALID_STATUSES = new Set(['success', 'error', 'paused', 'skipped'])

  for (const entry of executedNodes) {
    if (!entry?.node_id) continue
    const existing = map[entry.node_id]
    if (!existing || entry.executed_at > existing.executed_at) {
      let status: NodeDebugStatus['status'] = VALID_STATUSES.has(entry.status)
        ? (entry.status as NodeDebugStatus['status'])
        : 'success'

      // O motor registra nodes pulados como success com output.skipped = true.
      // Corrigir para skipped sem sobrescrever error ou paused.
      if (entry.output?.skipped === true && status !== 'error' && status !== 'paused') {
        status = 'skipped'
      }

      map[entry.node_id] = {
        status,
        executed_at: entry.executed_at,
        error_message: entry.error_message ?? null,
        output: entry.output ?? null,
      }
    }
  }

  return map
}

interface RawLog {
  id: string
  execution_id: string
  node_id: string
  node_type: string
  action: string
  status: string
  output_data: Record<string, any> | null
  error_message: string | null
  executed_at: string
  duration_ms: number | null
}

// ---------------------------------------------------------------------------
// Estado derivado
// ---------------------------------------------------------------------------

function deriveState(exec: RawExecution, now: Date) {
  const isPaused     = exec.status === 'paused'
  const isRunning    = exec.status === 'running'
  const isCompleted  = exec.status === 'completed'
  const isFailed     = exec.status === 'failed'
  const awaitingInput = exec.variables?._awaiting_input ?? null

  const isTimedOut = isPaused
    && exec.timeout_at !== null
    && new Date(exec.timeout_at) < now

  const isDelayed = isPaused
    && exec.resume_at !== null
    && awaitingInput === null

  const isWaitingInput = isPaused && awaitingInput !== null

  // Separar variáveis do usuário das variáveis internas (_awaiting_input)
  let userVariables: Record<string, any> | null = null
  if (exec.variables) {
    const { _awaiting_input: _, ...rest } = exec.variables
    userVariables = Object.keys(rest).length > 0 ? rest : null
  }

  return {
    isPaused,
    isRunning,
    isCompleted,
    isFailed,
    isTimedOut,
    isDelayed,
    isWaitingInput,
    _awaiting_input: awaitingInput,
    variables: userVariables,
  }
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    console.warn('[executions/flowId] sem Authorization header')
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = authHeader.replace('Bearer ', '').trim()

  try {
    const { flowId } = req.query
    console.log('[executions/flowId] recebido — flowId:', flowId)
    const pageRaw    = parseInt((req.query.page     as string) || '1')
    const pageSizeRaw = parseInt((req.query.pageSize as string) || String(MAX_EXECUTIONS))

    if (!flowId || typeof flowId !== 'string') {
      return res.status(400).json({ error: 'flowId inválido' })
    }

    const pageSize = Math.min(Math.max(pageSizeRaw, 1), MAX_EXECUTIONS)
    const page     = Math.max(pageRaw, 1)
    const offsetInt = (page - 1) * pageSize

    // 1. Validar JWT
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token)
    if (authError || !user) {
      console.warn('[executions/flowId] JWT inválido:', authError?.message)
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.log('[executions/flowId] usuário autenticado:', user.id)

    const supabase = getSupabaseAdmin()

    // 2. Resolver company_id via membership (multi-tenant obrigatório)
    const { data: membership, error: membershipError } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (membershipError || !membership?.company_id) {
      console.warn('[executions/flowId] membership não encontrada — userId:', user.id, 'err:', membershipError?.message)
      return res.status(403).json({ error: 'Acesso negado' })
    }
    console.log('[executions/flowId] company_id:', membership.company_id)

    const companyId = membership.company_id

    // 3. Confirmar que o flow pertence à empresa (evita enumeration cross-tenant)
    const { data: flow, error: flowErr } = await supabase
      .from('automation_flows')
      .select('id, name')
      .eq('id', flowId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (flowErr || !flow) {
      return res.status(404).json({ error: 'Flow não encontrado' })
    }

    // 4. Buscar execuções do flow com todos os campos relevantes
    const { data: executions, error: execErr } = await supabase
      .from('automation_executions')
      .select([
        'id',
        'flow_id',
        'company_id',
        'status',
        'lead_id',
        'opportunity_id',
        'current_node_id',
        'started_at',
        'completed_at',
        'paused_at',
        'resume_at',
        'timeout_at',
        'error_message',
        'error_node_id',
        'duration_ms',
        'variables',
        'executed_nodes',
      ].join(', '))
      .eq('flow_id', flowId)
      .eq('company_id', companyId)
      .order('started_at', { ascending: false })
      .range(offsetInt, offsetInt + pageSize - 1)

    if (execErr) throw execErr

    console.log('[executions/flowId] execuções encontradas:', executions?.length ?? 0, '| flowId:', flowId)

    if (!executions || executions.length === 0) {
      return res.status(200).json({
        success:  true,
        flow_id:  flowId,
        flow_name: flow.name,
        items:    [],
        page,
        pageSize,
        hasMore:  false,
      })
    }

    // 5. Buscar logs de todas as execuções em uma única query
    const executionIds = executions.map((e: RawExecution) => e.id)

    const { data: allLogs, error: logsErr } = await supabase
      .from('automation_logs')
      .select('id, execution_id, node_id, node_type, action, status, output_data, error_message, executed_at, duration_ms')
      .in('execution_id', executionIds)
      .eq('company_id', companyId)
      .order('executed_at', { ascending: false })
      .limit(executionIds.length * LOGS_PER_EXEC)

    if (logsErr) {
      // Logs não-críticos: continua sem eles
      console.warn('[executions/flowId] erro ao buscar logs:', logsErr.message)
    }

    // 6. Agrupar logs por execution_id (até LOGS_PER_EXEC por execução)
    const logsByExecution: Record<string, RawLog[]> = {}
    for (const log of (allLogs || []) as RawLog[]) {
      if (!logsByExecution[log.execution_id]) {
        logsByExecution[log.execution_id] = []
      }
      if (logsByExecution[log.execution_id].length < LOGS_PER_EXEC) {
        logsByExecution[log.execution_id].push(log)
      }
    }

    // 7. Montar resposta enriquecida
    const now = new Date()

    const enrichedExecutions = (executions as RawExecution[]).map(exec => {
      const derived = deriveState(exec, now)
      const logs = logsByExecution[exec.id] || []
      const lastLog = logs[0] ?? null

      return {
        // Campos do banco
        id:              exec.id,
        flow_id:         exec.flow_id,
        company_id:      exec.company_id,
        status:          exec.status,
        lead_id:         exec.lead_id,
        opportunity_id:  exec.opportunity_id,
        current_node_id: exec.current_node_id,
        started_at:      exec.started_at,
        completed_at:    exec.completed_at,
        paused_at:       exec.paused_at,
        resume_at:       exec.resume_at,
        timeout_at:      exec.timeout_at,
        error_message:   exec.error_message,
        error_node_id:   exec.error_node_id,
        duration_ms:     exec.duration_ms,

        // Variáveis (sem _awaiting_input)
        variables:       derived.variables,
        _awaiting_input: derived._awaiting_input,

        // Estado derivado
        isPaused:        derived.isPaused,
        isRunning:       derived.isRunning,
        isCompleted:     derived.isCompleted,
        isFailed:        derived.isFailed,
        isTimedOut:      derived.isTimedOut,
        isDelayed:       derived.isDelayed,
        isWaitingInput:  derived.isWaitingInput,

        // Último evento resumido
        last_event:         lastLog,
        last_node_executed: lastLog?.node_id ?? exec.current_node_id ?? null,

        // Preview de logs (parcial — use endpoint dedicado por execution_id para histórico completo)
        logsPreview:      logs,
        logsPreviewCount: logs.length,
        hasMoreLogs:      logs.length === LOGS_PER_EXEC,

        // Mapa de status por node para debug visual no canvas
        nodeStatusMap: computeNodeStatusMap(exec.executed_nodes),
      }
    })

    return res.status(200).json({
      success:   true,
      flow_id:   flowId,
      flow_name: flow.name,
      items:     enrichedExecutions,
      page,
      pageSize,
      hasMore:   executions.length === pageSize,
    })

  } catch (err: any) {
    console.error('[executions/flowId] erro:', err?.message)
    return res.status(500).json({ error: 'Erro ao buscar execuções' })
  }
}
