// =====================================================
// GET /api/dashboard/ai-analyses
//
// Histórico paginado de análises de IA da empresa.
//
// Query params:
//   company_id     (obrigatório)
//   page           (default: 1)
//   limit          (default: 20, max: 50)
//   analysis_type  (opcional — filtro por tipo)
//   status         (opcional — filtro por status)
//   period         (opcional — filtro pelo período salvo)
//
// Retorna resumo sem output pesado:
//   id, analysis_type, funnel_id, period, status,
//   estimated_credits, credits_used, model, created_at, completed_at,
//   title (se existir em output.title)
//
// Segurança:
//   - Auth obrigatório
//   - Membership validado
//   - Nunca retorna output completo nesta listagem
// =====================================================

import { getSupabaseAdmin }    from '../lib/automation/supabaseAdmin.js'
import { extractToken, assertMembership, jsonError } from '../lib/dashboard/auth.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT     = 50

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // 1. Auth
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // 2. company_id + membership
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // 3. Paginação
    const rawLimit = parseInt(req.query.limit ?? String(DEFAULT_LIMIT), 10)
    const limit    = Math.min(isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT)
    const rawPage  = parseInt(req.query.page ?? '1', 10)
    const page     = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage
    const offset   = (page - 1) * limit

    // 4. Filtros opcionais
    const filterType   = typeof req.query.analysis_type === 'string' ? req.query.analysis_type.trim() : null
    const filterStatus = typeof req.query.status        === 'string' ? req.query.status.trim()        : null
    const filterPeriod = typeof req.query.period        === 'string' ? req.query.period.trim()        : null

    // 5. Query — seleciona campos leves (sem output pesado)
    let query = svc
      .from('dashboard_ai_analyses')
      .select([
        'id', 'analysis_type', 'funnel_id', 'period', 'status',
        'estimated_credits', 'credits_used', 'model',
        'created_at', 'completed_at', 'started_at',
        'output->title',    // apenas o título do output, sem o objeto completo
      ].join(', '), { count: 'exact' })
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (filterType)   query = query.eq('analysis_type', filterType)
    if (filterStatus) query = query.eq('status', filterStatus)
    if (filterPeriod) query = query.eq('period', filterPeriod)

    const { data, count, error } = await query

    if (error) {
      console.error('[dashboard/ai-analyses] Erro na query:', error.message)
      jsonError(res, 500, 'Erro ao buscar histórico'); return
    }

    // 6. Normalizar — output->title pode vir como campo separado dependendo do PostgREST
    const items = (data ?? []).map((row: any) => ({
      id:                row.id,
      analysis_type:     row.analysis_type,
      funnel_id:         row.funnel_id,
      period:            row.period,
      status:            row.status,
      estimated_credits: row.estimated_credits,
      credits_used:      row.credits_used,
      model:             row.model,
      created_at:        row.created_at,
      started_at:        row.started_at,
      completed_at:      row.completed_at,
      title:             row.title ?? null,
    }))

    const totalPages = count ? Math.ceil(count / limit) : 1

    return res.status(200).json({
      ok:   true,
      data: items,
      meta: {
        total:       count ?? 0,
        page,
        limit,
        total_pages: totalPages,
        has_more:    page < totalPages,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/ai-analyses] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
