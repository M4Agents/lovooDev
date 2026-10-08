// GET /api/dashboard/tag-group-metrics
//
// Mesmo período UTC e mesmo recorte de vendedor de /api/dashboard/lead-origins.
// O responsável é leads.responsible_user_id.
// funnel_id enviado pelo cliente é ignorado.
// A RPC lê tag_group_settings no banco. O cliente não envia os grupos.

import { resolvePeriod } from '../lib/dashboard/period.js'
import { jsonError } from '../lib/dashboard/auth.js'
import { logDashboardError, withTiming } from '../lib/dashboard/observability.js'
import { authorizeTagGroups, resolveTagGroupUserId } from '../lib/dashboard/tagGroupAuth.js'

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { jsonError(res, 405, 'Método não permitido'); return }

  try {
    const actor = await authorizeTagGroups(req, res, 'view')
    if (!actor) return

    const effectiveUserId = await resolveTagGroupUserId(
      actor.svc,
      res,
      actor.companyId,
      req.query?.user_id,
    )
    if (effectiveUserId === undefined) return

    const period = typeof req.query?.period === 'string' ? req.query.period.trim() : '30d'
    const startDate = typeof req.query?.start_date === 'string' ? req.query.start_date.trim() : undefined
    const endDate = typeof req.query?.end_date === 'string' ? req.query.end_date.trim() : undefined

    let resolved: { start: string; end: string }
    try { resolved = resolvePeriod(period, startDate, endDate) }
    catch (err: any) { jsonError(res, 400, err.message ?? 'Período inválido'); return }

    const raw = await withTiming(
      'dashboard.tag-group-metrics',
      async () => {
        const { data, error } = await actor.svc.rpc('get_dashboard_tag_group_metrics', {
          p_company_id: actor.companyId,
          p_start_date: resolved.start,
          p_end_date: resolved.end,
          p_user_id: effectiveUserId,
        })
        if (error) throw new Error(`get_dashboard_tag_group_metrics: ${error.message}`)
        return data ?? []
      },
      { companyId: actor.companyId, period },
    )

    const rows = Array.isArray(raw) ? raw : []

    return res.status(200).json({
      ok: true,
      data: rows,
      meta: {
        period,
        start: resolved.start,
        end: resolved.end,
        user_id: effectiveUserId,
        groups_configured: rows.length,
        funnel_applied: false,
        responsible_field: 'leads.responsible_user_id',
        period_timezone: 'UTC',
      },
    })
  } catch (err: unknown) {
    logDashboardError('dashboard.tag-group-metrics', err, {
      endpoint: '/api/dashboard/tag-group-metrics',
      companyId: typeof req.query?.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
