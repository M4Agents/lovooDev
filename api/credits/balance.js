// =============================================================================
// GET /api/credits/balance
//
// Retorna o saldo atual de créditos de IA de uma empresa.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <jwt>
//
// MULTI-TENANT:
//   - Empresa filha: retorna saldo da própria empresa (query param ignorado)
//   - Empresa pai:   ?company_id=<uuid> obrigatório (filha direta validada)
//
// RESPOSTA (200):
//   {
//     "plan_credits":  number,   // créditos do plano mensal (não acumulam)
//     "extra_credits": number,   // créditos avulsos comprados (acumulam)
//     "total":         number,   // plan_credits + extra_credits
//     "plan_credits_total": number,  // cota do ciclo atual (para % de uso)
//     "last_renewed_at":    string | null,
//     "next_renewal_at":    string | null   // last_renewed_at + 1 mês
//   }
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── Parsear query params ──────────────────────────────────────────────────
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params         = new URLSearchParams(qs)
  const queryCompanyId = params.get('company_id') ?? null

  // ── Auth + multi-tenant ───────────────────────────────────────────────────
  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, effectiveCompanyId } = ctx

  // ── Buscar saldo ──────────────────────────────────────────────────────────
  // RLS da tabela company_credits permite SELECT para membro da empresa
  // ou admin da empresa pai. Como usamos service_role, a validação já foi
  // feita acima via resolveCreditsContext.

  const { data, error } = await svc
    .from('company_credits')
    .select('plan_credits, extra_credits, plan_credits_total, last_renewed_at, billing_cycle_anchor')
    .eq('company_id', effectiveCompanyId)
    .maybeSingle()

  if (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao buscar saldo de créditos' })
  }

  if (!data) {
    // Empresa sem registro ainda — saldo zero
    return res.status(200).json({
      ok:                 true,
      plan_credits:       0,
      extra_credits:      0,
      total:              0,
      plan_credits_total: 0,
      last_renewed_at:    null,
      next_renewal_at:    null,
    })
  }

  const planCredits  = data.plan_credits  ?? 0
  const extraCredits = data.extra_credits ?? 0

  // next_renewal_at = last_renewed_at + 1 mês exato (mesmo dia do mês)
  const nextRenewalAt = data.last_renewed_at
    ? (() => {
        const d = new Date(data.last_renewed_at)
        d.setMonth(d.getMonth() + 1)
        return d.toISOString()
      })()
    : null

  return res.status(200).json({
    ok:                 true,
    plan_credits:       planCredits,
    extra_credits:      extraCredits,
    total:              planCredits + extraCredits,
    plan_credits_total: data.plan_credits_total ?? 0,
    last_renewed_at:    data.last_renewed_at ?? null,
    next_renewal_at:    nextRenewalAt,
  })
}
