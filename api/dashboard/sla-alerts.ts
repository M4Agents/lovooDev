// =====================================================
// GET /api/dashboard/sla-alerts
//
// Leads sem resposta humana após sla_hours horas.
// Paginado com total correto via dois passes na RPC.
//
// Query params:
//   company_id   (obrigatório)
//   user_id      (opcional)
//   sla_hours    (default: 6)
//   page         (default: 1)
//   limit        (default: 20, máx: 50)
//
// RBAC:
//   seller   → SEMPRE usa o próprio user.id
//   partner  → igual a seller
//   manager+ → filtra por user_id se enviado (validado), ou retorna todos
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'

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

    // 4. Paginação e parâmetros
    const slaHours  = Math.max(0, Number(req.query.sla_hours) || 6)
    const page      = Math.max(1, Number(req.query.page)  || 1)
    const limit     = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(req.query.limit) || 20))
    const offset    = (page - 1) * limit

    // 5. RPC get_dashboard_sla_alerts
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

    const items = rpcResult?.items ?? []
    const total = rpcResult?.total ?? 0

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
