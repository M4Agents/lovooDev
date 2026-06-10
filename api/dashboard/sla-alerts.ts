// =====================================================
// GET /api/dashboard/sla-alerts
//
// Leads sem resposta humana após sla_hours horas.
// Paginado com total correto via dois passes na RPC.
//
// Query params:
//   company_id   (obrigatório)
//   user_id      (opcional)
//   sla_hours    (opcional — se omitido usa dashboard_alert_settings.sla_settings.min_minutes; fallback 4h)
//   page         (default: 1)
//   limit        (default: 20, máx: 50)
//
// RBAC:
//   seller   → SEMPRE usa o próprio user.id
//   partner  → igual a seller
//   manager+ → filtra por user_id se enviado (validado), ou retorna todos
//
// Severidade dos itens:
//   Remapeada com base em dashboard_alert_settings.sla_settings.critical_minutes:
//   critical:  hours_waiting >= critical_hours
//   high:      hours_waiting >= critical_hours / 2
//   medium:    hours_waiting >= 12
//   low:       abaixo de 12h
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'
import { SLA_DEFAULTS } from '../lib/dashboard/alertSettingsDefaults.js'

const MANAGER_ROLES  = new Set(['manager', 'admin', 'system_admin', 'super_admin'])
const MAX_PAGE_LIMIT = 50
const MAX_AGE_HOURS  = 168  // 7 dias de janela de busca

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // 1. Autenticação
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }
    const svc = getSupabaseAdmin()

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

    // 4. Paginação
    const page   = Math.max(1, Number(req.query.page)  || 1)
    const limit  = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(req.query.limit) || 20))
    const offset = (page - 1) * limit

    // 5. Resolver thresholds SLA a partir do DB (fallback para defaults globais)
    //    Se sla_hours vier explicitamente na query, respeitá-lo como override.
    const rawSlaHoursQuery = typeof req.query.sla_hours === 'string' ? req.query.sla_hours.trim() : ''

    const { data: settingsRow } = await svc
      .from('dashboard_alert_settings')
      .select('sla_settings')
      .eq('company_id', companyId)
      .maybeSingle()

    const slaSettingsDb = (settingsRow?.sla_settings as { min_minutes?: number; critical_minutes?: number } | null) ?? {}
    const minMinutes      = slaSettingsDb.min_minutes      ?? SLA_DEFAULTS.min_minutes
    const criticalMinutes = slaSettingsDb.critical_minutes ?? SLA_DEFAULTS.critical_minutes

    const slaHours      = rawSlaHoursQuery ? Math.max(0, Number(rawSlaHoursQuery) || minMinutes / 60) : minMinutes / 60
    const criticalHours = criticalMinutes / 60

    // 6. RPC get_dashboard_sla_alerts
    const ctx = { companyId, slaHours, page, limit }

    const rpcResult = await withTiming(
      'dashboard.sla-alerts',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_sla_alerts', {
          p_company_id:    companyId,
          p_user_id:       effectiveUserId ?? null,
          p_sla_hours:     slaHours,
          p_max_age_hours: MAX_AGE_HOURS,
          p_limit:         limit,
          p_offset:        offset,
        })
        if (error) throw new Error(`get_dashboard_sla_alerts: ${error.message}`)
        return data as { items: any[]; total: number } | null
      },
      ctx,
    )

    // 7. Remap severity usando critical_minutes da empresa
    const remapSeverity = (hw: number): 'critical' | 'high' | 'medium' | 'low' => {
      if (hw >= criticalHours)      return 'critical'
      if (hw >= criticalHours / 2)  return 'high'
      if (hw >= 12)                 return 'medium'
      return 'low'
    }

    const rawItems = rpcResult?.items ?? []
    const total    = rpcResult?.total ?? 0
    const items    = rawItems.map((item: any) => ({
      ...item,
      severity: remapSeverity(Number(item.hours_waiting ?? 0)),
    }))

    return res.status(200).json({
      ok:   true,
      data: items,
      meta: {
        total,
        page,
        limit,
        has_more:  offset + items.length < total,
        sla_hours: slaHours,
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.sla-alerts', err, {
      endpoint:  '/api/dashboard/sla-alerts',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
