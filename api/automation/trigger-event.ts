// =====================================================
// API: TRIGGER EVENT
// Recebe eventos de trigger do frontend (autenticado por JWT)
// e executa os fluxos de automação compatíveis no backend.
//
// Sem dependência do TriggerManager — usa triggerEvaluator
// diretamente para filtrar fluxos e automationEngine para executar.
// =====================================================

import { createClient } from '@supabase/supabase-js'
// AutomationEngine e triggerEvaluator convertidos para dynamic import
// para capturar erros de module-load em runtime (debug session 7a137a)
import type { TriggerEvent } from '../../src/services/automation/triggerEvaluator'

// #region agent log
// Prova que o módulo carregou sem crash nos imports estáticos (H1/H2 baseline)
console.log('[trigger-event][7a137a] módulo carregado OK — imports estáticos resolvidos');
fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'trigger-event.ts:module',message:'módulo carregado',data:{env_url_present:!!process.env.SUPABASE_URL,env_key_present:!!process.env.SUPABASE_SERVICE_ROLE_KEY},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
// #endregion

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_EVENT_TYPES = ['opportunity.stage_changed'] as const
type AllowedEventType = (typeof ALLOWED_EVENT_TYPES)[number]

function isUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

export default async function handler(req: any, res: any) {
  // #region agent log
  // H3/H4: handler foi invocado (módulo e imports estáticos carregaram com sucesso)
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'trigger-event.ts:handler-entry',message:'handler invocado',data:{method:req.method},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  // #endregion

  // #region agent log
  // H1/H2: testar import dinâmico de AutomationEngine (cadeia pesada de dependências)
  let automationEngine: any
  let matchesTriggerConditions: any
  try {
    const engineMod = await import('../../src/services/automation/AutomationEngine')
    automationEngine = engineMod.automationEngine
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'trigger-event.ts:import-engine',message:'AutomationEngine importado OK',data:{has_engine:!!automationEngine},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  } catch(importErr: any) {
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'trigger-event.ts:import-engine-FAIL',message:'AutomationEngine import FALHOU',data:{error:String(importErr),stack:importErr?.stack?.split('\n').slice(0,5)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    console.error('[trigger-event][7a137a] AutomationEngine import falhou:', importErr)
    return res.status(500).json({ debug_hypothesis:'H1', debug_error: String(importErr), debug_stack: (importErr as any)?.stack?.split('\n').slice(0,8) })
  }
  try {
    const evalMod = await import('../../src/services/automation/triggerEvaluator')
    matchesTriggerConditions = evalMod.matchesTriggerConditions
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'trigger-event.ts:import-evaluator',message:'triggerEvaluator importado OK',data:{has_fn:!!matchesTriggerConditions},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  } catch(importErr: any) {
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',location:'trigger-event.ts:import-evaluator-FAIL',message:'triggerEvaluator import FALHOU',data:{error:String(importErr)},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    console.error('[trigger-event][7a137a] triggerEvaluator import falhou:', importErr)
    return res.status(500).json({ debug_hypothesis:'H2', debug_error: String(importErr), debug_stack: (importErr as any)?.stack?.split('\n').slice(0,8) })
  }
  // #endregion

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Extrair JWT do header Authorization
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const serviceSupabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  )

  // Validar JWT
  const { data: { user }, error: authError } = await serviceSupabase.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Validar body
  const { event_type, company_id, opportunity_id, from_stage_id, to_stage_id, funnel_id, lead_id, conversation_id } = req.body

  if (!ALLOWED_EVENT_TYPES.includes(event_type as AllowedEventType)) {
    return res.status(400).json({ error: 'event_type inválido' })
  }

  if (!isUUID(company_id)) {
    return res.status(400).json({ error: 'company_id inválido' })
  }

  if (!isUUID(opportunity_id)) {
    return res.status(400).json({ error: 'opportunity_id inválido' })
  }

  try {
    // Validar pertencimento da oportunidade ao company_id informado (IDOR)
    const { data: opportunity, error: oppError } = await serviceSupabase
      .from('opportunities')
      .select('id, funnel_id, lead_id')
      .eq('id', opportunity_id)
      .eq('company_id', company_id)
      .single()

    if (oppError || !opportunity) {
      return res.status(403).json({ error: 'Oportunidade não encontrada para esta empresa' })
    }

    // Buscar flows ativos da empresa
    const { data: flows, error: flowsError } = await serviceSupabase
      .from('automation_flows')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)

    if (flowsError) {
      console.error('[trigger-event] Erro ao buscar flows:', flowsError)
      return res.status(500).json({ error: 'Erro interno' })
    }

    if (!flows || flows.length === 0) {
      return res.status(200).json({ success: true, matched: 0 })
    }

    // Montar o evento com os dados enriquecidos
    const event: TriggerEvent = {
      type: event_type as AllowedEventType,
      companyId: company_id,
      data: {
        opportunity_id,
        old_stage: from_stage_id ?? null,
        new_stage: to_stage_id ?? null,
        opportunity: {
          opportunity_id,
          funnel_id: funnel_id ?? opportunity.funnel_id,
          lead_id: lead_id ?? opportunity.lead_id,
          conversation_id: conversation_id ?? null
        },
        timestamp: new Date().toISOString()
      }
    }

    // Filtrar flows compatíveis com o trigger
    const matchingFlows = flows.filter((flow: any) => matchesTriggerConditions(flow, event))

    console.log(`[trigger-event] ${event_type}: ${matchingFlows.length}/${flows.length} fluxos compatíveis para empresa ${company_id}`)

    // Responder imediatamente — não bloquear o frontend
    res.status(200).json({ success: true, matched: matchingFlows.length })

    // Executar os flows correspondentes após a resposta (fire-and-forget no servidor)
    for (const flow of matchingFlows) {
      automationEngine.executeFlow(flow.id, event.data, company_id).catch((err: any) => {
        console.error(`[trigger-event] Erro ao executar fluxo ${flow.id}:`, err)
      })
    }
  } catch (error) {
    console.error('[trigger-event] Erro inesperado:', error)
    return res.status(500).json({ error: 'Erro interno' })
  }
}
