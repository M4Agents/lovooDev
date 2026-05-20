// =====================================================
// GET /api/dashboard/activation
//
// Métricas de ativação comercial por dia:
//   • Prospecção outbound-first (conversa iniciada pelo sistema)
//   • Resgate de leads inativos (outbound após silêncio do lead)
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
// Thresholds de ativação:
//   Lidos de company_analytics_settings.
//   Empresa sem linha → defaults: inactivity=15d, rescue_window=7d, prospection_window=7d.
// =====================================================

import { getSupabaseAdmin }                    from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }                       from '../lib/dashboard/period.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
}                                              from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError }       from '../lib/dashboard/observability.js'

// Roles que podem ver dados de outros usuários
const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

// Defaults aplicados quando a empresa não tem linha em company_analytics_settings
const DEFAULT_RESCUE_INACTIVITY_DAYS      = 15
const DEFAULT_RESCUE_RESPONSE_WINDOW      = 7
const DEFAULT_PROSPECTION_RESPONSE_WINDOW = 7

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
    // 2. Membership + company_id
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
    // ------------------------------------------------------------------
    const { data: co } = await svc
      .from('companies')
      .select('timezone')
      .eq('id', companyId)
      .maybeSingle()

    const timezone = co?.timezone || 'America/Sao_Paulo'

    // ------------------------------------------------------------------
    // 6. Configurações de ativação da empresa
    // Usa defaults seguros se a empresa não tiver linha na tabela.
    // ------------------------------------------------------------------
    const { data: analyticsSettings } = await svc
      .from('company_analytics_settings')
      .select('lead_rescue_inactivity_days, rescue_response_window_days, prospection_response_window_days')
      .eq('company_id', companyId)
      .maybeSingle()

    const rescueInactivityDays      = analyticsSettings?.lead_rescue_inactivity_days      ?? DEFAULT_RESCUE_INACTIVITY_DAYS
    const rescueResponseWindowDays  = analyticsSettings?.rescue_response_window_days      ?? DEFAULT_RESCUE_RESPONSE_WINDOW
    const prospectionResponseWindow = analyticsSettings?.prospection_response_window_days ?? DEFAULT_PROSPECTION_RESPONSE_WINDOW

    // ------------------------------------------------------------------
    // 7. RPC get_dashboard_activation
    // ------------------------------------------------------------------
    const ctx = { companyId, period }

    const result = await withTiming(
      'dashboard.activation',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_activation', {
          p_company_id:                       companyId,
          p_start_date:                       resolvedRange.start,
          p_end_date:                         resolvedRange.end,
          p_user_id:                          effectiveUserId ?? null,
          p_timezone:                         timezone,
          p_lead_rescue_inactivity_days:      rescueInactivityDays,
          p_rescue_response_window_days:      rescueResponseWindowDays,
          p_prospection_response_window_days: prospectionResponseWindow,
        })
        if (error) throw new Error(`get_dashboard_activation: ${error.message}`)
        return data as {
          prospection_by_day: Array<{ date: string; initiated: number; responded: number }>
          rescue_by_day:      Array<{ date: string; initiated: number; responded: number }>
          summary: {
            total_prospection_initiated: number
            total_prospection_responded: number
            total_rescue_initiated:      number
            total_rescue_responded:      number
          }
        }
      },
      ctx,
    )

    return res.status(200).json({
      ok: true,
      data: {
        prospection_by_day: result.prospection_by_day ?? [],
        rescue_by_day:      result.rescue_by_day      ?? [],
        summary:            result.summary            ?? {
          total_prospection_initiated: 0,
          total_prospection_responded: 0,
          total_rescue_initiated:      0,
          total_rescue_responded:      0,
        },
      },
      meta: {
        period,
        start:   resolvedRange.start,
        end:     resolvedRange.end,
        user_id: effectiveUserId,
        settings: {
          rescue_inactivity_days:       rescueInactivityDays,
          rescue_response_window_days:  rescueResponseWindowDays,
          prospection_response_window_days: prospectionResponseWindow,
        },
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.activation', err, {
      endpoint:  '/api/dashboard/activation',
      period:    typeof req.query.period     === 'string' ? req.query.period     : undefined,
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
