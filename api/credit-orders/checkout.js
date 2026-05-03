// =============================================================================
// POST /api/credit-orders/checkout
//
// Inicia a compra de um pacote de créditos avulsos via Stripe Checkout Session.
//
// BODY (JSON):
//   { "package_id": "<uuid>", "analysis_id"?: "<uuid>" }
//
//   analysis_id (opcional):
//     Quando presente, vincula a compra a uma análise de IA com saldo insuficiente.
//     - success_url redireciona para /dashboard?resume_analysis={analysis_id}&credits=success
//     - Dedup é ignorado (sempre sessão nova para garantir success_url correto)
//     - analysis_id incluído no metadata da sessão Stripe e da credit_order
//     - Webhook não é afetado — usa apenas company_id e credit_order_id do metadata
//
// QUERY PARAM:
//   ?company_id=<uuid>  — obrigatório para super_admin/system_admin atuando em filha
//
// RESPOSTA (201):
//   { "ok": true, "checkout_url": "https://checkout.stripe.com/..." }
//
// ERROS:
//   400 package_id ausente ou inválido
//   403 role sem permissão (partner, manager, seller)
//   404 pacote não encontrado ou indisponível
//   500 erro interno ou Stripe
//
// SEGURANÇA:
//   - company_id NUNCA aceito do body — sempre da sessão autenticada
//   - Todos os valores financeiros (credits, price) lidos do banco — nunca do frontend
//   - stripe_customer_id nunca retornado ao frontend
//   - Roles permitidos: admin (própria empresa), super_admin/system_admin (qualquer client)
//   - Dedup por status real da sessão Stripe (não janela de tempo)
//   - Dedup para fluxo Settings exclui sessões criadas via IA (metadata->>'analysis_id' IS NULL)
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'
import { getStripe }             from '../lib/stripe/client.js'

// Roles com permissão para comprar créditos avulsos
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

  const { package_id, analysis_id: rawAnalysisId } = body

  if (!package_id || typeof package_id !== 'string') {
    return res.status(400).json({ ok: false, error: 'package_id é obrigatório' })
  }

  // analysis_id opcional — vincula compra a uma análise IA com saldo insuficiente
  // Validação: deve ser string não-vazia se fornecido
  const analysisId = (typeof rawAnalysisId === 'string' && rawAnalysisId.trim())
    ? rawAnalysisId.trim()
    : null

  // ── 2. Auth + contexto multi-tenant ───────────────────────────────────────
  // effectiveCompanyId vem sempre de resolveCreditsContext — nunca do body
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, effectiveCompanyId, userId } = ctx

  // ── 3. Verificar role do usuário na empresa ────────────────────────────────
  // Role lido de company_users — não do JWT claim, não do body
  const { data: membership, error: membershipError } = await svc
    .from('company_users')
    .select('role')
    .eq('company_id', effectiveCompanyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (membershipError) {
    console.error('[POST /api/credit-orders/checkout] Erro ao buscar membership:', membershipError.message)
    return res.status(500).json({ ok: false, error: 'Erro ao verificar permissões' })
  }

  // Para super_admin/system_admin atuando via ?company_id=, o membership pode estar
  // na empresa pai — buscar o role mais elevado entre todas as memberships ativas do usuário
  let effectiveRole = membership?.role ?? null

  if (!effectiveRole || !ALLOWED_ROLES.has(effectiveRole)) {
    // Fallback: buscar role de qualquer empresa com membership ativa (cobre caso pai→filha)
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
      error: 'Acesso restrito a administradores. partner, manager e seller não podem comprar créditos.',
    })
  }

  try {
    const stripe     = getStripe()
    const appBaseUrl = process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com'

    // ── 4. Validar pacote ──────────────────────────────────────────────────────
    // Todos os valores financeiros lidos do banco — nunca do frontend
    const { data: pkg, error: pkgError } = await svc
      .from('credit_packages')
      .select('id, name, credits, price')
      .eq('id', package_id)
      .eq('is_active', true)
      .eq('is_available_for_sale', true)
      .maybeSingle()

    if (pkgError) {
      console.error('[POST /api/credit-orders/checkout] Erro ao buscar pacote:', pkgError.message)
      return res.status(500).json({ ok: false, error: 'Erro ao validar pacote' })
    }

    if (!pkg) {
      return res.status(404).json({ ok: false, error: 'Pacote não encontrado ou indisponível para compra' })
    }

    // ── 5. Dedup — reutilizar sessão Stripe se ainda estiver aberta ───────────
    // Fonte de verdade: status da sessão no Stripe, não janela de tempo.
    //
    // Regra de isolamento por contexto:
    //   • analysis_id presente → skip dedup (sempre sessão nova).
    //     Motivo: success_url contém analysis_id específico; reutilizar sessão
    //     de outro contexto enviaria o usuário para a análise errada.
    //   • analysis_id ausente (Settings) → dedup normal, mas filtra apenas
    //     sessões também sem analysis_id para não devolver URL de análise IA.
    let existingOrder = null

    if (!analysisId) {
      // Fluxo Settings: buscar sessão aberta para este pacote SEM analysis_id no metadata
      const dupQuery = await svc
        .from('credit_orders')
        .select('id, stripe_session_id')
        .eq('company_id', effectiveCompanyId)
        .eq('package_id', package_id)
        .eq('status', 'checkout_created')
        .filter('metadata->>analysis_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (dupQuery.error) {
        console.error('[POST /api/credit-orders/checkout] Erro ao verificar pedidos existentes:', dupQuery.error.message)
        return res.status(500).json({ ok: false, error: 'Erro ao verificar pedidos existentes' })
      }

      existingOrder = dupQuery.data
    }
    // analysis_id presente: existingOrder permanece null → sempre criará nova sessão

    if (existingOrder?.stripe_session_id) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(existingOrder.stripe_session_id)

        if (existingSession.status === 'open') {
          // Sessão ainda válida — reutilizar sem criar duplicata
          console.log('[POST /api/credit-orders/checkout] Sessão reutilizada:', {
            company_id:      effectiveCompanyId,
            credit_order_id: existingOrder.id,
            stripe_session:  existingOrder.stripe_session_id,
          })
          return res.status(200).json({ ok: true, checkout_url: existingSession.url })
        }

        // Sessão expirada/concluída — marcar order como expired e criar novo checkout
        await svc
          .from('credit_orders')
          .update({ status: 'expired' })
          .eq('id', existingOrder.id)

        console.log('[POST /api/credit-orders/checkout] Order expirada, criando novo checkout:', existingOrder.id)
      } catch (stripeErr) {
        // Não conseguiu consultar sessão (ex: deletada no Stripe) — prosseguir com novo checkout
        console.warn(
          '[POST /api/credit-orders/checkout] Não foi possível verificar sessão existente:',
          stripeErr.message
        )
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

      // Persistir — nunca retornar ao frontend
      await svc
        .from('companies')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', effectiveCompanyId)
    }

    // ── 7. Inserir credit_order com snapshot completo ─────────────────────────
    // Inserir antes de criar a sessão Stripe para ter o credit_order_id no metadata
    const { data: order, error: insertError } = await svc
      .from('credit_orders')
      .insert({
        company_id:       effectiveCompanyId,
        package_id:       pkg.id,
        credits_snapshot: pkg.credits,
        price_snapshot:   pkg.price,
        status:           'checkout_created',
        requested_by:     userId,
        metadata: {
          package_name:       pkg.name,
          currency:           'BRL',
          stripe_customer_id: stripeCustomerId,
          // Incluído apenas quando compra vinculada a análise IA (para rastreabilidade)
          ...(analysisId ? { analysis_id: analysisId } : {}),
        },
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[POST /api/credit-orders/checkout] Erro ao inserir credit_order:', insertError.message)
      return res.status(500).json({ ok: false, error: 'Erro ao registrar pedido' })
    }

    // ── 8. Criar Stripe Checkout Session ─────────────────────────────────────
    // Não define payment_method_types — herda meios de pagamento configurados na conta Stripe
    // (cartão + Pix), mantendo consistência automática com os planos

    // success_url:
    //   • analysis_id presente → redireciona para /dashboard com resume_analysis
    //   • sem analysis_id     → fluxo padrão (Settings)
    const successUrl = analysisId
      ? `${appBaseUrl}/dashboard?resume_analysis=${analysisId}&credits=success`
      : `${appBaseUrl}/settings?tab=planos-uso&credits=success&session_id={CHECKOUT_SESSION_ID}`

    const cancelUrl = analysisId
      ? `${appBaseUrl}/dashboard`
      : `${appBaseUrl}/settings?tab=planos-uso`

    // Stripe metadata:
    //   • analysis_id incluído para rastreabilidade (webhook não o usa, mas facilita suporte)
    //   • type + company_id + credit_order_id são os campos lidos pelo webhook
    const stripeMetadata = {
      type:            'credit_purchase',
      company_id:      effectiveCompanyId,
      credit_order_id: order.id,
      ...(analysisId ? { analysis_id: analysisId } : {}),
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode:     'payment',
        customer: stripeCustomerId,

        line_items: [
          {
            quantity:   1,
            price_data: {
              currency:     'brl',
              unit_amount:  Math.round(pkg.price * 100), // reais → centavos
              product_data: {
                name:        `${pkg.name} — ${pkg.credits.toLocaleString('pt-BR')} créditos de IA`,
                description: 'Créditos avulsos Lovoo CRM — acumulam entre meses',
              },
            },
          },
        ],

        metadata:    stripeMetadata,
        success_url: successUrl,
        cancel_url:  cancelUrl,
      },
      { idempotencyKey: `credit-checkout-${order.id}` }
    )

    // ── 9. Persistir stripe_session_id na order ────────────────────────────────
    await svc
      .from('credit_orders')
      .update({ stripe_session_id: session.id })
      .eq('id', order.id)

    console.log('[POST /api/credit-orders/checkout] Checkout criado:', {
      company_id:      effectiveCompanyId,
      credit_order_id: order.id,
      stripe_session:  session.id,
      package:         pkg.name,
      credits:         pkg.credits,
      price_brl:       pkg.price,
      ...(analysisId ? { analysis_id: analysisId, flow: 'ai_analysis' } : { flow: 'settings' }),
    })

    // ── 10. Resposta — checkout_url apenas (nada de dados Stripe internos) ────
    return res.status(201).json({ ok: true, checkout_url: session.url })

  } catch (err) {
    // Erros da SDK Stripe têm .type
    if (err.type?.startsWith('Stripe')) {
      console.error('[POST /api/credit-orders/checkout] Stripe error:', err.message, {
        type: err.type, code: err.code, company: effectiveCompanyId,
      })
      return res.status(502).json({ ok: false, error: 'Erro ao comunicar com Stripe. Tente novamente.' })
    }

    console.error('[POST /api/credit-orders/checkout] Erro interno:', err)
    return res.status(500).json({ ok: false, error: 'Erro interno ao processar checkout' })
  }
}
