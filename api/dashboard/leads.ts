// =====================================================
// GET /api/dashboard/leads
//
// Lista paginada de leads novos no período.
// Fonte: leads filtrado por created_at dentro do período.
//
// Query params:
//   company_id  (obrigatório)
//   period / start_date / end_date
//   user_id     (opcional — manager+ filtra por vendedor; seller/partner ignora e usa auth.uid)
//   page (default 1)
//   limit (default 20, max 20)
//
// RBAC:
//   seller/partner → sempre filtra por responsible_user_id = auth.uid()
//   manager+       → company-wide quando user_id ausente; filtra pelo alvo validado quando presente
// =====================================================

import { getSupabaseAdmin }  from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }     from '../lib/dashboard/period.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

const DEFAULT_LIMIT = 20
const MAX_LIMIT     = 20

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
    // 3. RBAC — determina effectiveUserId por role
    // ------------------------------------------------------------------
    const callerRole = membership.role
    const rawUserId  = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : null

    let effectiveUserId: string | null = null

    if (!MANAGER_ROLES.has(callerRole)) {
      // seller / partner: sempre força o próprio ID (ignora query.user_id)
      effectiveUserId = user.id
    } else if (rawUserId) {
      // manager+: se user_id enviado, valida que o alvo é membro ativo
      const targetMembership = await assertMembership(svc, rawUserId, companyId)
      if (!targetMembership) {
        jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa'); return
      }
      effectiveUserId = rawUserId
    }
    // manager+ sem user_id → effectiveUserId = null → visão company-wide

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
    // 5. Paginação
    // ------------------------------------------------------------------
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10) || 1)
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
    const offset = (page - 1) * limit

    // ------------------------------------------------------------------
    // 6. Count + dados em paralelo
    // ------------------------------------------------------------------
    function buildBase(select: string, head = false) {
      let q = svc
        .from('leads')
        .select(select, head ? { count: 'exact', head: true } : undefined)
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .gte('created_at', resolvedRange.start)
        .lte('created_at', resolvedRange.end)

      if (effectiveUserId) q = q.eq('responsible_user_id', effectiveUserId)

      return q
    }

    const [countResult, dataResult] = await Promise.all([
      buildBase('id', true),
      buildBase('id, name, status, origin, created_at')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
    ])

    if (countResult.error) throw new Error(`count: ${countResult.error.message}`)
    if (dataResult.error)  throw new Error(`data: ${dataResult.error.message}`)

    const leads = (dataResult.data ?? []) as Array<{
      id: string; name: string; status: string; origin: string; created_at: string
    }>
    const total = countResult.count ?? 0

    return res.status(200).json({
      ok: true,
      data: leads.map(l => ({
        lead_id:    l.id,
        name:       l.name ?? '—',
        status:     l.status ?? '',
        origin:     l.origin ?? '',
        created_at: l.created_at,
      })),
      meta: {
        page,
        limit,
        total,
        has_more:   offset + limit < total,
        period,
        start_date: resolvedRange.start,
        end_date:   resolvedRange.end,
        user_id:    effectiveUserId ?? null,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/leads] Erro:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
