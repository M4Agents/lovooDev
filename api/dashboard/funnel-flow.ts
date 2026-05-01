// =====================================================
// GET /api/dashboard/funnel-flow
//
// Fluxo no período: por onde as oportunidades passaram + conversão por etapa.
// Usa opportunity_stage_history dentro do intervalo de datas.
// Conversão baseada em COUNT(DISTINCT opportunity_id) — nunca COUNT(*).
//
// Query params:
//   company_id  (obrigatório)
//   funnel_id   (obrigatório — conversão por etapa exige funil específico)
//   period      (default: '30d')
//   start_date  (obrigatório quando period = 'custom')
//   end_date    (obrigatório quando period = 'custom')
//
// Segurança:
//   - company_id validado contra membership
//   - funnel_id obrigatório e validado contra company_id
//   - period resolvido no backend — nunca confiar em datas brutas do frontend
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }       from '../lib/dashboard/period.js'
import {
  buildFunnelFlowMetrics,
  buildFunnelStageConversionMetrics,
} from '../lib/dashboard/metrics.js'
import {
  extractToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { jsonError(res, 405, 'Método não permitido'); return }

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
    // 2. Validação de company_id + membership
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. Validação de funnel_id (obrigatório para conversão por etapa)
    // ------------------------------------------------------------------
    const funnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : ''
    if (!funnelId) {
      jsonError(res, 400, 'funnel_id é obrigatório para calcular conversão por etapa')
      return
    }

    const valid = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
    if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }

    // ------------------------------------------------------------------
    // 4. Resolução do período
    // ------------------------------------------------------------------
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try {
      resolvedRange = resolvePeriod(period, start_date, end_date)
    } catch (e: any) {
      jsonError(res, 400, e.message ?? 'Período inválido')
      return
    }

    // ------------------------------------------------------------------
    // 5. Flow + Conversão em paralelo
    // ------------------------------------------------------------------
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'funnel-flow.ts:step5',message:'chamando flow+conversão',data:{companyId,funnelId,resolvedRange},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    const [flow, conversions] = await Promise.all([
      buildFunnelFlowMetrics(svc, companyId, funnelId, resolvedRange),
      buildFunnelStageConversionMetrics(svc, companyId, funnelId, resolvedRange),
    ])
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'funnel-flow.ts:step5-ok',message:'flow+conversão ok',data:{flowStages:flow.stages.length,conversions:conversions.conversions.length},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion

    // ------------------------------------------------------------------
    // 6. Resposta
    // TTL varia: períodos maiores mudam menos → cache mais longo.
    // ------------------------------------------------------------------
    const periodDays = Math.ceil(
      (new Date(resolvedRange.end).getTime() - new Date(resolvedRange.start).getTime()) / 86_400_000,
    )
    const smaxage = periodDays <= 7 ? 120 : 300

    res.setHeader('Cache-Control', `s-maxage=${smaxage}, stale-while-revalidate=600`)

    return res.status(200).json({
      data: {
        flow,
        conversions,
      },
      meta: {
        period,
        start_date: resolvedRange.start,
        end_date:   resolvedRange.end,
        funnel_id:  funnelId,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'254195'},body:JSON.stringify({sessionId:'254195',location:'funnel-flow.ts:catch',message:'erro no flow',data:{error:msg,stack:err instanceof Error?err.stack?.slice(0,400):null},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    console.error('[dashboard/funnel-flow] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
