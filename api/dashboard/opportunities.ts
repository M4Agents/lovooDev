// =====================================================
// GET /api/dashboard/opportunities
//
// Lista paginada de oportunidades com filtros do dashboard.
// Fonte: opportunities → leads (nomes) + opportunity_funnel_positions (etapa)
//
// Query params:
//   company_id      (obrigatório — validado contra membership)
//   period / start_date / end_date
//   funnel_id       (opcional — filtra via opportunity_funnel_positions)
//   stage_id        (opcional — filtra via opportunity_funnel_positions)
//   status          (opcional)
//   probability_min (opcional, number)
//   page            (default 1)
//   limit           (default 20, max 20 — ou default 10, max 10 se source=insight_inline)
//   source          (opcional — 'insight_inline' ativa modo compacto de limite)
// =====================================================

import { getSupabaseAdmin }  from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }     from '../lib/dashboard/period.js'
import {
  extractToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'

const DEFAULT_LIMIT         = 20
const MAX_LIMIT             = 20
const INLINE_DEFAULT_LIMIT  = 30
const INLINE_MAX_LIMIT      = 30

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ------------------------------------------------------------------
    // 1. Auth
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // ------------------------------------------------------------------
    // 2. Membership + company_id
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. Período (opcional — filtra por updated_at)
    // ------------------------------------------------------------------
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try { resolvedRange = resolvePeriod(period, start_date, end_date) }
    catch (e: any) { jsonError(res, 400, e.message ?? 'Período inválido'); return }

    // ------------------------------------------------------------------
    // 4. Filtros opcionais
    // ------------------------------------------------------------------
    const funnelId     = typeof req.query.funnel_id       === 'string' ? req.query.funnel_id.trim()       : null
    const stageId      = typeof req.query.stage_id        === 'string' ? req.query.stage_id.trim()        : null
    const status       = typeof req.query.status          === 'string' ? req.query.status.trim()          : null
    const source       = typeof req.query.source          === 'string' ? req.query.source.trim()          : null
    const probabilityMin = req.query.probability_min !== undefined ? Number(req.query.probability_min) : null

    const isInlineMode = source === 'insight_inline'

    if (funnelId) {
      const valid = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
    }

    // ------------------------------------------------------------------
    // 5. Paginação — limits diferenciados por source
    // ------------------------------------------------------------------
    const effectiveDefault = isInlineMode ? INLINE_DEFAULT_LIMIT : DEFAULT_LIMIT
    const effectiveMax     = isInlineMode ? INLINE_MAX_LIMIT     : MAX_LIMIT

    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10) || 1)
    const limit = Math.min(effectiveMax, Math.max(1, parseInt(String(req.query.limit ?? String(effectiveDefault)), 10) || effectiveDefault))
    const offset = (page - 1) * limit

    // ------------------------------------------------------------------
    // 6. Se funnel_id ou stage_id fornecidos: pré-filtrar via posições
    // ------------------------------------------------------------------
    let allowedOppIds: string[] | null = null

    if (funnelId || stageId) {
      let posQuery = svc
        .from('opportunity_funnel_positions')
        .select('opportunity_id')

      if (funnelId) posQuery = posQuery.eq('funnel_id', funnelId)
      if (stageId)  posQuery = posQuery.eq('stage_id', stageId)

      const { data: positions, error: posErr } = await posQuery
      if (posErr) throw new Error(`positions filter: ${posErr.message}`)

      allowedOppIds = (positions ?? []).map((p: { opportunity_id: string }) => p.opportunity_id)

      // Sem posições → retornar lista vazia imediatamente
      if (allowedOppIds.length === 0) {
        return res.status(200).json({
          ok: true,
          data: [],
          meta: { page, limit, total: 0, has_more: false, period, start_date: resolvedRange.start, end_date: resolvedRange.end, funnel_id: funnelId },
        })
      }
    }

    // ------------------------------------------------------------------
    // 7. Query principal em opportunities
    // ------------------------------------------------------------------
    function buildBaseQuery(select: string, head = false) {
      let q = svc
        .from('opportunities')
        .select(select, head ? { count: 'exact', head: true } : undefined)
        .eq('company_id', companyId)
        .gte('updated_at', resolvedRange.start)
        .lte('updated_at', resolvedRange.end)

      if (status)              q = q.eq('status', status)
      if (probabilityMin !== null && !isNaN(probabilityMin)) q = q.gte('probability', probabilityMin)
      if (allowedOppIds)       q = q.in('id', allowedOppIds)
      return q
    }

    const [countResult, dataResult] = await Promise.all([
      buildBaseQuery('id', true),
      buildBaseQuery('id, title, probability, status, updated_at, lead_id, last_interaction_at')
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ])

    if (countResult.error) throw new Error(`count: ${countResult.error.message}`)
    if (dataResult.error)  throw new Error(`data: ${dataResult.error.message}`)

    const opps = (dataResult.data ?? []) as Array<{
      id: string; title: string; probability: number; status: string; updated_at: string; lead_id: string; last_interaction_at: string | null
    }>
    const total = countResult.count ?? 0

    // ------------------------------------------------------------------
    // 8. Enriquecer com lead names (batch)
    // ------------------------------------------------------------------
    const leadIds = [...new Set(opps.map(o => o.lead_id).filter(Boolean))]
    const leadMap = new Map<string, string>()

    if (leadIds.length > 0) {
      const { data: leads } = await svc
        .from('leads')
        .select('id, name')
        .in('id', leadIds)
      ;(leads ?? []).forEach((l: { id: string; name: string }) => leadMap.set(l.id, l.name))
    }

    // ------------------------------------------------------------------
    // 9. Enriquecer com stage name (batch)
    // ------------------------------------------------------------------
    const oppIds  = opps.map(o => o.id)
    const stageMap = new Map<string, string>()

    if (oppIds.length > 0) {
      const { data: positions } = await svc
        .from('opportunity_funnel_positions')
        .select('opportunity_id, stage_id')
        .in('opportunity_id', oppIds)

      const stageIds = [...new Set((positions ?? []).map((p: { stage_id: string }) => p.stage_id).filter(Boolean))]

      if (stageIds.length > 0) {
        const { data: stages } = await svc
          .from('funnel_stages')
          .select('id, name')
          .in('id', stageIds)
        const stageById = new Map((stages ?? []).map((s: { id: string; name: string }) => [s.id, s.name]))

        ;(positions ?? []).forEach((p: { opportunity_id: string; stage_id: string }) => {
          stageMap.set(p.opportunity_id, stageById.get(p.stage_id) ?? '')
        })
      }
    }

    // ------------------------------------------------------------------
    // 10. Montar payload final
    // ------------------------------------------------------------------
    const data = opps.map(o => ({
      opportunity_id:      o.id,
      title:               o.title ?? '',
      lead_name:           leadMap.get(o.lead_id) ?? '—',
      lead_id:             Number(o.lead_id),
      stage_name:          stageMap.get(o.id) ?? '—',
      probability:         o.probability ?? 0,
      status:              o.status ?? '',
      updated_at:          o.updated_at,
      last_interaction_at: o.last_interaction_at ?? null,
    }))

    return res.status(200).json({
      ok: true,
      data,
      meta: {
        page,
        limit,
        total,
        has_more: offset + limit < total,
        period,
        start_date: resolvedRange.start,
        end_date:   resolvedRange.end,
        funnel_id:  funnelId ?? null,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/opportunities] Erro:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
