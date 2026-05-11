// =====================================================
// GET /api/dashboard/seller-performance
//
// Ranking Comercial com score composto.
// Score: Conversão 35% | Velocidade 25% | Atendimento 20% | Geração 10% | SLA 10%
//
// Query params:
//   company_id  (obrigatório)
//   period      (default: '30d')
//   start_date  (obrigatório quando period = 'custom')
//   end_date    (obrigatório quando period = 'custom')
//   user_id     (opcional)
//
// RBAC (ajuste obrigatório):
//   seller      → SEMPRE força p_user_id = auth.uid() + is_individual_view = true
//   partner     → igual a seller (dados próprios apenas)
//   manager/admin/system_admin/super_admin
//               → se user_id enviado, valida membership antes de filtrar
//                 + is_individual_view = true
//               → se user_id omitido, retorna ranking de toda a equipe
//                 + is_individual_view = false
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }       from '../lib/dashboard/period.js'
import {
  extractToken,
  assertMembership,
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

    // 3. RBAC — determina effective_user_id e is_individual_view
    const callerRole  = membership.role
    const rawUserId   = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : null

    let effectiveUserId:   string | null = null
    let isIndividualView:  boolean       = false

    if (!MANAGER_ROLES.has(callerRole)) {
      // seller/partner: SEMPRE vê apenas si mesmo, sem rank relativo
      effectiveUserId  = user.id
      isIndividualView = true
    } else if (rawUserId) {
      // manager/admin+ filtrando um vendedor específico: valida membership
      const targetMembership = await assertMembership(svc, rawUserId, companyId)
      if (!targetMembership) {
        jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa'); return
      }
      effectiveUserId  = rawUserId
      isIndividualView = true
    }
    // manager/admin+ sem user_id → ranking completo da equipe

    // 4. Período
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try { resolvedRange = resolvePeriod(period, start_date, end_date) }
    catch (e: any) { jsonError(res, 400, e.message ?? 'Período inválido'); return }

    // 5. RPC get_dashboard_seller_ranking
    const ctx = { companyId, period }

    const rawData = await withTiming(
      'dashboard.seller-performance',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_seller_ranking', {
          p_company_id:      companyId,
          p_start_date:      resolvedRange.start,
          p_end_date:        resolvedRange.end,
          p_user_id:         effectiveUserId ?? null,
          p_include_ranking: !isIndividualView,
        })
        if (error) throw new Error(`get_dashboard_seller_ranking: ${error.message}`)
        return (data ?? []) as any[]
      },
      ctx,
    )

    return res.status(200).json({
      ok:   true,
      data: rawData,
      meta: {
        period,
        start:              resolvedRange.start,
        end:                resolvedRange.end,
        user_id:            effectiveUserId,
        total:              rawData.length,
        is_individual_view: isIndividualView,
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.seller-performance', err, {
      endpoint:  '/api/dashboard/seller-performance',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
      period:    typeof req.query.period     === 'string' ? req.query.period     : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
