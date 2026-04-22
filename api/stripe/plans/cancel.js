// =============================================================================
// POST /api/stripe/plans/cancel
//
// Agenda o cancelamento de uma assinatura Stripe para o fim do ciclo atual.
// NÃO cancela imediatamente — o cliente mantém acesso até o fim do período pago.
//
// O plano operacional NÃO é alterado aqui. O webhook cuida disso:
//   → customer.subscription.updated: sync com cancel_at_period_end=true
//   → customer.subscription.deleted: aplica plano "suspended"
//
// BODY: (vazio)
//
// RESPOSTA (200):
//   { "success": true, "cancel_at_period_end": true }
//
// ERROS:
//   400 no_active_subscription       — empresa sem assinatura ativa
//   400 already_scheduled_to_cancel  — cancelamento já agendado
//   401 / 403                        — autenticação ou acesso negado
//   502                              — erro de comunicação com Stripe
//   500                              — erro interno
//
// SEGURANÇA:
//   - company_id NUNCA aceito do body — sempre da sessão autenticada
//   - Nenhuma mudança operacional aqui: companies.plan_id inalterado
//   - Toda ação de suspensão vem do webhook customer.subscription.deleted
// =============================================================================

import { resolveCreditsContext } from '../../lib/credits/authContext.js'
import { getStripe }             from '../../lib/stripe/client.js'

const ALLOWED_ROLES     = new Set(['admin', 'super_admin', 'system_admin'])
const ACTIVE_SUB_STATUS = new Set(['active', 'trialing'])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Auth + contexto multi-tenant ───────────────────────────────────────
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error })

  const { svc, effectiveCompanyId } = ctx

  // ── 2. Role: apenas admin+ ────────────────────────────────────────────────
  const { data: membership } = await svc
    .from('company_users')
    .select('role')
    .eq('company_id', effectiveCompanyId)
    .eq('user_id', ctx.userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!membership || !ALLOWED_ROLES.has(membership.role)) {
    return res.status(403).json({ error: 'Acesso restrito a administradores da empresa' })
  }

  try {
    // ── 3. Validar assinatura ativa ────────────────────────────────────────
    const { data: existingSub } = await svc
      .from('company_subscriptions')
      .select('id, status, stripe_subscription_id, cancel_at_period_end')
      .eq('company_id', effectiveCompanyId)
      .maybeSingle()

    // Trial interno: tem registro mas sem stripe_subscription_id.
    // Não há assinatura Stripe para cancelar — trial expira automaticamente via cron.
    if (existingSub?.status === 'trialing' && !existingSub?.stripe_subscription_id) {
      return res.status(400).json({ error: 'trial_has_no_subscription' })
    }

    if (!existingSub?.stripe_subscription_id || !ACTIVE_SUB_STATUS.has(existingSub.status)) {
      return res.status(400).json({ error: 'no_active_subscription' })
    }

    // Cancelamento já agendado — idempotente, informa o cliente
    if (existingSub.cancel_at_period_end === true) {
      return res.status(200).json({
        success:             true,
        cancel_at_period_end: true,
        already_scheduled:   true,
      })
    }

    // ── 4. Agendar cancelamento no Stripe ──────────────────────────────────
    // cancel_at_period_end=true: cliente mantém acesso até o fim do ciclo pago
    // O webhook customer.subscription.deleted aplica o plano "suspended"
    await getStripe().subscriptions.update(
      existingSub.stripe_subscription_id,
      { cancel_at_period_end: true }
    )

    console.log('[POST /api/stripe/plans/cancel] Cancelamento agendado | company:', effectiveCompanyId,
      '| sub:', existingSub.stripe_subscription_id)

    // ── 5. Resposta ────────────────────────────────────────────────────────
    // NÃO alterar companies.plan_id aqui — webhook cuida do estado operacional
    return res.status(200).json({ success: true, cancel_at_period_end: true })

  } catch (err) {
    if (err.type?.startsWith('Stripe')) {
      console.error('[POST /api/stripe/plans/cancel] Stripe error:', err.message, {
        type: err.type, code: err.code, company: effectiveCompanyId,
      })
      return res.status(502).json({ error: 'Erro ao comunicar com Stripe. Tente novamente.' })
    }

    console.error('[POST /api/stripe/plans/cancel] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao processar cancelamento' })
  }
}
