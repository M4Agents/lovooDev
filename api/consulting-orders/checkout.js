// =============================================================================
// POST /api/consulting-orders/checkout
//
// Inicia a compra de um pacote consultivo via Stripe Checkout Session.
//
// BODY (JSON):
//   { "package_id": "<uuid>" }
//
// QUERY PARAM:
//   ?company_id=<uuid>  — obrigatório para super_admin/system_admin atuando em filha
//
// RESPOSTA (200):
//   { "ok": true, "checkout_url": "https://checkout.stripe.com/..." }
//
// ERROS:
//   400 package_id ausente ou inválido
//   403 role sem permissão (partner, manager, seller)
//   404 pacote não encontrado ou indisponível para venda
//   500 erro interno ou Stripe
//
// SEGURANÇA:
//   - company_id NUNCA aceito do body — sempre da sessão autenticada
//   - Todos os valores (horas, preço, bônus) lidos do banco — nunca do frontend
//   - stripe_customer_id nunca retornado ao frontend
//   - Roles permitidos: admin (própria empresa), super_admin/system_admin (qualquer client)
//   - Dedup por status real da sessão Stripe (não janela de tempo)
//   - metadata.type = 'consulting_purchase' para roteamento do webhook
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'
import { getStripe }             from '../lib/stripe/client.js'

const ALLOWED_ROLES = new Set(['admin', 'super_admin', 'system_admin'])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── 1. Parsear body ────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ ok: false, error: 'Body inválido' })
  }

  const { package_id } = body

  if (!package_id || typeof package_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'package_id é obrigatório' })
  }

  // ── 2. Auth + contexto multi-tenant ───────────────────────────────────────
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, effectiveCompanyId, userId } = ctx

  // ── 3. Verificar role do usuário ───────────────────────────────────────────
  const { data: membership } = await svc
    .from('company_users')
    .select('role')
    .eq('company_id', effectiveCompanyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  let effectiveRole = membership?.role ?? null

  if (!effectiveRole || !ALLOWED_ROLES.has(effectiveRole)) {
    const { data: anyMembership } = await svc
      .from('company_users')
      .select('role')
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('role', ['super_admin', 'system_admin'])
      .limit(1)
      .maybeSingle()

    effectiveRole = anyMembership?.role ?? null
  }

  if (!effectiveRole || !ALLOWED_ROLES.has(effectiveRole)) {
    return res.status(403).json({
      ok:    false,
      error: 'Acesso restrito a administradores. partner, manager e seller não podem comprar pacotes consultivos.',
    })
  }

  try {
    const stripe     = getStripe()
    const appBaseUrl = process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com'

    // ── 4. Validar pacote consultivo ───────────────────────────────────────────
    // Todos os valores lidos do banco — nunca do frontend
    const { data: pkg, error: pkgError } = await svc
      .from('consulting_packages')
      .select(`
        id,
        name,
        package_type,
        hours,
        price,
        bonus_credit_package_id,
        bonus_credit:bonus_credit_package_id (
          id, name, credits
        )
      `)
      .eq('id', package_id)
      .eq('is_active', true)
      .eq('is_available_for_sale', true)
      .maybeSingle()

    if (pkgError) {
      console.error('[consulting/checkout] Erro ao buscar pacote:', pkgError.message)
      return res.status(500).json({ ok: false, error: 'Erro ao validar pacote' })
    }

    if (!pkg) {
      return res.status(404).json({ ok: false, error: 'Pacote não encontrado ou indisponível para compra' })
    }

    // ── 5. Dedup — reutilizar sessão Stripe se ainda estiver aberta ───────────
    const { data: existingOrder, error: dupError } = await svc
      .from('consulting_orders')
      .select('id, stripe_session_id')
      .eq('company_id', effectiveCompanyId)
      .eq('consulting_package_id', package_id)
      .eq('status', 'checkout_created')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (dupError) {
      console.error('[consulting/checkout] Erro ao verificar pedidos existentes:', dupError.message)
      return res.status(500).json({ ok: false, error: 'Erro ao verificar pedidos existentes' })
    }

    if (existingOrder?.stripe_session_id) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(existingOrder.stripe_session_id)

        if (existingSession.status === 'open') {
          console.log('[consulting/checkout] Sessão reutilizada:', {
            company_id:          effectiveCompanyId,
            consulting_order_id: existingOrder.id,
            stripe_session:      existingOrder.stripe_session_id,
          })
          return res.status(200).json({ ok: true, checkout_url: existingSession.url })
        }

        await svc
          .from('consulting_orders')
          .update({ status: 'expired' })
          .eq('id', existingOrder.id)

        console.log('[consulting/checkout] Order expirada, criando novo checkout:', existingOrder.id)
      } catch (stripeErr) {
        console.warn('[consulting/checkout] Não foi possível verificar sessão existente:', stripeErr.message)
      }
    }

    // ── 6. Stripe customer: buscar ou criar ───────────────────────────────────
    const { data: company, error: companyError } = await svc
      .from('companies')
      .select('id, name, stripe_customer_id')
      .eq('id', effectiveCompanyId)
      .single()

    if (companyError || !company) {
      return res.status(500).json({ ok: false, error: 'Erro ao carregar dados da empresa' })
    }

    let stripeCustomerId = company.stripe_customer_id

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          name:     company.name,
          metadata: { company_id: effectiveCompanyId, origin: 'lovoo_crm' },
        },
        { idempotencyKey: `customer-create-${effectiveCompanyId}` }
      )

      stripeCustomerId = customer.id

      await svc
        .from('companies')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', effectiveCompanyId)
    }

    // ── 7. Snapshots completos do pacote e do bônus ───────────────────────────
    const bonusPkg              = Array.isArray(pkg.bonus_credit) ? pkg.bonus_credit[0] : pkg.bonus_credit
    const bonusCreditPackageId  = bonusPkg?.id   ?? null
    const bonusCredits          = bonusPkg?.credits ?? null
    const bonusCreditName       = bonusPkg?.name ?? null

    // ── 8. Inserir consulting_order com snapshot completo ─────────────────────
    const { data: order, error: insertError } = await svc
      .from('consulting_orders')
      .insert({
        company_id:                       effectiveCompanyId,
        consulting_package_id:            pkg.id,
        hours_snapshot:                   pkg.hours,
        price_snapshot:                   pkg.price,
        package_name_snapshot:            pkg.name,
        package_type_snapshot:            pkg.package_type,
        bonus_credit_package_id_snapshot: bonusCreditPackageId,
        bonus_credits_snapshot:           bonusCredits,
        bonus_credit_name_snapshot:       bonusCreditName,
        status:                           'checkout_created',
        requested_by:                     userId,
        metadata: {
          currency:           'BRL',
          stripe_customer_id: stripeCustomerId,
        },
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[consulting/checkout] Erro ao inserir consulting_order:', insertError.message)
      return res.status(500).json({ ok: false, error: 'Erro ao registrar pedido' })
    }

    // ── 9. Criar Stripe Checkout Session ──────────────────────────────────────
    // mode=payment (pagamento único — sem assinatura)
    // price_data dinâmico com snapshot de nome e preço
    // metadata.type='consulting_purchase' para roteamento no webhook
    const successUrl = `${appBaseUrl}/settings?tab=planos-uso&consulting=success&session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl  = `${appBaseUrl}/settings?tab=planos-uso&consulting=cancelled`

    const hoursLabel = Number(pkg.hours) === Math.floor(Number(pkg.hours))
      ? `${pkg.hours}h`
      : `${pkg.hours}h`

    const bonusLabel = bonusCredits ? ` + ${bonusCredits} créditos de IA` : ''

    const session = await stripe.checkout.sessions.create({
      mode:     'payment',
      customer: stripeCustomerId,

      line_items: [
        {
          quantity:   1,
          price_data: {
            currency:     'brl',
            unit_amount:  Math.round(Number(pkg.price) * 100),
            product_data: {
              name:        `${pkg.name} — ${hoursLabel}${bonusLabel}`,
              description: `Pacote consultivo de ${hoursLabel} de ${pkg.package_type}${bonusLabel}`,
            },
          },
        },
      ],

      // Parcelamento no cartão — habilitado quando disponível para o cartão/bandeira.
      // O Stripe exibe as opções de parcelas automaticamente na página de checkout.
      // Pix e outros métodos não são afetados por esta configuração.
      // Se o cartão não suportar parcelamento, o checkout continua normalmente.
      payment_method_options: {
        card: {
          installments: {
            enabled: true,
          },
        },
      },

      metadata: {
        type:                 'consulting_purchase',
        company_id:           effectiveCompanyId,
        consulting_order_id:  order.id,
        package_id:           pkg.id,
      },

      success_url: successUrl,
      cancel_url:  cancelUrl,
    })

    // ── 10. Persistir stripe_session_id na order ──────────────────────────────
    await svc
      .from('consulting_orders')
      .update({ stripe_session_id: session.id })
      .eq('id', order.id)

    console.log('[consulting/checkout] Sessão criada:', {
      company_id:          effectiveCompanyId,
      consulting_order_id: order.id,
      stripe_session:      session.id,
    })

    return res.status(200).json({ ok: true, checkout_url: session.url })

  } catch (err) {
    console.error('[consulting/checkout] Erro inesperado:', err.message)
    return res.status(500).json({ ok: false, error: 'Erro interno ao iniciar checkout' })
  }
}
