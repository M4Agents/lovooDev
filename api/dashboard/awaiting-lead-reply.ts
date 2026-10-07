// =====================================================
// GET /api/dashboard/awaiting-lead-reply
//
// Leads que receberam mensagem humana do vendedor e não responderam.
// Prazo: dashboard_alert_settings.awaiting_lead_reply_settings.
// Janela: últimos 7 dias. Paginação igual à Fila de Atendimento.
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'
import { AWAITING_LEAD_REPLY_DEFAULTS } from '../lib/dashboard/alertSettingsDefaults.js'

const MANAGER_ROLES  = new Set(['manager', 'admin', 'system_admin', 'super_admin'])
const MAX_PAGE_LIMIT = 50
const MAX_AGE_HOURS  = 168

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }
    const svc = getSupabaseAdmin()

    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

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

    const page   = Math.max(1, Number(req.query.page) || 1)
    const limit  = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(req.query.limit) || 20))
    const offset = (page - 1) * limit

    const { data: settingsRow } = await svc
      .from('dashboard_alert_settings')
      .select('awaiting_lead_reply_settings')
      .eq('company_id', companyId)
      .maybeSingle()

    const settings = (settingsRow?.awaiting_lead_reply_settings as {
      enabled?: boolean
      min_minutes?: number
      critical_minutes?: number
    } | null) ?? {}

    const enabled         = settings.enabled ?? AWAITING_LEAD_REPLY_DEFAULTS.enabled
    const minMinutes      = settings.min_minutes ?? AWAITING_LEAD_REPLY_DEFAULTS.min_minutes
    const criticalMinutes = settings.critical_minutes ?? AWAITING_LEAD_REPLY_DEFAULTS.critical_minutes
    const minHours        = minMinutes / 60
    const criticalHours   = criticalMinutes / 60

    if (!enabled) {
      return res.status(200).json({
        ok:   true,
        data: [],
        meta: { total: 0, page, limit, has_more: false, min_hours: minHours },
      })
    }

    const rpcResult = await withTiming(
      'dashboard.awaiting-lead-reply',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_awaiting_lead_reply', {
          p_company_id:    companyId,
          p_user_id:       effectiveUserId ?? null,
          p_min_hours:     minHours,
          p_max_age_hours: MAX_AGE_HOURS,
          p_limit:         limit,
          p_offset:        offset,
        })
        if (error) throw new Error(`get_dashboard_awaiting_lead_reply: ${error.message}`)
        return data as { items: any[]; total: number } | null
      },
      { companyId, minHours, page, limit },
    )

    const remapSeverity = (hw: number): 'critical' | 'high' | 'medium' | 'low' => {
      if (hw >= criticalHours)     return 'critical'
      if (hw >= criticalHours / 2) return 'high'
      if (hw >= 12)                return 'medium'
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
        has_more: offset + items.length < total,
        min_hours: minHours,
      },
    })
  } catch (err: unknown) {
    logDashboardError('dashboard.awaiting-lead-reply', err, {
      endpoint:  '/api/dashboard/awaiting-lead-reply',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
