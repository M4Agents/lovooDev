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
//     is_internal_trial:    boolean,         // true quando status=trialing E stripe_subscription_id IS NULL
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
  const queryCompanyId = req.query?.company_id ?? null
  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error })

  const { svc, effectiveCompanyId } = ctx

  try {
    // ── 2. Buscar assinatura da empresa ────────────────────────────────────
    const { data: sub, error: subError } = await svc
      .from('company_subscriptions')
      .select(
        'status, billing_cycle, current_period_end, cancel_at_period_end,' +
        'trial_end, last_invoice_url, scheduled_plan_id, stripe_subscription_id,' +
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
        has_subscription:     false,
        status:               null,
        is_internal_trial:    false,
        days_remaining:       null,
        plan_name:            null,
        billing_cycle:        null,
        current_period_end:   null,
        cancel_at_period_end: false,
        scheduled_plan_name:  null,
        last_invoice_url:     null,
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

    // Trial interno: empresa em período de teste sem assinatura Stripe vinculada.
    // Ações como change, cancel e customer-portal são bloqueadas no backend.
    const isInternalTrial = sub.status === 'trialing' && !sub.stripe_subscription_id

    // ── Cálculo de expiração e grace period (exclusivo para trial interno) ──
    // Não atualiza nenhum campo no banco — apenas leitura.
    // is_blocked calculado por comparação de datas, nunca por graceDaysRemaining === 0.
    const GRACE_PERIOD_DAYS = 5
    const now = new Date()

    // Para trials internos sem current_period_end, usar trial_end como referência
    const trialEndDate      = sub.trial_end ? new Date(sub.trial_end) : null
    const effectivePeriodEnd = sub.current_period_end ?? sub.trial_end ?? null

    const isTrialExpired =
      isInternalTrial &&
      trialEndDate !== null &&
      trialEndDate < now

    const gracePeriodEnd =
      isTrialExpired
        ? new Date(trialEndDate.getTime() + GRACE_PERIOD_DAYS * 86_400_000)
        : null

    // Bloqueio determinado por comparação de datas — nunca por graceDaysRemaining
    const isBlocked = gracePeriodEnd !== null && now >= gracePeriodEnd

    const graceDaysRemaining =
      gracePeriodEnd !== null && !isBlocked
        ? Math.max(1, Math.ceil((gracePeriodEnd.getTime() - now.getTime()) / 86_400_000))
        : null

    // Dias restantes do trial ativo (não expirado) — calculado no backend para evitar drift de fuso.
    // Arredondamento para cima (ceil): trial que termina hoje à noite ainda conta como 1 dia.
    let daysRemaining = null
    if (isInternalTrial && effectivePeriodEnd && !isTrialExpired) {
      const diffMs = new Date(effectivePeriodEnd).getTime() - now.getTime()
      daysRemaining = Math.max(0, Math.ceil(diffMs / 86_400_000))
    }

    // ── 5. Resposta — stripe_subscription_id NUNCA exposto ao frontend ────
    // has_subscription = true somente se há assinatura Stripe ativa OU trial interno.
    // Empresas com is_free=true (status='active', sem stripe) retornam false para
    // que o frontend use o fluxo de checkout em vez de tentar alterar uma sub inexistente.
    const has_subscription = !!sub.stripe_subscription_id || isInternalTrial
    return res.status(200).json({
      has_subscription,
      status:               sub.status,
      is_internal_trial:    isInternalTrial,
      days_remaining:       daysRemaining,
      is_trial_expired:     isTrialExpired,
      grace_days_remaining: graceDaysRemaining,
      is_blocked:           isBlocked,
      plan_name:            planName,
      billing_cycle:        sub.billing_cycle,
      current_period_end:   effectivePeriodEnd,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      scheduled_plan_name:  scheduledPlanName,
      last_invoice_url:     sub.last_invoice_url ?? null,
    })

  } catch (err) {
    console.error('[GET /api/plans/subscription] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao buscar assinatura' })
  }
}
