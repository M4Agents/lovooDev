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
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

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

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // ------------------------------------------------------------------
    // 2. Validação de company_id + membership
    // company_id vem da query mas é validado contra o usuário autenticado.
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. Resolução do período
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
    // 4. Métricas em paralelo (cada uma falha de forma independente)
    // ------------------------------------------------------------------
    const [agentMode, funnelMode, execMetrics] = await Promise.all([
      detectAgentMode(svc, companyId),
      detectFunnelMode(svc, companyId),
      buildExecutiveMetrics(svc, companyId, resolvedRange),
    ])

    // ------------------------------------------------------------------
    // 5. Resposta
    // ------------------------------------------------------------------
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')

    return res.status(200).json({
      data: {
        ...execMetrics,
        agent_mode: agentMode,
        funnel_mode: funnelMode,
      },
      meta: {
        period,
        start_date: resolvedRange.start,
        end_date:   resolvedRange.end,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/summary] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
