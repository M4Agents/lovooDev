// =============================================================================
// GET /api/credits/transactions
//
// Retorna o histórico paginado de transações de créditos de uma empresa.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <jwt>
//
// QUERY PARAMS:
//   company_id  (string)  — obrigatório apenas para empresa pai
//   limit       (number)  — padrão: 50, máximo: 100
//   offset      (number)  — padrão: 0
//
// MULTI-TENANT:
//   - Empresa filha: retorna transações da própria empresa
//   - Empresa pai:   ?company_id= obrigatório (filha direta validada)
//
// RESPOSTA (200):
//   {
//     "ok": true,
//     "data": [
//       {
//         "id":                  string,
//         "type":                string,   // "usage" | "plan_renewal" | "purchase" | "adjustment"
//         "credits":             number,   // negativo = débito, positivo = crédito
//         "balance_after":       number,
//         "plan_balance_after":  number,
//         "extra_balance_after": number,
//         "feature_type":        string | null,
//         "created_at":          string
//       }
//     ],
//     "total":  number,   // total de registros (para paginação)
//     "limit":  number,
//     "offset": number
//   }
//
// NOTA: metadata e execution_log_id NÃO são retornados (dados internos de auditoria).
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

const MAX_LIMIT     = 100
const DEFAULT_LIMIT = 50

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

  // ── Buscar transações ─────────────────────────────────────────────────────
  // Selecionamos apenas colunas relevantes para o consumidor.
  // metadata e execution_log_id são dados internos de auditoria — omitidos.

  const { data, error, count } = await svc
    .from('credit_transactions')
    .select(
      'id, type, credits, balance_after, plan_balance_after, extra_balance_after, feature_type, created_at',
      { count: 'exact' }
    )
    .eq('company_id', effectiveCompanyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao buscar transações' })
  }

  return res.status(200).json({
    ok:     true,
    data:   data ?? [],
    total:  count  ?? 0,
    limit,
    offset,
  })
}
