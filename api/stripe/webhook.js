// =============================================================================
// POST /api/stripe/webhook
//
// Endpoint de recebimento de eventos Stripe (billing de planos).
//
// SEGURANÇA:
//   - bodyParser DESATIVADO: rawBody obrigatório para validar assinatura HMAC
//   - Assinatura verificada via stripe.webhooks.constructEvent()
//   - Evento inválido → 400 imediato (fail-closed)
//   - Nenhuma confiança em dados de frontend — tudo vem do payload Stripe
//
// IDEMPOTÊNCIA:
//   - Cada evento possui um ID único (event.id)
//   - O handler verifica via sync_subscription_billing_state se o evento
//     já foi processado antes de executar qualquer ação
//
// RETORNO:
//   - Sempre 200 após processamento bem-sucedido
//   - Stripe faz retry automático se retornar 4xx ou 5xx
//
// VARIÁVEIS DE AMBIENTE OBRIGATÓRIAS:
//   STRIPE_SECRET_KEY       — chave secreta Stripe (sk_live_... ou sk_test_...)
//   STRIPE_WEBHOOK_SECRET   — segredo de assinatura do webhook (whsec_...)
// =============================================================================

import { getStripe }        from '../lib/stripe/client.js'
import { handlePlanEvent }  from '../lib/stripe/planWebhookHandler.js'

// Necessário para receber o rawBody e validar a assinatura Stripe
export const config = { api: { bodyParser: false } }

// ── Leitura do corpo bruto ────────────────────────────────────────────────────

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 1. Ler rawBody antes de qualquer parsing
  let rawBody
  try {
    rawBody = await readRawBody(req)
  } catch (err) {
    console.error('[webhook] Falha ao ler rawBody:', err)
    return res.status(400).json({ error: 'Failed to read request body' })
  }

  // 2. Validar assinatura Stripe (fail-closed)
  const sig    = req.headers['stripe-signature']
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET não configurada')
    return res.status(500).json({ error: 'Webhook secret not configured' })
  }

  let event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(rawBody, sig, secret)
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bf3f9d'},body:JSON.stringify({sessionId:'bf3f9d',location:'api/stripe/webhook.js:71',message:'constructEvent falhou',data:{errMsg:err.message,errType:err.type,sigPresent:!!sig,sigPrefix:sig?.slice(0,20),secretConfigured:!!secret,secretPrefix:secret?.slice(0,8),rawBodyLen:rawBody?.length,hypothesisId:'H-A'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    console.warn('[webhook] Assinatura inválida:', err.message)
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` })
  }

  // 3. Log de recebimento
  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bf3f9d'},body:JSON.stringify({sessionId:'bf3f9d',location:'api/stripe/webhook.js:78',message:'evento recebido com sucesso',data:{type:event.type,id:event.id,apiVersion:event.api_version,hypothesisId:'H-B'},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  console.log('[webhook] Evento recebido | type:', event.type, '| id:', event.id)

  // 4. Processar evento
  try {
    await handlePlanEvent(event)
  } catch (err) {
    // Erro no processamento: retornar 500 para Stripe fazer retry
    console.error('[webhook] Erro ao processar evento:', event.type, event.id, err)
    // #region agent log - debug temporário (remover após diagnóstico)
    return res.status(500).json({
      error: 'Internal error processing event',
      debug: err?.message ?? String(err),
      stack: err?.stack?.split('\n').slice(0, 3).join(' | '),
    })
    // #endregion
  }

  // 5. Confirmar recebimento (sempre 200 após processamento bem-sucedido)
  return res.status(200).json({ received: true, event_id: event.id })
}
