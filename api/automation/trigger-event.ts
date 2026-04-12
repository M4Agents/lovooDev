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

// #region agent log
console.log('[trigger-event][7a137a] módulo inicializado — triggerEvaluator estático OK')
// #endregion

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

  // #region agent log
  // H-A: verificar se supabaseAdmin.js carrega corretamente em runtime
  let getSupabaseAdminFn: any
  try {
    const mod = await import('../lib/automation/supabaseAdmin.js')
    getSupabaseAdminFn = mod.getSupabaseAdmin
    console.log('[trigger-event][7a137a] supabaseAdmin.js carregou OK', { has_fn: typeof getSupabaseAdminFn })
  } catch (err: any) {
    console.log('[trigger-event][7a137a] supabaseAdmin.js FALHOU', { error: err?.message, code: err?.code })
    return res.status(200).json({ probe: 'FASE-1-diag', supabase_admin_error: err?.message ?? String(err), code: err?.code })
  }
  const supabaseAdmin = getSupabaseAdminFn()
  // #endregion

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

  // 5. Buscar fluxos ativos da empresa
  const { data: flows, error: flowsErr } = await supabaseAdmin
    .from('automation_flows')
    .select('id, name, nodes, trigger_operator')
    .eq('company_id', company_id)
    .eq('is_active', true)

  if (flowsErr) {
    return res.status(500).json({ error: 'Erro ao buscar fluxos', detail: flowsErr.message })
  }

  // 6. Filtrar fluxos que correspondem ao evento
  const event = { type: event_type as AllowedEventType, data }
  const matched = (flows ?? []).filter((flow: any) => matchesTriggerConditions(flow, event))

  return res.status(200).json({ success: true, matched: matched.length })
}
