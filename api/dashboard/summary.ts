// =====================================================
// GET /api/dashboard/summary
//
// Retorna KPIs executivos, modo de agente e modo de funil.
// Não retorna lista de funis — usar GET /api/dashboard/funnels para isso.
//
// Query params:
//   company_id  (obrigatório)
//   period      (default: '30d')
//   start_date  (obrigatório quando period = 'custom')
//   end_date    (obrigatório quando period = 'custom')
//
// Segurança:
//   - company_id validado contra membership real do usuário autenticado
//   - Nunca confiar em company_id sem validação de membership
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }       from '../lib/dashboard/period.js'
import {
  detectAgentMode,
  detectFunnelMode,
  buildExecutiveMetrics,
} from '../lib/dashboard/metrics.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'

const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ------------------------------------------------------------------
    // 1. Autenticação
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }
    const svc = getSupabaseAdmin()

    // ------------------------------------------------------------------
    // 2. Validação de company_id + membership
    // company_id vem da query mas é validado contra o usuário autenticado.
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. RBAC — determina effectiveUserId por role
    // ------------------------------------------------------------------
    const callerRole = membership.role
    const rawUserId  = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : null

    let effectiveUserId: string | null = null

    if (!MANAGER_ROLES.has(callerRole)) {
      effectiveUserId = user.id
    } else if (rawUserId) {
      const targetMembership = await assertMembership(svc, rawUserId, companyId)
      if (!targetMembership) {
        jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa'); return
      }
      effectiveUserId = rawUserId
    }

    // ------------------------------------------------------------------
    // 4. Resolução do período
    // ------------------------------------------------------------------
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try {
      resolvedRange = resolvePeriod(period, start_date, end_date)
    } catch (e: any) {
      jsonError(res, 400, e.message ?? 'Período inválido')
      return
    }

    // ------------------------------------------------------------------
    // 5. Métricas em paralelo (cada uma falha de forma independente)
    // ------------------------------------------------------------------
    const ctx = { companyId, period }

    const [agentModeResult, funnelModeResult, execMetricsResult] = await Promise.allSettled([
      withTiming('dashboard.summary.agent_mode',   () => detectAgentMode(svc, companyId),                                       ctx),
      withTiming('dashboard.summary.funnel_mode',  () => detectFunnelMode(svc, companyId),                                      ctx),
      withTiming('dashboard.summary.exec_metrics', () => buildExecutiveMetrics(svc, companyId, resolvedRange, effectiveUserId), ctx),
    ])

    const agentMode   = agentModeResult.status   === 'fulfilled' ? agentModeResult.value   : 'single-agent'
    const funnelMode  = funnelModeResult.status  === 'fulfilled' ? funnelModeResult.value  : 'single-funnel'
    const execMetrics = execMetricsResult.status === 'fulfilled' ? execMetricsResult.value : { leads_count: 0, conversations_count: 0, hot_opportunities_count: 0, alerts_count: 0 }


    // ------------------------------------------------------------------
    // 5. Resposta
    // ------------------------------------------------------------------
    // user-scoped: dados por usuário — nunca cachear no CDN (URL é idêntica entre sellers)
    // company-wide: cache normal de 60s
    if (effectiveUserId !== null) {
      res.setHeader('Cache-Control', 'private, no-store')
    } else {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    }

    return res.status(200).json({
      ok: true,
      data: {
        ...execMetrics,
        agent_mode:  agentMode,
        funnel_mode: funnelMode,
      },
      meta: {
        period,
        start_date:  resolvedRange.start,
        end_date:    resolvedRange.end,
        user_id:     effectiveUserId ?? null,
        user_scoped: effectiveUserId !== null,
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.summary', err, { endpoint: '/api/dashboard/summary' })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
