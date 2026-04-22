// =============================================================================
// api/lib/stripe/planWebhookHandler.js
//
// Orquestrador de eventos Stripe relacionados a billing de planos.
//
// RESPONSABILIDADE:
//   - Rotear eventos para handlers específicos
//   - Garantir idempotência via sync_subscription_billing_state
//   - Aplicar mudanças de plano apenas via apply_operational_plan_change
//   - Nunca modificar companies.plan_id diretamente
//
// REGRAS DE APLICAÇÃO OPERACIONAL:
//   ✅ customer.subscription.created (status: active | trialing)
//   ✅ customer.subscription.updated (price_id changed + status valid)
//   ✅ invoice.paid (sempre tenta aplicar — idempotente)
//   ✅ customer.subscription.deleted → aplica plano "suspended"
//   ❌ checkout.session.completed → apenas sync
//   ❌ invoice.payment_failed / payment_action_required → apenas sync
//
// SEGURANÇA:
//   - Toda ação usa service_role (sem auth de usuário — webhook não tem sessão)
//   - company_id extraído APENAS do evento Stripe, nunca do frontend
//   - Idempotência garantida por event.id via sync RPC
// =============================================================================

import { getServiceSupabase } from '../credits/authContext.js'
import { getStripe }           from './client.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const VALID_OPERATIONAL_STATUSES = ['active', 'trialing']

// ── Helpers de resolução ──────────────────────────────────────────────────────

/**
 * Extrai o ciclo de cobrança ('monthly' | 'yearly' | null) a partir de um
 * objeto Subscription do Stripe. Baseia-se no recurring.interval do primeiro item.
 */
function extractBillingCycle(sub) {
  const interval = sub?.items?.data?.[0]?.price?.recurring?.interval
  if (interval === 'month') return 'monthly'
  if (interval === 'year')  return 'yearly'
  return null
}

/**
 * Extrai company_id de um evento Stripe.
 * Tenta: metadata → client_reference_id → lookup por customer_id no banco.
 */
async function extractCompanyId(svc, obj) {
  // metadata (subscription, session)
  const fromMeta = obj?.metadata?.company_id
  if (fromMeta) return fromMeta

  // checkout session: client_reference_id
  const fromRef = obj?.client_reference_id
  if (fromRef) return fromRef

  // fallback: busca company pelo stripe_customer_id
  const customerId = obj?.customer
  if (!customerId) return null

  const { data } = await svc
    .from('companies')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  return data?.id ?? null
}

/**
 * Resolve plano pelo stripe_price_id_monthly.
 * Retorna o UUID do plano ou null se não encontrado.
 */
async function resolvePlanByPriceId(svc, priceId) {
  if (!priceId) return null

  const { data } = await svc
    .from('plans')
    .select('id, name, slug')
    .eq('stripe_price_id_monthly', priceId)
    .maybeSingle()

  return data ?? null
}

/**
 * Retorna o UUID do plano "suspended".
 * Retorna null se o plano não existir (erro de configuração).
 */
async function resolveSuspendedPlan(svc) {
  const { data } = await svc
    .from('plans')
    .select('id')
    .eq('slug', 'suspended')
    .maybeSingle()

  return data?.id ?? null
}

/**
 * Retorna o plan_id atual da empresa.
 */
async function getCompanyPlanId(svc, companyId) {
  const { data } = await svc
    .from('companies')
    .select('plan_id')
    .eq('id', companyId)
    .maybeSingle()

  return data?.plan_id ?? null
}

/**
 * Busca o PCR pendente mais recente para a empresa.
 * Usado para fechar o PCR quando o plano é ativado com sucesso.
 */
async function findPendingPcr(svc, companyId) {
  const { data } = await svc
    .from('plan_change_requests')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.id ?? null
}

// ── Chamadas de RPC ───────────────────────────────────────────────────────────

/**
 * Chama sync_subscription_billing_state para manter company_subscriptions
 * consistente com o estado real do Stripe. Sempre chamada antes de qualquer
 * decisão operacional.
 *
 * @returns {boolean} true se o evento já foi processado (already_applied)
 */
async function syncContractual(svc, params) {
  const { data, error } = await svc.rpc('sync_subscription_billing_state', params)

  if (error) {
    console.error('[planWebhook] sync_subscription_billing_state falhou:', error)
    throw error
  }

  const result = data?.[0] ?? data
  return result?.already_applied === true
}

/**
 * Chama apply_operational_plan_change para atualizar companies.plan_id.
 * Idempotente: retorna already_applied=true se plano já está aplicado.
 */
async function applyOperational(svc, companyId, planId, pcrId, eventId) {
  const { data, error } = await svc.rpc('apply_operational_plan_change', {
    p_company_id:             companyId,
    p_to_plan_id:             planId,
    p_plan_change_request_id: pcrId   ?? null,
    p_stripe_event_id:        eventId ?? null,
  })

  if (error) {
    console.error('[planWebhook] apply_operational_plan_change falhou:', error)
    throw error
  }

  const result = data?.[0] ?? data
  return result?.already_applied === true
}

// ── Handlers por evento ───────────────────────────────────────────────────────

async function handleCheckoutSessionExpired(stripe, svc, event) {
  const session   = event.data.object
  const companyId = session.client_reference_id ?? session.metadata?.company_id

  if (!companyId) {
    console.warn('[planWebhook] checkout.session.expired sem company_id', event.id)
    return
  }

  // Cancelar o PCR pendente vinculado a esta sessão expirada
  const { data: pcr } = await svc
    .from('plan_change_requests')
    .update({ status: 'cancelled' })
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .eq('stripe_checkout_session_id', session.id)
    .select('id')
    .maybeSingle()

  console.log('[planWebhook] checkout.session.expired | company:', companyId,
    '| session:', session.id, '| pcr_cancelado:', pcr?.id ?? 'nenhum')
}

async function handleCheckoutSessionCompleted(stripe, svc, event) {
  const session      = event.data.object
  const companyId    = session.client_reference_id ?? session.metadata?.company_id
  const subscriptionId = session.subscription

  if (!companyId || !subscriptionId) {
    console.warn('[planWebhook] checkout.session.completed sem company_id ou subscription_id', event.id)
    return
  }

  const sub      = await stripe.subscriptions.retrieve(subscriptionId)
  const priceId  = sub.items?.data?.[0]?.price?.id ?? null

  const alreadyApplied = await syncContractual(svc, {
    p_company_id:             companyId,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_price_id:        priceId,
    p_status:                 sub.status,
    p_current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    p_current_period_end:     new Date(sub.current_period_end   * 1000).toISOString(),
    p_cancel_at_period_end:   sub.cancel_at_period_end ?? false,
    p_billing_cycle:          extractBillingCycle(sub),
    p_trial_start:            sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
    p_trial_end:              sub.trial_end   ? new Date(sub.trial_end   * 1000).toISOString() : null,
    p_canceled_at:            null,
    p_scheduled_plan_id:      null,
    p_plan_id:                null,
    p_stripe_event_id:        event.id,
  })

  console.log('[planWebhook] checkout.session.completed | company:', companyId,
    '| sub:', subscriptionId, '| action: sync only | skipped:', alreadyApplied)
}

async function handleSubscriptionCreated(stripe, svc, event) {
  const sub       = event.data.object
  const companyId = await extractCompanyId(svc, sub)
  if (!companyId) {
    console.warn('[planWebhook] subscription.created sem company_id', event.id)
    return
  }

  const priceId   = sub.items?.data?.[0]?.price?.id ?? null
  const plan      = await resolvePlanByPriceId(svc, priceId)

  const alreadyApplied = await syncContractual(svc, {
    p_company_id:             companyId,
    p_stripe_subscription_id: sub.id,
    p_stripe_price_id:        priceId,
    p_status:                 sub.status,
    p_current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    p_current_period_end:     new Date(sub.current_period_end   * 1000).toISOString(),
    p_cancel_at_period_end:   sub.cancel_at_period_end ?? false,
    p_billing_cycle:          extractBillingCycle(sub),
    p_trial_start:            sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
    p_trial_end:              sub.trial_end   ? new Date(sub.trial_end   * 1000).toISOString() : null,
    p_canceled_at:            null,
    p_scheduled_plan_id:      null,
    p_plan_id:                plan?.id ?? null,
    p_stripe_event_id:        event.id,
  })

  let action = 'sync only'
  if (!alreadyApplied && plan && VALID_OPERATIONAL_STATUSES.includes(sub.status)) {
    const pcrId    = await findPendingPcr(svc, companyId)
    const skipped  = await applyOperational(svc, companyId, plan.id, pcrId, event.id)
    action = skipped ? 'plan already applied' : `plan applied: ${plan.slug}`
  } else if (!plan) {
    action = 'sync only (price_id não mapeado)'
  } else if (!VALID_OPERATIONAL_STATUSES.includes(sub.status)) {
    action = `sync only (status: ${sub.status})`
  }

  console.log('[planWebhook] subscription.created | company:', companyId,
    '| price:', priceId, '| status:', sub.status, '| action:', action)
}

async function handleSubscriptionUpdated(stripe, svc, event) {
  const sub           = event.data.object
  const companyId     = await extractCompanyId(svc, sub)
  if (!companyId) {
    console.warn('[planWebhook] subscription.updated sem company_id', event.id)
    return
  }

  const newPriceId = sub.items?.data?.[0]?.price?.id ?? null
  const plan       = await resolvePlanByPriceId(svc, newPriceId)

  // Detecta se o price_id mudou comparando com o que está armazenado
  const { data: stored } = await svc
    .from('company_subscriptions')
    .select('stripe_price_id')
    .eq('company_id', companyId)
    .maybeSingle()

  const priceChanged = newPriceId && stored?.stripe_price_id && newPriceId !== stored.stripe_price_id

  const alreadyApplied = await syncContractual(svc, {
    p_company_id:             companyId,
    p_stripe_subscription_id: sub.id,
    p_stripe_price_id:        newPriceId,
    p_status:                 sub.status,
    p_current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    p_current_period_end:     new Date(sub.current_period_end   * 1000).toISOString(),
    p_cancel_at_period_end:   sub.cancel_at_period_end ?? false,
    p_billing_cycle:          extractBillingCycle(sub),
    p_trial_start:            sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
    p_trial_end:              sub.trial_end   ? new Date(sub.trial_end   * 1000).toISOString() : null,
    p_canceled_at:            null,
    p_scheduled_plan_id:      null,
    p_plan_id:                plan?.id ?? null,
    p_stripe_event_id:        event.id,
  })

  let action = 'sync only'
  if (!alreadyApplied && priceChanged && plan && VALID_OPERATIONAL_STATUSES.includes(sub.status)) {
    const pcrId   = await findPendingPcr(svc, companyId)
    const skipped = await applyOperational(svc, companyId, plan.id, pcrId, event.id)
    action = skipped ? 'plan already applied' : `plan applied: ${plan.slug}`
  } else if (sub.cancel_at_period_end) {
    action = 'sync only (cancel_at_period_end — sem mudança de plano)'
  }

  console.log('[planWebhook] subscription.updated | company:', companyId,
    '| price:', newPriceId, '| status:', sub.status, '| priceChanged:', priceChanged,
    '| action:', action)
}

async function handleSubscriptionDeleted(stripe, svc, event) {
  const sub        = event.data.object
  const companyId  = await extractCompanyId(svc, sub)
  if (!companyId) {
    console.warn('[planWebhook] subscription.deleted sem company_id', event.id)
    return
  }

  const canceledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : new Date().toISOString()

  await syncContractual(svc, {
    p_company_id:             companyId,
    p_stripe_subscription_id: sub.id,
    p_stripe_price_id:        sub.items?.data?.[0]?.price?.id ?? null,
    p_status:                 'canceled',
    p_current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    p_current_period_end:     new Date(sub.current_period_end   * 1000).toISOString(),
    p_cancel_at_period_end:   false,
    p_billing_cycle:          null,
    p_trial_start:            null,
    p_trial_end:              null,
    p_canceled_at:            canceledAt,
    p_scheduled_plan_id:      null,
    p_plan_id:                null,
    p_stripe_event_id:        event.id,
  })

  const suspendedPlanId = await resolveSuspendedPlan(svc)
  if (!suspendedPlanId) {
    console.error('[planWebhook] subscription.deleted | plano "suspended" não encontrado. '
      + 'Execute a migration 20260502200001. company_id:', companyId)
    return
  }

  const skipped = await applyOperational(svc, companyId, suspendedPlanId, null, event.id)
  console.log('[planWebhook] subscription.deleted | company:', companyId,
    '| action:', skipped ? 'already suspended' : 'plan applied: suspended')
}

async function handleInvoicePaid(stripe, svc, event) {
  const invoice      = event.data.object
  const subscriptionId = invoice.subscription
  if (!subscriptionId) {
    console.log('[planWebhook] invoice.paid sem subscription (one-time charge), ignorado', event.id)
    return
  }

  // Busca subscription atualizada para obter price_id real (não confiar apenas no invoice)
  const sub        = await stripe.subscriptions.retrieve(subscriptionId)
  const companyId  = await extractCompanyId(svc, sub)
  if (!companyId) {
    console.warn('[planWebhook] invoice.paid sem company_id', event.id)
    return
  }

  const priceId     = sub.items?.data?.[0]?.price?.id ?? null
  const plan        = await resolvePlanByPriceId(svc, priceId)

  const alreadyApplied = await syncContractual(svc, {
    p_company_id:             companyId,
    p_stripe_subscription_id: sub.id,
    p_stripe_price_id:        priceId,
    p_status:                 sub.status,
    p_current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    p_current_period_end:     new Date(sub.current_period_end   * 1000).toISOString(),
    p_cancel_at_period_end:   sub.cancel_at_period_end ?? false,
    p_billing_cycle:          extractBillingCycle(sub),
    p_trial_start:            sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
    p_trial_end:              sub.trial_end   ? new Date(sub.trial_end   * 1000).toISOString() : null,
    p_canceled_at:            null,
    p_scheduled_plan_id:      null, // limpa downgrade agendado — o novo price_id já resolve
    p_plan_id:                plan?.id ?? null,
    p_stripe_event_id:        event.id,
  })

  let action = 'sync only'
  if (!alreadyApplied && plan) {
    const currentPlanId = await getCompanyPlanId(svc, companyId)
    if (plan.id !== currentPlanId) {
      const pcrId   = await findPendingPcr(svc, companyId)
      const skipped = await applyOperational(svc, companyId, plan.id, pcrId, event.id)
      action = skipped ? 'plan already applied' : `plan applied: ${plan.slug}`
    } else {
      action = 'sync only (renewal — plano não mudou)'
    }
  } else if (!plan) {
    action = 'sync only (price_id não mapeado para nenhum plano)'
  }

  console.log('[planWebhook] invoice.paid | company:', companyId,
    '| sub:', subscriptionId, '| price:', priceId, '| action:', action)
}

async function handleInvoicePaymentFailed(stripe, svc, event) {
  const invoice      = event.data.object
  const subscriptionId = invoice.subscription
  if (!subscriptionId) return

  const sub       = await stripe.subscriptions.retrieve(subscriptionId)
  const companyId = await extractCompanyId(svc, sub)
  if (!companyId) {
    console.warn('[planWebhook] invoice.payment_failed sem company_id', event.id)
    return
  }

  // Apenas sync — plano não é alterado em caso de falha de pagamento
  await syncContractual(svc, {
    p_company_id:             companyId,
    p_stripe_subscription_id: sub.id,
    p_stripe_price_id:        sub.items?.data?.[0]?.price?.id ?? null,
    p_status:                 sub.status,
    p_current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    p_current_period_end:     new Date(sub.current_period_end   * 1000).toISOString(),
    p_cancel_at_period_end:   sub.cancel_at_period_end ?? false,
    p_billing_cycle:          extractBillingCycle(sub),
    p_trial_start:            null,
    p_trial_end:              null,
    p_canceled_at:            null,
    p_scheduled_plan_id:      null,
    p_plan_id:                null,
    p_stripe_event_id:        event.id,
  })

  console.log('[planWebhook] invoice.payment_failed | company:', companyId,
    '| sub:', subscriptionId, '| action: sync only (sem mudança de plano)')
}

async function handleInvoicePaymentActionRequired(stripe, svc, event) {
  const invoice        = event.data.object
  const subscriptionId = invoice.subscription
  if (!subscriptionId) return

  const sub       = await stripe.subscriptions.retrieve(subscriptionId)
  const companyId = await extractCompanyId(svc, sub)
  if (!companyId) {
    console.warn('[planWebhook] invoice.payment_action_required sem company_id', event.id)
    return
  }

  // Apenas sync — plano não é alterado; apenas status contratual é atualizado
  await syncContractual(svc, {
    p_company_id:             companyId,
    p_stripe_subscription_id: sub.id,
    p_stripe_price_id:        sub.items?.data?.[0]?.price?.id ?? null,
    p_status:                 sub.status,
    p_current_period_start:   new Date(sub.current_period_start * 1000).toISOString(),
    p_current_period_end:     new Date(sub.current_period_end   * 1000).toISOString(),
    p_cancel_at_period_end:   sub.cancel_at_period_end ?? false,
    p_billing_cycle:          extractBillingCycle(sub),
    p_trial_start:            null,
    p_trial_end:              null,
    p_canceled_at:            null,
    p_scheduled_plan_id:      null,
    p_plan_id:                null,
    p_stripe_event_id:        event.id,
  })

  // Persiste a URL de pagamento para o frontend redirecionar o usuário
  if (invoice.hosted_invoice_url) {
    await svc
      .from('company_subscriptions')
      .update({ last_invoice_url: invoice.hosted_invoice_url })
      .eq('company_id', companyId)
  }

  console.log('[planWebhook] invoice.payment_action_required | company:', companyId,
    '| sub:', subscriptionId, '| invoice_url salva:', !!invoice.hosted_invoice_url,
    '| action: sync only (sem mudança de plano)')
}

// ── Dispatcher principal ──────────────────────────────────────────────────────

/**
 * Ponto de entrada para todos os eventos Stripe relacionados a billing.
 * Chamado pelo endpoint POST /api/stripe/webhook após validação de assinatura.
 */
export async function handlePlanEvent(event) {
  const stripe = getStripe()
  const svc    = getServiceSupabase()

  switch (event.type) {
    case 'checkout.session.expired':
      return handleCheckoutSessionExpired(stripe, svc, event)

    case 'checkout.session.completed':
      return handleCheckoutSessionCompleted(stripe, svc, event)

    case 'customer.subscription.created':
      return handleSubscriptionCreated(stripe, svc, event)

    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(stripe, svc, event)

    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(stripe, svc, event)

    case 'invoice.paid':
      return handleInvoicePaid(stripe, svc, event)

    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(stripe, svc, event)

    case 'invoice.payment_action_required':
      return handleInvoicePaymentActionRequired(stripe, svc, event)

    default:
      console.log('[planWebhook] Evento não tratado:', event.type, '|', event.id)
  }
}
