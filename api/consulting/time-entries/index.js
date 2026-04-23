// =============================================================================
// GET  /api/consulting/time-entries   — lista lançamentos da empresa
// POST /api/consulting/time-entries   — cria lançamento (platform_admin apenas)
//
// QUERY (GET):
//   ?company_id=<uuid>  — obrigatório para admin da empresa pai
//   ?page=<n>           — paginação (default: 1)
//   ?limit=<n>          — itens por página (default: 20, max: 100)
//
// BODY (POST, JSON):
//   {
//     "entry_date": "YYYY-MM-DD",
//     "start_time": "HH:MM",
//     "end_time":   "HH:MM",
//     "description": "...",
//     "entry_type":  "implementation" | "training" | "consulting",
//     "performed_by_user_id": "<uuid>" (opcional)
//   }
//
// SEGURANÇA:
//   - GET: membro ou admin da empresa pai pode listar
//   - POST: apenas platform_admin (auth_user_is_platform_admin no backend)
//   - duration_minutes sempre calculado pela RPC — nunca aceito do frontend
// =============================================================================

import { resolveCreditsContext } from '../../lib/credits/authContext.js'

const PLATFORM_ADMIN_ROLES = new Set(['super_admin', 'system_admin'])

async function isPlatformAdmin(svc, userId) {
  const { data } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('role', ['super_admin', 'system_admin'])
    .limit(1)
    .maybeSingle()

  return !!data
}

export default async function handler(req, res) {
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params         = new URLSearchParams(qs)
  const queryCompanyId = params.get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, effectiveCompanyId, userId } = ctx

  // ── GET: listar lançamentos ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const page  = Math.max(1, parseInt(params.get('page')  ?? '1',  10))
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '20', 10)))
    const from  = (page - 1) * limit
    const to    = from + limit - 1

    const { data, error, count } = await svc
      .from('consulting_time_entries')
      .select('*, created_by_user:created_by(id, email)', { count: 'exact' })
      .eq('company_id', effectiveCompanyId)
      .is('deleted_at', null)
      .order('entry_date', { ascending: false })
      .order('start_time', { ascending: false })
      .range(from, to)

    if (error) {
      console.error('[GET /api/consulting/time-entries] Erro:', error.message)
      return res.status(500).json({ ok: false, error: 'Erro ao carregar lançamentos' })
    }

    return res.status(200).json({
      ok:      true,
      entries: data ?? [],
      total:   count ?? 0,
      page,
      limit,
    })
  }

  // ── POST: criar lançamento (platform_admin apenas) ─────────────────────────
  if (req.method === 'POST') {
    const isAdmin = await isPlatformAdmin(svc, userId)
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: 'Apenas administradores da plataforma podem lançar horas' })
    }

    let body = {}
    try {
      body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
    } catch {
      return res.status(400).json({ ok: false, error: 'Body inválido' })
    }

    const { entry_date, start_time, end_time, description, entry_type, performed_by_user_id } = body

    if (!entry_date || !start_time || !end_time || !description || !entry_type) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: entry_date, start_time, end_time, description, entry_type' })
    }

    const { data: result, error: rpcError } = await svc.rpc('create_consulting_time_entry', {
      p_company_id:           effectiveCompanyId,
      p_entry_date:           entry_date,
      p_start_time:           start_time,
      p_end_time:             end_time,
      p_description:          description,
      p_entry_type:           entry_type,
      p_performed_by_user_id: performed_by_user_id ?? null,
      p_created_by:           userId,
    })

    if (rpcError) {
      console.error('[POST /api/consulting/time-entries] Erro RPC:', rpcError.message)
      return res.status(500).json({ ok: false, error: 'Erro ao registrar lançamento' })
    }

    if (!result?.success) {
      const statusMap = {
        insufficient_balance:            400,
        insufficient_balance_constraint: 400,
        balance_not_found:               404,
        invalid_entry_type:              400,
        end_time_must_be_after_start_time: 400,
        duration_must_be_positive:       400,
      }
      const status = statusMap[result?.error] ?? 500
      return res.status(status).json({ ok: false, error: result?.error ?? 'Erro desconhecido', details: result })
    }

    return res.status(201).json({ ok: true, entry_id: result.entry_id, duration_minutes: result.duration_minutes })
  }

  return res.status(405).json({ ok: false, error: 'Método não permitido' })
}
