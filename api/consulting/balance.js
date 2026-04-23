// =============================================================================
// GET /api/consulting/balance
//
// Retorna o saldo consultivo da empresa (em minutos e horas).
//
// QUERY:
//   ?company_id=<uuid>  — obrigatório para admin da empresa pai atuando em filha
//
// RESPOSTA (200):
//   { "ok": true, "balance": {
//       "total_credited_minutes", "used_minutes", "available_minutes",
//       "total_credited_hours", "used_hours", "available_hours"
//   }}
//
// SEGURANÇA:
//   - Autenticação obrigatória (Bearer token)
//   - RLS garante acesso apenas a member ou parent_admin
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, effectiveCompanyId } = ctx

  const { data, error } = await svc
    .from('company_consulting_balances')
    .select('total_credited_minutes, used_minutes, available_minutes, updated_at')
    .eq('company_id', effectiveCompanyId)
    .maybeSingle()

  if (error) {
    console.error('[GET /api/consulting/balance] Erro:', error.message)
    return res.status(500).json({ ok: false, error: 'Erro ao carregar saldo' })
  }

  const balance = data ?? { total_credited_minutes: 0, used_minutes: 0, available_minutes: 0 }

  // Converter minutos → horas decimais para exibição na UI
  const toHours = (min) => Math.round((min / 60) * 100) / 100

  return res.status(200).json({
    ok: true,
    balance: {
      total_credited_minutes: balance.total_credited_minutes,
      used_minutes:           balance.used_minutes,
      available_minutes:      balance.available_minutes,
      total_credited_hours:   toHours(balance.total_credited_minutes),
      used_hours:             toHours(balance.used_minutes),
      available_hours:        toHours(balance.available_minutes),
      updated_at:             balance.updated_at ?? null,
    },
  })
}
