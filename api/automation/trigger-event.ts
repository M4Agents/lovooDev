// =====================================================
// API: POST /api/automation/trigger-event
//
// Recebe eventos do frontend (autenticado por JWT),
// valida contexto da empresa e oportunidade,
// aplica matchesTriggerConditions nos fluxos ativos
// e retorna quantos fluxos foram ativados.
//
// Sem AutomationEngine — escopo mínimo intencional.
// =====================================================

import { createClient } from '@supabase/supabase-js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { matchesTriggerConditions } from '../lib/automation/triggerEvaluator.js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
// @ts-ignore — arquivo JS ESM em api/lib/automation
import { createExecution, processFlowAsync } from '../lib/automation/executor.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_EVENT_TYPES = ['opportunity.stage_changed'] as const
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number]

function isUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_REGEX.test(v)
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // 1. Validar JWT do usuário
  const authorization = req.headers.authorization as string | undefined
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticação necessária' })
  }

  const url = process.env.VITE_SUPABASE_URL ?? ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? ''
  if (!url || !anonKey) {
    return res.status(500).json({ error: 'Supabase não configurado no servidor' })
  }

  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada' })
  }

  // 2. Validar body
  const { event_type, company_id, data } = req.body ?? {}

  if (!ALLOWED_EVENT_TYPES.includes(event_type)) {
    return res.status(400).json({ error: 'event_type não suportado', allowed: [...ALLOWED_EVENT_TYPES] })
  }
  if (!isUUID(company_id)) {
    return res.status(400).json({ error: 'company_id inválido ou ausente' })
  }
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Campo data é obrigatório e deve ser um objeto' })
  }

  const supabaseAdmin = getSupabaseAdmin()

  // 3. Validar membership do usuário na empresa
  const { data: membership } = await supabaseAdmin
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (!membership) {
    return res.status(403).json({ error: 'Sem acesso à empresa informada' })
  }

  // 4. Validar que a oportunidade pertence à empresa (quando presente)
  if (data?.opportunity_id) {
    if (!isUUID(data.opportunity_id)) {
      return res.status(400).json({ error: 'opportunity_id inválido' })
    }
    const { data: opp } = await supabaseAdmin
      .from('opportunities')
      .select('id')
      .eq('id', data.opportunity_id)
      .eq('company_id', company_id)
      .maybeSingle()

    if (!opp) {
      return res.status(403).json({ error: 'Oportunidade não pertence à empresa informada' })
    }
  }

  // 5. Buscar fluxos ativos da empresa (incluindo edges para travessia do grafo)
  const { data: flows, error: flowsErr } = await supabaseAdmin
    .from('automation_flows')
    .select('id, name, nodes, edges, trigger_operator')
    .eq('company_id', company_id)
    .eq('is_active', true)

  if (flowsErr) {
    return res.status(500).json({ error: 'Erro ao buscar fluxos', detail: flowsErr.message })
  }

  // 6. Filtrar fluxos que correspondem ao evento
  const event = { type: event_type as AllowedEventType, data }
  const matchedFlows = (flows ?? []).filter((flow: any) => matchesTriggerConditions(flow, event))

  if (matchedFlows.length === 0) {
    return res.status(200).json({ success: true, matched: 0, executions: [] })
  }

  // 7. Criar execução e processar cada flow ativado
  const executionIds: string[] = []

  for (const flow of matchedFlows) {
    const execution = await createExecution(flow, data, company_id, supabaseAdmin)
    if (!execution) continue

    executionIds.push(execution.id)
    await processFlowAsync(flow, execution, supabaseAdmin)
  }

  return res.status(200).json({ success: true, matched: matchedFlows.length, executions: executionIds })
}
