// =====================================================
// GET /api/dashboard/trends
//
// Série temporal de leads e atendimentos por dia.
// Dados: novos leads por dia + primeira resposta humana por dia.
//
// Query params:
//   company_id  (obrigatório)
//   period      (default: '30d')
//   start_date  (obrigatório quando period = 'custom')
//   end_date    (obrigatório quando period = 'custom')
//   user_id     (opcional — ver regras de RBAC abaixo)
//
// RBAC:
//   seller      → ignora user_id enviado, SEMPRE usa o próprio user.id
//   manager/admin/system_admin/super_admin
//               → se user_id enviado, valida que é membro ativo antes de filtrar
//               → se user_id omitido, retorna dados de todos os vendedores
//   partner     → tratado como seller (vê apenas si mesmo)
//
// Nunca confiar em user_id vindo do frontend sem validação.
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }       from '../lib/dashboard/period.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'

// Roles que podem ver dados de outros usuários
const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

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

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }
    const svc = getSupabaseAdmin()

    // ------------------------------------------------------------------
    // 2. Membership
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. RBAC — determina effective_user_id
    // ------------------------------------------------------------------
    const callerRole  = membership.role
    const rawUserId   = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : null
    let effectiveUserId: string | null = null

    if (!MANAGER_ROLES.has(callerRole)) {
      // seller, partner ou role desconhecido: SEMPRE vê apenas si mesmo
      effectiveUserId = user.id
    } else if (rawUserId) {
      // manager/admin+: valida que o alvo é membro ativo da empresa
      const targetMembership = await assertMembership(svc, rawUserId, companyId)
      if (!targetMembership) {
        jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa'); return
      }
      effectiveUserId = rawUserId
    }
    // manager/admin+ sem user_id → effectiveUserId = null → dados de todos

    // ------------------------------------------------------------------
    // 4. Período
    // ------------------------------------------------------------------
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try { resolvedRange = resolvePeriod(period, start_date, end_date) }
    catch (e: any) { jsonError(res, 400, e.message ?? 'Período inválido'); return }

    // ------------------------------------------------------------------
    // 5. Timezone da empresa
    // Busca após validação de auth + membership (passos 1-3).
    // service_role só é usado com companyId já autorizado.
    // ------------------------------------------------------------------
    const { data: co } = await svc
      .from('companies')
      .select('timezone')
      .eq('id', companyId)
      .maybeSingle()

    const timezone = co?.timezone || 'America/Sao_Paulo'

    // ------------------------------------------------------------------
    // 6. RPC get_dashboard_trends
    // ------------------------------------------------------------------
    const ctx = { companyId, period }

    const result = await withTiming(
      'dashboard.trends',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_trends', {
          p_company_id: companyId,
          p_start_date: resolvedRange.start,
          p_end_date:   resolvedRange.end,
          p_user_id:    effectiveUserId ?? null,
          p_timezone:   timezone,
        })
        if (error) throw new Error(`get_dashboard_trends: ${error.message}`)
        return data as {
          leads_by_day:      Array<{ date: string; count: number }>
          attendance_by_day: Array<{ date: string; attended: number; avg_response_minutes: number | null; sum_response_minutes: number | null; unanswered: number; inbound_total: number }>
          total_unanswered:  number
        }
      },
      ctx,
    )

    return res.status(200).json({
      ok: true,
      data: {
        leads_by_day:      result.leads_by_day      ?? [],
        attendance_by_day: result.attendance_by_day ?? [],
        total_unanswered:  result.total_unanswered  ?? 0,
      },
      meta: {
        period,
        start:   resolvedRange.start,
        end:     resolvedRange.end,
        user_id: effectiveUserId,
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.trends', err, {
      endpoint: '/api/dashboard/trends',
      period:   typeof req.query.period === 'string' ? req.query.period : undefined,
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
