// =====================================================
// GET /api/dashboard/conversations
//
// Lista paginada de conversas ativas no período.
// Fonte: chat_conversations filtrado por updated_at no período.
//
// Query params:
//   company_id  (obrigatório)
//   period / start_date / end_date
//   ai_state    (opcional — ex: 'active', 'paused', 'handoff')
//   page (default 1)
//   limit (default 20, max 20)
// =====================================================

import { getSupabaseAdmin }  from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }     from '../lib/dashboard/period.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

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

    // ------------------------------------------------------------------
    // 3. Período
    // ------------------------------------------------------------------
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try { resolvedRange = resolvePeriod(period, start_date, end_date) }
    catch (e: any) { jsonError(res, 400, e.message ?? 'Período inválido'); return }

    // ------------------------------------------------------------------
    // 4. Filtro opcional de ai_state
    // ------------------------------------------------------------------
    const aiState = typeof req.query.ai_state === 'string' ? req.query.ai_state.trim() : null

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
        .from('chat_conversations')
        .select(select, head ? { count: 'exact', head: true } : undefined)
        .eq('company_id', companyId)
        .gte('updated_at', resolvedRange.start)
        .lte('updated_at', resolvedRange.end)

      if (aiState) q = q.eq('ai_state', aiState)
      return q
    }

    const [countResult, dataResult] = await Promise.all([
      buildBase('id', true),
      buildBase('id, contact_name, lead_id, ai_state, last_message_at, status, unread_count')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1),
    ])

    if (countResult.error) throw new Error(`count: ${countResult.error.message}`)
    if (dataResult.error)  throw new Error(`data: ${dataResult.error.message}`)

    const convs = (dataResult.data ?? []) as Array<{
      id: string
      contact_name: string
      lead_id: string | null
      ai_state: string | null
      last_message_at: string | null
      status: string | null
      unread_count: number
    }>
    const total = countResult.count ?? 0

    // ------------------------------------------------------------------
    // 7. Enriquecer com lead name quando contact_name ausente
    // ------------------------------------------------------------------
    const leadIds = [...new Set(convs.map(c => c.lead_id).filter(Boolean))] as string[]
    const leadMap = new Map<string, string>()

    if (leadIds.length > 0) {
      const { data: leads } = await svc
        .from('leads')
        .select('id, name')
        .in('id', leadIds)
      ;(leads ?? []).forEach((l: { id: string; name: string }) => leadMap.set(l.id, l.name))
    }

    return res.status(200).json({
      ok: true,
      data: convs.map(c => ({
        conversation_id:  c.id,
        lead_name:        c.contact_name || (c.lead_id ? leadMap.get(c.lead_id) : null) || '—',
        ai_state:         c.ai_state ?? 'unknown',
        last_message_at:  c.last_message_at ?? null,
        status:           c.status ?? '',
        unread_count:     c.unread_count ?? 0,
      })),
      meta: {
        page,
        limit,
        total,
        has_more: offset + limit < total,
        period,
        start_date: resolvedRange.start,
        end_date:   resolvedRange.end,
        ai_state:   aiState ?? null,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/conversations] Erro:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
