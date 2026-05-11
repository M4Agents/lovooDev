// =====================================================
// GET /api/dashboard/funnel-executive
//
// Visão executiva do funil: valor total, ponderado,
// avg_days por etapa, oportunidades paradas.
// Complementa funnel-snapshot (não o substitui).
//
// Query params:
//   company_id   (obrigatório)
//   funnel_id    (obrigatório quando empresa tem múltiplos funis)
//
// Segurança:
//   - funnel_id validado contra company_id
//   - 400 explícito se multi-funnel sem funnel_id
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { detectFunnelMode }    from '../lib/dashboard/metrics.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'
import { withTiming, logDashboardError } from '../lib/dashboard/observability.js'

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

    // 3. Detecção de modo + validação de funnel_id (mesmo padrão do funnel-snapshot)
    const funnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : ''

    const funnelMode = await detectFunnelMode(svc, companyId)

    if (funnelMode === 'multi-funnel' && !funnelId) {
      jsonError(res, 400, 'funnel_id é obrigatório quando a empresa possui múltiplos funis')
      return
    }

    let effectiveFunnelId = funnelId

    if (!effectiveFunnelId) {
      // Single-funnel: detecta o funil padrão
      const { data: defaultFunnel } = await svc
        .from('sales_funnels')
        .select('id')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!defaultFunnel) {
        return res.status(200).json({
          ok:   true,
          data: { funnel_id: null, stages: [] },
          meta: { funnel_id: null, funnel_mode: funnelMode },
        })
      }

      effectiveFunnelId = defaultFunnel.id
    } else {
      const valid = await assertFunnelBelongsToCompany(svc, effectiveFunnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
    }

    // 4. RPC get_dashboard_funnel_executive
    const ctx = { companyId, funnelId: effectiveFunnelId }

    const rpcResult = await withTiming(
      'dashboard.funnel_executive',
      async () => {
        const { data, error } = await svc.rpc('get_dashboard_funnel_executive', {
          p_company_id: companyId,
          p_funnel_id:  effectiveFunnelId,
        })
        if (error) throw new Error(`get_dashboard_funnel_executive: ${error.message}`)
        return data as { funnel_id: string; stages: unknown[] } | null
      },
      ctx,
    )

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')

    return res.status(200).json({
      ok:   true,
      data: rpcResult ?? { funnel_id: effectiveFunnelId, stages: [] },
      meta: {
        funnel_id:   effectiveFunnelId,
        funnel_mode: funnelMode,
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.funnel_executive', err, {
      endpoint:  '/api/dashboard/funnel-executive',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
