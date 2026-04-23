// =============================================================================
// api/lib/stripe/consultingWebhookHandler.js
//
// Handler de eventos Stripe relacionados à compra de pacotes consultivos.
//
// RESPONSABILIDADE:
//   - Processar eventos de checkout com metadata.type === 'consulting_purchase'
//   - Liberar horas e bônus SOMENTE quando pagamento efetivamente confirmado
//   - Garantir idempotência via RPC confirm_consulting_order_payment (FOR UPDATE + status)
//   - Emitir logs estruturados para auditoria e suporte
//
// EVENTOS TRATADOS:
//   checkout.session.completed  (payment_status=paid)   → liberar horas + bônus
//   checkout.session.completed  (payment_status!=paid)  → aguardar async (Pix pendente)
//   checkout.session.async_payment_succeeded             → liberar horas + bônus (Pix)
//   checkout.session.async_payment_failed                → marcar failed
//   checkout.session.expired                             → marcar expired
//
// SEGURANÇA:
//   - Usa service_role — webhook não tem sessão de usuário
//   - company_id e consulting_order_id extraídos do metadata do evento Stripe
//   - Nunca aceita valores do frontend para decisões financeiras
//   - RPC confirm_consulting_order_payment é idempotente e transacional (FOR UPDATE)
// =============================================================================

import { getServiceSupabase } from '../credits/authContext.js'

// ── Logger estruturado ────────────────────────────────────────────────────────

function logConsulting(action, event, session, extra = {}) {
  console.log(JSON.stringify({
    handler:             'consultingWebhookHandler',
    action,
    event_id:            event.id,
    event_type:          event.type,
    company_id:          session?.metadata?.company_id          ?? null,
    consulting_order_id: session?.metadata?.consulting_order_id ?? null,
    stripe_session:      session?.id          ?? null,
    payment_status:      session?.payment_status ?? null,
    ...extra,
    ts: new Date().toISOString(),
  }))
}

// ── Atualizar status de uma consulting_order ──────────────────────────────────

async function updateOrderStatus(svc, orderId, status) {
  const { error } = await svc
    .from('consulting_orders')
    .update({ status })
    .eq('id', orderId)

  if (error) {
    console.error('[consultingWebhook] Falha ao atualizar status da order:', { orderId, status, error: error.message })
  }
}

// ── Fulfillment: liberar horas + bônus ───────────────────────────────────────

async function handleConsultingCheckoutPaid(event, session) {
  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[consultingWebhook] service_role não configurado')
    throw new Error('Configuração de servidor incompleta')
  }

  const orderId  = session.metadata?.consulting_order_id
  const paymentIntent = session.payment_intent ?? null

  if (!orderId) {
    console.error('[consultingWebhook] consulting_order_id ausente no metadata:', session.id)
    throw new Error('consulting_order_id ausente no metadata da sessão Stripe')
  }

  logConsulting('fulfillment_started', event, session, { payment_intent: paymentIntent })

  // Persistir stripe_payment_intent (idempotência de webhook)
  if (paymentIntent) {
    await svc
      .from('consulting_orders')
      .update({ stripe_payment_intent: paymentIntent })
      .eq('id', orderId)
      .is('stripe_payment_intent', null) // só atualiza se ainda NULL (evita conflito UNIQUE)
  }

  // Verificar se já pago antes de chamar a RPC (leitura rápida — RPC é idempotente de qualquer forma)
  const { data: order } = await svc
    .from('consulting_orders')
    .select('status')
    .eq('id', orderId)
    .single()

  if (order?.status === 'paid') {
    logConsulting('fulfillment_skipped_already_paid', event, session)
    return
  }

  // Chamar RPC de fulfillment (atômica e idempotente)
  const { data: result, error: rpcError } = await svc.rpc('confirm_consulting_order_payment', {
    p_order_id: orderId,
  })

  if (rpcError) {
    logConsulting('fulfillment_rpc_error', event, session, { rpc_error: rpcError.message })
    throw new Error(`RPC confirm_consulting_order_payment falhou: ${rpcError.message}`)
  }

  if (result?.already_paid) {
    logConsulting('fulfillment_idempotent_already_paid', event, session)
    return
  }

  if (!result?.success) {
    logConsulting('fulfillment_rpc_failed', event, session, { rpc_result: result })
    throw new Error(`confirm_consulting_order_payment retornou falha: ${result?.error ?? 'unknown'}`)
  }

  logConsulting('fulfillment_success', event, session, {
    minutes_credited: result.minutes_credited,
    bonus_credits:    result.bonus_credits,
  })
}

// ── Handler principal: rotear por tipo de evento ──────────────────────────────

export async function handleConsultingEvent(event) {
  const session = event.data.object

  switch (event.type) {

    case 'checkout.session.completed':
      if (session.payment_status === 'paid') {
        // Pagamento confirmado (cartão)
        await handleConsultingCheckoutPaid(event, session)
      } else {
        // Pix pendente de confirmação — aguardar async_payment_succeeded
        logConsulting('async_pending', event, session, {
          payment_status: session.payment_status,
        })
      }
      break

    case 'checkout.session.async_payment_succeeded':
      // Pix confirmado
      await handleConsultingCheckoutPaid(event, session)
      break

    case 'checkout.session.async_payment_failed': {
      const svc    = getServiceSupabase()
      const orderId = session.metadata?.consulting_order_id
      logConsulting('payment_failed', event, session)
      if (svc && orderId) await updateOrderStatus(svc, orderId, 'failed')
      break
    }

    case 'checkout.session.expired': {
      const svc    = getServiceSupabase()
      const orderId = session.metadata?.consulting_order_id
      logConsulting('session_expired', event, session)
      if (svc && orderId) {
        // Só atualiza se ainda estava em checkout_created (idempotência)
        await svc
          .from('consulting_orders')
          .update({ status: 'expired' })
          .eq('id', orderId)
          .eq('status', 'checkout_created')
      }
      break
    }

    default:
      logConsulting('unhandled_event_type', event, session)
  }
}
