// =====================================================
// GET /api/dashboard/forecast
//
// Métricas de pipeline e forecast comercial.
// Combina estado atual (pipeline aberto) com fechamentos do período.
//
// Query params:
//   company_id   (obrigatório)
//   period       (default: 30d)
//   start_date   (opcional)
//   end_date     (opcional)
//   funnel_id    (opcional)
//   user_id      (opcional)
//
// RBAC:
//   seller   → SEMPRE usa o próprio user.id
//   partner  → igual a seller
//   manager+ → filtra por user_id se enviado e validado, ou retorna todos
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }       from '../lib/dashboard/period.js'
import {
  extractToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'

const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // 1. Autenticação
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // 2. Membership
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // 3. RBAC
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

    // 4. Período
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

    // 5. Validação de funnel_id (opcional)
    const funnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : null

    if (funnelId) {
      const valid = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
    }

    // 6. RPC get_dashboard_forecast
    const ctx = { companyId, period }

    const rpcResult = await withTiming(
      'dashboard.forecast',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_forecast', {
          p_company_id:   companyId,
          p_start_date:   resolvedRange.start.split('T')[0],
          p_end_date:     resolvedRange.end.split('T')[0],
          p_funnel_id:    funnelId ?? null,
          p_user_id:      effectiveUserId ?? null,
          p_stalled_days: 14,
        })
        if (error) throw new Error(`get_dashboard_forecast: ${error.message}`)
        return data
      },
      ctx,
    )

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')

    return res.status(200).json({
      ok:   true,
      data: rpcResult ?? {
        pipeline_total: 0, pipeline_weighted: 0, pipeline_risk: 0,
        pipeline_safe: 0, open_count: 0, stalled_count: 0,
        stalled_value: 0, stalled_weighted_value: 0,
        won_value: 0, won_count: 0, lost_value: 0, lost_count: 0,
        conversion_rate: 0,
      },
      meta: {
        period,
        start:     resolvedRange.start,
        end:       resolvedRange.end,
        funnel_id: funnelId,
        user_id:   effectiveUserId,
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.forecast', err, {
      endpoint:  '/api/dashboard/forecast',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
