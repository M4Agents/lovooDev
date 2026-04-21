// =============================================================================
// GET /api/plans/subscription
//
// Retorna o estado atual da assinatura Stripe da empresa autenticada.
// Usado pelo frontend para exibir status, próxima cobrança e ações disponíveis.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//
// RESPOSTA (200):
//   {
//     has_subscription:     boolean,
//     status:               "active" | "trialing" | "past_due" | "incomplete" | "canceled" | null,
//     plan_name:            string | null,
//     billing_cycle:        "monthly" | "yearly" | null,
//     current_period_end:   string | null,   // ISO 8601
//     cancel_at_period_end: boolean,
//     scheduled_plan_name:  string | null,   // plano agendado para próximo ciclo
//     last_invoice_url:     string | null,   // URL de pagamento para ação 3DS
//   }
//
// SEGURANÇA:
//   - stripe_subscription_id NUNCA retornado ao frontend
//   - company_id vem da sessão autenticada — nunca do body
//   - Qualquer membro autenticado da empresa pode consultar
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Auth + contexto multi-tenant ───────────────────────────────────────
  const ctx = await resolveCreditsContext(req, null)
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error })

  const { svc, effectiveCompanyId } = ctx

  try {
    // ── 2. Buscar assinatura da empresa ────────────────────────────────────
    const { data: sub, error: subError } = await svc
      .from('company_subscriptions')
      .select(
        'status, billing_cycle, current_period_end, cancel_at_period_end,' +
        'last_invoice_url, scheduled_plan_id,' +
        'plans!company_subscriptions_plan_id_fkey(name)'
      )
      .eq('company_id', effectiveCompanyId)
      .maybeSingle()

    if (subError) {
      console.error('[GET /api/plans/subscription] Erro ao buscar assinatura:', subError.message)
      return res.status(500).json({ error: 'Erro ao buscar dados da assinatura' })
    }

    // ── 3. Sem assinatura — resposta padrão ───────────────────────────────
    if (!sub) {
      return res.status(200).json({
        has_subscription:    false,
        status:              null,
        plan_name:           null,
        billing_cycle:       null,
        current_period_end:  null,
        cancel_at_period_end: false,
        scheduled_plan_name: null,
        last_invoice_url:    null,
      })
    }

    // ── 4. Resolver nome do plano agendado (downgrade futuro) ─────────────
    let scheduledPlanName = null
    if (sub.scheduled_plan_id) {
      const { data: scheduledPlan } = await svc
        .from('plans')
        .select('name')
        .eq('id', sub.scheduled_plan_id)
        .maybeSingle()

      scheduledPlanName = scheduledPlan?.name ?? null
    }

    // Extrair plan_name do join (Supabase pode retornar objeto ou array)
    const planData = sub.plans
    const planName = Array.isArray(planData)
      ? (planData[0]?.name ?? null)
      : (planData?.name ?? null)

    // ── 5. Resposta — stripe_subscription_id NUNCA exposto ao frontend ────
    return res.status(200).json({
      has_subscription:     true,
      status:               sub.status,
      plan_name:            planName,
      billing_cycle:        sub.billing_cycle,
      current_period_end:   sub.current_period_end,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      scheduled_plan_name:  scheduledPlanName,
      last_invoice_url:     sub.last_invoice_url ?? null,
    })

  } catch (err) {
    console.error('[GET /api/plans/subscription] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao buscar assinatura' })
  }
}
