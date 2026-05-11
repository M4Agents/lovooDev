// =====================================================
// GET /api/dashboard/dashboard-users
//
// Retorna a lista de usuários que o chamador pode usar
// como filtro no UserSelector da dashboard.
//
// Query params:
//   company_id (obrigatório)
//
// RBAC:
//   seller / partner → retorna apenas si mesmo (array com 1 item)
//   manager          → retorna sellers + managers ativos da empresa
//   admin / system_admin / super_admin → idem manager
//
// Limite defensivo: 50 usuários máximo.
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'

const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])
const MAX_USERS = 50

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

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
    // 2. Membership
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    const callerRole = membership.role

    // ------------------------------------------------------------------
    // 3. Retorno baseado em role
    // ------------------------------------------------------------------

    // Seller / partner → apenas si mesmo
    if (!MANAGER_ROLES.has(callerRole)) {
      return res.status(200).json({
        ok: true,
        data: [{
          user_id:      user.id,
          display_name: (user.user_metadata?.name as string | undefined)
                        ?? (user.user_metadata?.full_name as string | undefined)
                        ?? user.email
                        ?? 'Você',
          role: callerRole,
        }],
      })
    }

    // Manager / admin+ → lista via RPC
    const users = await withTiming(
      'dashboard.dashboard_users',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_selectable_users', {
          p_company_id: companyId,
        })
        if (error) throw new Error(`get_dashboard_selectable_users: ${error.message}`)
        return (data ?? []) as Array<{ user_id: string; display_name: string; role: string }>
      },
      { companyId },
    )

    return res.status(200).json({
      ok:   true,
      data: users.slice(0, MAX_USERS),
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.dashboard_users', err, {
      endpoint:  '/api/dashboard/dashboard-users',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
