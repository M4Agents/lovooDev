// =============================================================================
// POST /api/stripe/plans/checkout
//
// Inicia uma nova assinatura via Stripe Checkout Session.
// Exclusivo para empresas SEM assinatura Stripe ativa (primeira contratação).
// Para empresas com assinatura ativa, use POST /api/stripe/plans/change.
//
// BODY (JSON):
//   { "to_plan_id": "<uuid>" }
//
// RESPOSTA (201):
//   { "checkout_url": "https://checkout.stripe.com/...", "request_id": "<uuid>" }
//
// ERROS:
//   400 plan_not_available          — plano inativo ou não listado publicamente
//   400 plan_not_stripe_purchasable — plano sem stripe_price_id_monthly
//   400 already_on_this_plan        — empresa já está no plano destino
//   400 already_has_pending_request — já existe PCR pendente para esta empresa
//   400 active_subscription_exists  — empresa já tem assinatura Stripe ativa (usar /change)
//   400 downgrade_blocked           — uso atual excede limites do plano destino
//   401 / 403                       — autenticação ou acesso negado
//   500                             — erro interno
//
// SEGURANÇA:
//   - company_id NUNCA aceito do body — sempre da sessão autenticada
//   - Todos os valores financeiros (stripe_price_id_monthly) lidos do banco
//   - stripe_customer_id nunca retornado ao frontend
//   - Roles verificados: apenas admin+ pode iniciar checkout de plano
//   - Idempotency key baseada em company+plan+dia para prevenir duplicidade
// =============================================================================

import { resolveCreditsContext } from '../../lib/credits/authContext.js'
import { getPlanLimits }         from '../../lib/plans/limitChecker.js'
import { getStripe }             from '../../lib/stripe/client.js'

// Roles com permissão para iniciar checkout de plano
const ALLOWED_ROLES = new Set(['admin', 'super_admin', 'system_admin'])

// Idempotency key única por tentativa de checkout
// Usa crypto.randomUUID para garantir nova sessão a cada tentativa.
// Duplicidade real é prevenida pela verificação de PCR pendente (passo 5).
const idempotencyKeyFor = () => crypto.randomUUID()

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Parsear body ────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ error: 'Body inválido' })
  }

  const { to_plan_id } = body

  if (!to_plan_id || typeof to_plan_id !== 'string') {
    return res.status(400).json({ error: 'to_plan_id é obrigatório' })
  }

  // ── 2. Auth + contexto multi-tenant ───────────────────────────────────────
  // company_id vem da sessão autenticada — nunca do body
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ error: ctx.error })
  }

  const { svc, effectiveCompanyId, userId } = ctx

  // ── 3. Verificar role: apenas admin+ pode iniciar checkout de plano ────────
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
    // Instância Stripe inicializada cedo para uso tanto na validação de PCR stale
    // quanto na criação da Checkout Session (passos 8 e 9).
    const stripe = getStripe()

    // ── 4. Validar plano destino ───────────────────────────────────────────────
    // Lê stripe_price_id_monthly do banco — nunca do frontend
    const { data: targetPlan, error: planError } = await svc
      .from('plans')
      .select(
        'id, name, slug, sort_order, stripe_price_id_monthly,' +
        'max_leads, max_users, max_funnels, max_automation_flows, storage_mb'
      )
      .eq('id', to_plan_id)
      .eq('is_active', true)
      .eq('is_publicly_listed', true)
      .maybeSingle()

    if (planError || !targetPlan) {
      return res.status(400).json({ error: 'plan_not_available' })
    }

    // Plano deve ter stripe_price_id_monthly — sem ele não é vendável via Stripe
    if (!targetPlan.stripe_price_id_monthly) {
      return res.status(400).json({ error: 'plan_not_stripe_purchasable' })
    }

    // ── 5. Verificar plano atual e duplicidade ────────────────────────────────
    const currentLimits = await getPlanLimits(svc, effectiveCompanyId)
    const fromPlanId    = currentLimits.plan_id

    if (fromPlanId === to_plan_id) {
      return res.status(400).json({ error: 'already_on_this_plan' })
    }

    // PCR pendente: verificar se a sessão Stripe associada ainda está aberta.
    // Se a sessão expirou ou foi cancelada, o PCR é stale e deve ser auto-cancelado
    // para permitir nova tentativa sem intervenção manual.
    const { data: existingPcr } = await svc
      .from('plan_change_requests')
      .select('id, stripe_checkout_session_id')
      .eq('company_id', effectiveCompanyId)
      .eq('status', 'pending')
      .maybeSingle()

    if (existingPcr) {
      let sessionStillOpen = false

      if (existingPcr.stripe_checkout_session_id) {
        try {
          const existingSession = await stripe.checkout.sessions.retrieve(
            existingPcr.stripe_checkout_session_id
          )
          sessionStillOpen = existingSession.status === 'open'
        } catch {
          // Não conseguiu verificar (ex: sessão deletada no Stripe) — assume não aberta
          sessionStillOpen = false
        }
      }

      if (sessionStillOpen) {
        // Checkout em andamento — não criar duplicata
        return res.status(400).json({ error: 'already_has_pending_request' })
      }

      // Sessão expirada/cancelada — auto-cancelar PCR stale e prosseguir
      await svc
        .from('plan_change_requests')
        .update({ status: 'cancelled' })
        .eq('id', existingPcr.id)

      console.log(
        '[POST /api/stripe/plans/checkout] PCR stale auto-cancelado:',
        existingPcr.id, '| session:', existingPcr.stripe_checkout_session_id
      )
    }

    // ── 6. Verificar assinatura Stripe ativa (este endpoint = apenas nova contratação)
    //
    // Empresas em trial interno (status='trialing', stripe_subscription_id IS NULL)
    // são PERMITIDAS aqui — esta é a rota correta de conversão do trial para plano pago.
    // A guarda usa stripe_subscription_id como critério, não o status isolado.
    const { data: existingSub } = await svc
      .from('company_subscriptions')
      .select('id, status, stripe_subscription_id')
      .eq('company_id', effectiveCompanyId)
      .maybeSingle()

    const hasActiveStripeSubscription =
      existingSub?.stripe_subscription_id &&
      ['active', 'trialing', 'past_due'].includes(existingSub.status)

    if (hasActiveStripeSubscription) {
      return res.status(400).json({
        error: 'active_subscription_exists',
        hint:  'Use POST /api/stripe/plans/change para alterar assinatura existente',
      })
    }

    // ── 7. Validação de downgrade: uso atual vs limites do plano destino ──────
    // Mesma lógica do change-request.js — reutilizada aqui para consistência
    const [leadsRes, usersRes, funnelsRes, autoFlowsRes, storageRes] = await Promise.all([
      svc.from('leads').select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId).is('deleted_at', null),
      svc.from('company_users').select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId).eq('is_active', true).eq('is_platform_member', false),
      svc.from('sales_funnels').select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId).eq('is_active', true),
      svc.from('automation_flows').select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId).eq('is_active', true),
      svc.rpc('get_company_storage_used_mb', { p_company_id: effectiveCompanyId }),
    ])

    const usage = {
      leads:      leadsRes.count     ?? 0,
      users:      usersRes.count     ?? 0,
      funnels:    funnelsRes.count   ?? 0,
      auto_flows: autoFlowsRes.count ?? 0,
      storage_mb: Math.ceil(parseFloat(storageRes.data) || 0),
    }

    const blockedBy = [
      { key: 'max_leads',            current: usage.leads,      limit: targetPlan.max_leads },
      { key: 'max_users',            current: usage.users,      limit: targetPlan.max_users },
      { key: 'max_funnels',          current: usage.funnels,    limit: targetPlan.max_funnels },
      { key: 'max_automation_flows', current: usage.auto_flows, limit: targetPlan.max_automation_flows },
      { key: 'storage_mb',           current: usage.storage_mb, limit: targetPlan.storage_mb },
    ]
      .filter(({ current, limit }) => limit !== null && current > limit)
      .map(({ key }) => key)

    if (blockedBy.length > 0) {
      return res.status(400).json({ error: 'downgrade_blocked', blocked_by: blockedBy })
    }

    // ── 8. Stripe customer: buscar ou criar ───────────────────────────────────
    const { data: company, error: companyError } = await svc
      .from('companies')
      .select('id, name, stripe_customer_id')
      .eq('id', effectiveCompanyId)
      .single()

    if (companyError || !company) {
      return res.status(500).json({ error: 'Erro ao carregar dados da empresa' })
    }

    let stripeCustomerId = company.stripe_customer_id

    if (!stripeCustomerId) {
      // Criar Customer no Stripe
      const customer = await stripe.customers.create(
        {
          name:     company.name,
          metadata: {
            company_id: effectiveCompanyId,
            origin:     'lovoo_crm',
          },
        },
        { idempotencyKey: `customer-create-${effectiveCompanyId}` }
      )

      stripeCustomerId = customer.id

      // Persistir no banco — nunca retornar ao frontend
      await svc
        .from('companies')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', effectiveCompanyId)
    }

    // ── 9. Criar Checkout Session no Stripe ───────────────────────────────────
    const appBaseUrl = process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com'

    const session = await stripe.checkout.sessions.create(
      {
        mode:                  'subscription',
        customer:              stripeCustomerId,
        allow_promotion_codes: true,

        line_items: [
          {
            price:    targetPlan.stripe_price_id_monthly,
            quantity: 1,
          },
        ],

        // Correlação: company_id disponível diretamente no evento do webhook
        client_reference_id: effectiveCompanyId,

        // Metadata na Session
        metadata: {
          company_id: effectiveCompanyId,
          to_plan_id,
          origin:     'self_service',
        },

        // Metadata propagada à Subscription — disponível em customer.subscription.created/updated
        subscription_data: {
          metadata: {
            company_id: effectiveCompanyId,
            to_plan_id,
          },
        },

        success_url: `${appBaseUrl}/settings?tab=planos-uso&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${appBaseUrl}/settings?tab=planos-uso&checkout=cancelled`,

        // Expiração padrão da Stripe: 24h (não alteramos)
      },
      { idempotencyKey: idempotencyKeyFor() }
    )

    // ── 10. Inserir plan_change_request para auditoria ─────────────────────────
    const { data: pcr, error: pcrError } = await svc
      .from('plan_change_requests')
      .insert({
        company_id:                  effectiveCompanyId,
        from_plan_id:                fromPlanId ?? null,
        to_plan_id,
        requested_by:                userId,
        status:                      'pending',
        origin:                      'self_service',
        stripe_checkout_session_id:  session.id,
      })
      .select('id')
      .single()

    if (pcrError) {
      // Violação do índice único: PCR pendente criada por race condition — ainda há sessão válida
      if (pcrError.code === '23505') {
        console.warn(
          '[POST /api/stripe/plans/checkout] Race: PCR pendente criada concorrentemente.' +
          ' Retornando checkout_url da sessão já criada.',
          { company: effectiveCompanyId, plan: to_plan_id, session: session.id }
        )
        // Busca o PCR concorrente para retornar o request_id
        const { data: racePcr } = await svc
          .from('plan_change_requests')
          .select('id')
          .eq('company_id', effectiveCompanyId)
          .eq('status', 'pending')
          .maybeSingle()

        return res.status(201).json({
          checkout_url: session.url,
          request_id:   racePcr?.id ?? null,
        })
      }

      console.error('[POST /api/stripe/plans/checkout] Erro ao inserir PCR:', pcrError.message)
      return res.status(500).json({ error: 'Erro ao registrar solicitação de plano' })
    }

    // ── 11. Resposta — checkout_url e request_id apenas (nada de dados Stripe internos)
    return res.status(201).json({
      checkout_url: session.url,
      request_id:   pcr.id,
    })

  } catch (err) {
    // Erros da SDK do Stripe têm .type e .code
    if (err.type?.startsWith('Stripe')) {
      console.error('[POST /api/stripe/plans/checkout] Stripe error:', err.message, {
        type: err.type, code: err.code, company: effectiveCompanyId,
      })
      return res.status(502).json({ error: 'Erro ao comunicar com Stripe. Tente novamente.' })
    }

    console.error('[POST /api/stripe/plans/checkout] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao processar checkout' })
  }
}
