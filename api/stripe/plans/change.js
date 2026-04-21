// =============================================================================
// POST /api/stripe/plans/change
//
// Altera o plano de uma assinatura Stripe EXISTENTE (upgrade ou downgrade).
// Exclusivo para empresas COM assinatura Stripe ativa.
// Para empresas sem assinatura, use POST /api/stripe/plans/checkout.
//
// BODY (JSON):
//   { "to_plan_id": "<uuid>" }
//
// RESPOSTA (200):
//   { "success": true, "type": "upgrade" | "downgrade" }
//
// ERROS:
//   400 to_plan_id_required          — campo ausente
//   400 no_active_subscription       — empresa sem assinatura ativa
//   400 plan_not_available           — plano inativo ou não listado publicamente
//   400 plan_not_stripe_purchasable  — plano sem stripe_price_id_monthly
//   400 already_on_this_plan         — empresa já está neste plano
//   401 / 403                        — autenticação ou acesso negado
//   502                              — erro de comunicação com Stripe
//   500                              — erro interno
//
// SEGURANÇA:
//   - company_id NUNCA aceito do body — sempre da sessão autenticada
//   - stripe_price_id_monthly lido do banco — nunca do frontend
//   - Nenhuma mudança operacional aqui: toda aplicação vem do webhook
//   - Idempotency key por company+plan+dia para prevenir chamadas duplicadas
// =============================================================================

import { resolveCreditsContext } from '../../lib/credits/authContext.js'
import { getStripe }             from '../../lib/stripe/client.js'

const ALLOWED_ROLES     = new Set(['admin', 'super_admin', 'system_admin'])
const ACTIVE_SUB_STATUS = new Set(['active', 'trialing'])

const idempotencyKeyFor = (companyId, planId) => {
  const day = new Date().toISOString().slice(0, 10)
  return `change-plan-${companyId}-${planId}-${day}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Body ────────────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ error: 'Body inválido' })
  }

  const { to_plan_id } = body
  if (!to_plan_id || typeof to_plan_id !== 'string') {
    return res.status(400).json({ error: 'to_plan_id_required' })
  }

  // ── 2. Auth + contexto multi-tenant ───────────────────────────────────────
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error })

  const { svc, effectiveCompanyId, userId } = ctx

  // ── 3. Role: apenas admin+ ────────────────────────────────────────────────
  const { data: membership } = await svc
    .from('company_users')
    .select('role')
    .eq('company_id', effectiveCompanyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!membership || !ALLOWED_ROLES.has(membership.role)) {
    return res.status(403).json({ error: 'Acesso restrito a administradores da empresa' })
  }

  try {
    // ── 4. Validar assinatura ativa ────────────────────────────────────────
    const { data: existingSub } = await svc
      .from('company_subscriptions')
      .select('id, status, stripe_subscription_id, plan_id')
      .eq('company_id', effectiveCompanyId)
      .maybeSingle()

    if (!existingSub?.stripe_subscription_id || !ACTIVE_SUB_STATUS.has(existingSub.status)) {
      return res.status(400).json({
        error: 'no_active_subscription',
        hint:  'Use POST /api/stripe/plans/checkout para iniciar uma nova assinatura',
      })
    }

    const subscriptionId = existingSub.stripe_subscription_id

    // ── 5. Validar plano destino ────────────────────────────────────────────
    const { data: targetPlan } = await svc
      .from('plans')
      .select('id, name, slug, sort_order, stripe_price_id_monthly')
      .eq('id', to_plan_id)
      .eq('is_active', true)
      .eq('is_publicly_listed', true)
      .maybeSingle()

    if (!targetPlan) {
      return res.status(400).json({ error: 'plan_not_available' })
    }
    if (!targetPlan.stripe_price_id_monthly) {
      return res.status(400).json({ error: 'plan_not_stripe_purchasable' })
    }

    // ── 6. Buscar subscription no Stripe (para item ID e price atual) ───────
    const stripe    = getStripe()
    const stripeSub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price'],
    })

    const subItem       = stripeSub.items.data[0]
    const subItemId     = subItem?.id
    const currentPriceId = subItem?.price?.id

    if (!subItemId) {
      return res.status(500).json({ error: 'Assinatura Stripe sem itens ativos' })
    }

    // Mesmo plano (via price_id do Stripe — source of truth)
    if (currentPriceId === targetPlan.stripe_price_id_monthly) {
      return res.status(400).json({ error: 'already_on_this_plan' })
    }

    // ── 7. Identificar tipo: upgrade ou downgrade via sort_order ───────────
    const { data: currentPlan } = await svc
      .from('companies')
      .select('plan_id, plans!companies_plan_id_fkey(sort_order)')
      .eq('id', effectiveCompanyId)
      .maybeSingle()

    const currentSortOrder = currentPlan?.plans?.sort_order ?? 0
    const isUpgrade        = targetPlan.sort_order > currentSortOrder
    const changeType       = isUpgrade ? 'upgrade' : 'downgrade'

    // ── 8. Atualizar assinatura no Stripe ──────────────────────────────────
    //
    // Upgrade:   proration_behavior = 'create_prorations'
    //            → cobra diferença imediatamente, plano aplicado via webhook
    //
    // Downgrade: proration_behavior = 'none'
    //            → sem reembolso, novo preço na próxima renovação
    //            → plano aplicado via webhook (customer.subscription.updated)

    await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [{ id: subItemId, price: targetPlan.stripe_price_id_monthly }],
        proration_behavior: isUpgrade ? 'create_prorations' : 'none',
        metadata: {
          company_id: effectiveCompanyId,
          to_plan_id,
        },
      },
      { idempotencyKey: idempotencyKeyFor(effectiveCompanyId, to_plan_id) }
    )

    // ── 9. Registrar PCR para auditoria ────────────────────────────────────
    // Não bloqueia a resposta — auditoria é complementar, não operacional
    const fromPlanId = currentPlan?.plan_id ?? existingSub.plan_id ?? null
    const { error: pcrError } = await svc
      .from('plan_change_requests')
      .insert({
        company_id:   effectiveCompanyId,
        from_plan_id: fromPlanId,
        to_plan_id,
        requested_by: userId,
        status:       'pending',
        origin:       'self_service',
      })

    if (pcrError && pcrError.code !== '23505') {
      // Log apenas — não interrompe o fluxo (a mudança no Stripe já foi feita)
      console.warn('[POST /api/stripe/plans/change] Erro ao criar PCR:', pcrError.message)
    }

    console.log('[POST /api/stripe/plans/change] Sucesso | company:', effectiveCompanyId,
      '| plan:', targetPlan.slug, '| type:', changeType)

    // ── 10. Resposta ───────────────────────────────────────────────────────
    // NÃO aplicar plano aqui — toda mudança operacional vem do webhook
    return res.status(200).json({ success: true, type: changeType })

  } catch (err) {
    if (err.type?.startsWith('Stripe')) {
      console.error('[POST /api/stripe/plans/change] Stripe error:', err.message, {
        type: err.type, code: err.code, company: effectiveCompanyId,
      })
      return res.status(502).json({ error: 'Erro ao comunicar com Stripe. Tente novamente.' })
    }

    console.error('[POST /api/stripe/plans/change] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao processar alteração de plano' })
  }
}
