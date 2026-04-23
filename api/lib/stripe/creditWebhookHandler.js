// =============================================================================
// api/lib/stripe/creditWebhookHandler.js
//
// Handler de eventos Stripe relacionados à compra de créditos avulsos de IA.
//
// RESPONSABILIDADE:
//   - Processar eventos de checkout de créditos (metadata.type === 'credit_purchase')
//   - Liberar créditos SOMENTE quando pagamento estiver efetivamente confirmado
//   - Garantir idempotência via RPC confirm_credit_order_payment (FOR UPDATE + status check)
//   - Emitir logs estruturados para auditoria e suporte
//
// EVENTOS TRATADOS:
//   ✅ checkout.session.completed   (payment_status=paid)     → liberar créditos
//   ✅ checkout.session.completed   (payment_status!=paid)    → aguardar async
//   ✅ checkout.session.async_payment_succeeded               → liberar créditos (Pix)
//   ✅ checkout.session.async_payment_failed                  → marcar failed
//   ✅ checkout.session.expired                               → marcar expired
//
// SEGURANÇA:
//   - Usa service_role — webhook não tem sessão de usuário
//   - company_id e credit_order_id extraídos do metadata do evento Stripe
//   - Nunca aceita valores do frontend para decisões financeiras
//   - RPC confirm_credit_order_payment é idempotente e transacional (FOR UPDATE)
// =============================================================================

import { getServiceSupabase } from '../credits/authContext.js'

// ── Logger estruturado ────────────────────────────────────────────────────────

function logCredit(action, event, session, extra = {}) {
  console.log(JSON.stringify({
    handler:         'creditWebhookHandler',
    action,
    event_id:        event.id,
    event_type:      event.type,
    company_id:      session?.metadata?.company_id ?? null,
    credit_order_id: session?.metadata?.credit_order_id ?? null,
    stripe_session:  session?.id ?? null,
    payment_status:  session?.payment_status ?? null,
    ...extra,
  }))
}

// ── Helpers de atualização de status ─────────────────────────────────────────

async function updateOrderStatus(svc, orderId, status, extra = {}) {
  const { error } = await svc
    .from('credit_orders')
    .update({ status, ...extra })
    .eq('id', orderId)

  if (error) {
    console.error('[creditWebhookHandler] Erro ao atualizar status da order:', {
      order_id: orderId,
      status,
      error:    error.message,
    })
  }
}

// ── Função de liberação de créditos ──────────────────────────────────────────

/**
 * Libera créditos para a empresa após confirmação de pagamento.
 * Chamada por completed(paid) e async_payment_succeeded.
 *
 * Idempotência garantida pela RPC (FOR UPDATE + check status = 'paid').
 */
async function handleCreditCheckoutPaid(event, session) {
  const svc = getServiceSupabase()

  const { credit_order_id, company_id } = session.metadata ?? {}

  if (!credit_order_id) {
    console.error('[creditWebhookHandler] credit_order_id ausente no metadata:', {
      event_id:       event.id,
      stripe_session: session.id,
    })
    // Não lançar — evento sem order_id não é retriável; evitar loop de retentativas
    return
  }

  // ── Verificar status atual antes de chamar a RPC ──────────────────────────
  // Camada de defesa no JS antes da RPC (a RPC também verifica, mas logar aqui é útil)
  const { data: order, error: orderError } = await svc
    .from('credit_orders')
    .select('id, status')
    .eq('id', credit_order_id)
    .maybeSingle()

  if (orderError) {
    console.error('[creditWebhookHandler] Erro ao buscar order:', {
      credit_order_id,
      error: orderError.message,
    })
    throw new Error(`Erro ao buscar credit_order ${credit_order_id}: ${orderError.message}`)
  }

  if (!order) {
    console.error('[creditWebhookHandler] Order não encontrada:', { credit_order_id, company_id })
    // Não lançar — order inexistente não é retriável
    return
  }

  if (order.status === 'paid') {
    logCredit('already_paid', event, session, {
      status_before: 'paid',
      status_after:  'paid',
    })
    return
  }

  // ── Persistir stripe_payment_intent antes de chamar a RPC ─────────────────
  if (session.payment_intent) {
    await updateOrderStatus(svc, credit_order_id, order.status, {
      stripe_payment_intent: session.payment_intent,
    })
  }

  // ── Chamar RPC confirm_credit_order_payment ────────────────────────────────
  // Atômica, idempotente, com FOR UPDATE em credit_orders e company_credits
  const { data: rpcResult, error: rpcError } = await svc
    .rpc('confirm_credit_order_payment', { p_order_id: credit_order_id })

  if (rpcError) {
    console.error('[creditWebhookHandler] Erro na RPC:', {
      credit_order_id,
      company_id,
      error: rpcError.message,
    })
    // Lançar para que o Stripe retente o webhook
    throw new Error(`RPC confirm_credit_order_payment falhou: ${rpcError.message}`)
  }

  const result = rpcResult ?? {}

  if (result.already_paid) {
    logCredit('already_paid', event, session, {
      status_before: order.status,
      status_after:  'paid',
    })
    return
  }

  if (!result.success) {
    console.error('[creditWebhookHandler] RPC retornou falha:', {
      credit_order_id,
      company_id,
      rpc_error: result.error,
    })
    // Lançar para que o Stripe retente
    throw new Error(`confirm_credit_order_payment: ${result.error}`)
  }

  logCredit('credits_released', event, session, {
    status_before:  order.status,
    status_after:   'paid',
    credits_added:  result.credits_added,
  })
}

// ── Handler principal ─────────────────────────────────────────────────────────

/**
 * Ponto de entrada para eventos de créditos avulsos.
 * Chamado por webhook.js quando metadata.type === 'credit_purchase'.
 *
 * @param {import('stripe').Stripe.Event} event
 */
export async function handleCreditEvent(event) {
  const session = event.data.object
  const { credit_order_id } = session?.metadata ?? {}

  switch (event.type) {

    // ── checkout.session.completed ────────────────────────────────────────────
    case 'checkout.session.completed': {
      if (session.payment_status === 'paid') {
        // Pagamento síncrono confirmado (cartão) — liberar créditos imediatamente
        await handleCreditCheckoutPaid(event, session)
      } else {
        // Pagamento assíncrono pendente (Pix) — aguardar async_payment_succeeded
        logCredit('async_pending', event, session, {
          status_before: 'checkout_created',
          status_after:  'checkout_created',
        })
      }
      break
    }

    // ── checkout.session.async_payment_succeeded ──────────────────────────────
    case 'checkout.session.async_payment_succeeded': {
      // Pagamento Pix confirmado — liberar créditos
      await handleCreditCheckoutPaid(event, session)
      break
    }

    // ── checkout.session.async_payment_failed ─────────────────────────────────
    case 'checkout.session.async_payment_failed': {
      const svc = getServiceSupabase()

      if (credit_order_id) {
        const { data: order } = await svc
          .from('credit_orders')
          .select('status')
          .eq('id', credit_order_id)
          .maybeSingle()

        await updateOrderStatus(svc, credit_order_id, 'failed')

        logCredit('payment_failed', event, session, {
          status_before: order?.status ?? 'unknown',
          status_after:  'failed',
        })
      } else {
        console.error('[creditWebhookHandler] async_payment_failed sem credit_order_id:', {
          event_id:       event.id,
          stripe_session: session.id,
        })
      }
      break
    }

    // ── checkout.session.expired ──────────────────────────────────────────────
    case 'checkout.session.expired': {
      const svc = getServiceSupabase()

      if (credit_order_id) {
        const { data: order } = await svc
          .from('credit_orders')
          .select('status')
          .eq('id', credit_order_id)
          .maybeSingle()

        // Só marcar como expired se ainda estiver em checkout_created
        if (order && order.status === 'checkout_created') {
          await updateOrderStatus(svc, credit_order_id, 'expired')

          logCredit('expired', event, session, {
            status_before: 'checkout_created',
            status_after:  'expired',
          })
        }
      }
      break
    }

    default:
      console.warn('[creditWebhookHandler] Evento não tratado recebido:', event.type)
  }
}
