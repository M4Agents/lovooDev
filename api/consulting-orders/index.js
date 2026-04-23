// =============================================================================
// GET /api/consulting-orders
//
// Lista pedidos de compra de pacotes consultivos da empresa.
//
// QUERY:
//   ?company_id=<uuid>  — obrigatório para admin da empresa pai
//   ?page=<n>           — paginação (default: 1)
//   ?limit=<n>          — itens por página (default: 20, max: 100)
//
// RESPOSTA (200):
//   { "ok": true, "orders": [...], "total": <n>, "page": <n>, "limit": <n> }
//
// SEGURANÇA:
//   - Autenticação obrigatória
//   - RLS garante acesso apenas a member ou parent_admin
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params         = new URLSearchParams(qs)
  const queryCompanyId = params.get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, effectiveCompanyId } = ctx

  const page  = Math.max(1, parseInt(params.get('page')  ?? '1',  10))
  const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '20', 10)))
  const from  = (page - 1) * limit
  const to    = from + limit - 1

  const { data, error, count } = await svc
    .from('consulting_orders')
    .select('*', { count: 'exact' })
    .eq('company_id', effectiveCompanyId)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[GET /api/consulting-orders] Erro:', error.message)
    return res.status(500).json({ ok: false, error: 'Erro ao carregar pedidos' })
  }

  return res.status(200).json({
    ok:     true,
    orders: data ?? [],
    total:  count ?? 0,
    page,
    limit,
  })
}
