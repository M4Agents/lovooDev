// =====================================================
// GET /api/dashboard/priority-alerts
//
// Alertas prioritários em tempo real (sem filtro de período).
// Tipos: sla_critical, sla_high, stalled_opportunity, seller_risk.
//
// Query params:
//   company_id   (obrigatório)
//   user_id      (opcional)
//
// RBAC:
//   seller   → SEMPRE usa o próprio user.id (seller_risk nunca exibido)
//   partner  → igual a seller
//   manager+ → filtra por user_id se enviado e validado, ou retorna todos
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'

const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

const EMPTY_RESPONSE = { alerts: [], total: 0, critical: 0, high: 0 }

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

    // 4. RPC get_dashboard_priority_alerts
    const ctx = { companyId }

    const rpcResult = await withTiming(
      'dashboard.priority-alerts',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_priority_alerts', {
          p_company_id: companyId,
          p_user_id:    effectiveUserId ?? null,
        })
        if (error) throw new Error(`get_dashboard_priority_alerts: ${error.message}`)
        return data as { alerts: unknown[]; total: number; critical: number; high: number } | null
      },
      ctx,
    )

    // Alertas em tempo real — dispensas individuais invalidam o cache imediatamente.
    // CDN-cache aqui causaria reexibição de alertas já dispensados após page refresh.
    res.setHeader('Cache-Control', 'no-store')

    return res.status(200).json({
      ok:   true,
      data: rpcResult ?? EMPTY_RESPONSE,
      meta: { user_id: effectiveUserId },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.priority-alerts', err, {
      endpoint:  '/api/dashboard/priority-alerts',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
