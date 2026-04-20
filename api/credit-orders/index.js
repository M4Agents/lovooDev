// =============================================================================
// GET /api/credit-orders
//
// Retorna o histórico paginado de pedidos de créditos de uma empresa.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <jwt>
//
// QUERY PARAMS:
//   company_id  (string)  — obrigatório apenas para empresa pai
//   limit       (number)  — padrão: 20, máximo: 100
//   offset      (number)  — padrão: 0
//
// MULTI-TENANT:
//   - Empresa filha: retorna pedidos da própria empresa (query param ignorado)
//   - Empresa pai:   ?company_id= obrigatório (filha direta validada)
//
// RESPOSTA (200):
//   {
//     "ok": true,
//     "data": [
//       {
//         "id":              string,
//         "package_name":   string,
//         "credits":        number,     // credits_snapshot
//         "price":          number,     // price_snapshot
//         "status":         string,     // pending_payment | checkout_created | paid | failed | cancelled | expired
//         "paid_at":        string | null,
//         "created_at":     string
//       }
//     ],
//     "total":  number,
//     "limit":  number,
//     "offset": number
//   }
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

const MAX_LIMIT     = 100
const DEFAULT_LIMIT = 20

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── Parsear query params ──────────────────────────────────────────────────
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params         = new URLSearchParams(qs)
  const queryCompanyId = params.get('company_id') ?? null

  const rawLimit  = parseInt(params.get('limit')  ?? String(DEFAULT_LIMIT), 10)
  const rawOffset = parseInt(params.get('offset') ?? '0', 10)

  const limit  = isNaN(rawLimit)  || rawLimit  <= 0 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT)
  const offset = isNaN(rawOffset) || rawOffset <  0 ? 0             : rawOffset

  // ── Auth + multi-tenant ───────────────────────────────────────────────────
  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, effectiveCompanyId } = ctx

  // ── Buscar pedidos com join no nome do pacote ─────────────────────────────
  const { data, error, count } = await svc
    .from('credit_orders')
    .select(
      'id, credits_snapshot, price_snapshot, status, paid_at, created_at, credit_packages(name)',
      { count: 'exact' }
    )
    .eq('company_id', effectiveCompanyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao buscar histórico de pedidos' })
  }

  const mapped = (data ?? []).map(row => ({
    id:           row.id,
    package_name: row.credit_packages?.name ?? '—',
    credits:      row.credits_snapshot,
    price:        row.price_snapshot,
    status:       row.status,
    paid_at:      row.paid_at ?? null,
    created_at:   row.created_at,
  }))

  return res.status(200).json({
    ok:     true,
    data:   mapped,
    total:  count  ?? 0,
    limit,
    offset,
  })
}
