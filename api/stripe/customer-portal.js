// =============================================================================
// POST /api/stripe/customer-portal
//
// Cria uma sessão no Stripe Customer Portal para que o admin da empresa
// possa gerenciar método de pagamento, histórico de faturas e dados de cobrança.
//
// O portal é configurado no Stripe Dashboard para NÃO permitir:
//   - Cancelamento de assinatura
//   - Troca de plano (upgrade / downgrade)
//   - Qualquer alteração de assinatura
//
// BODY: (vazio)
//
// RESPOSTA (200):
//   { "portal_url": "https://billing.stripe.com/..." }
//
// ERROS:
//   400 no_stripe_customer       — empresa sem stripe_customer_id (nunca assinou via Stripe)
//   400 no_active_subscription   — empresa sem assinatura em status gerenciável
//   401 / 403                    — autenticação ou acesso negado
//   502                          — erro de comunicação com Stripe
//   500                          — erro interno
//
// SEGURANÇA:
//   - stripe_customer_id NUNCA aceito do frontend — sempre buscado do banco via effectiveCompanyId
//   - Roles verificados: apenas admin+ pode abrir o portal
//   - stripe_subscription_id e stripe_customer_id NUNCA retornados ao frontend
//   - company_id NUNCA aceito do body — sempre da sessão autenticada
//   - Nenhuma mudança operacional ocorre aqui: companies.plan_id inalterado
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'
import { getStripe }             from '../lib/stripe/client.js'

const ALLOWED_ROLES         = new Set(['admin', 'super_admin', 'system_admin'])
const MANAGEABLE_SUB_STATUS = new Set(['active', 'trialing', 'past_due'])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Auth + contexto multi-tenant ───────────────────────────────────────
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) return res.status(ctx.status).json({ error: ctx.error })

  const { svc, effectiveCompanyId } = ctx

  // ── 2. Role: apenas admin+ ────────────────────────────────────────────────
  const { data: membership } = await svc
    .from('company_users')
    .select('role')
    .eq('company_id', effectiveCompanyId)
    .eq('user_id', ctx.userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!membership || !ALLOWED_ROLES.has(membership.role)) {
    return res.status(403).json({ error: 'Acesso restrito a administradores da empresa' })
  }

  try {
    // ── 3. Buscar stripe_customer_id da empresa ────────────────────────────
    const { data: company, error: companyError } = await svc
      .from('companies')
      .select('stripe_customer_id')
      .eq('id', effectiveCompanyId)
      .maybeSingle()

    if (companyError) {
      console.error('[POST /api/stripe/customer-portal] Erro ao buscar empresa:', companyError.message)
      return res.status(500).json({ error: 'Erro interno ao buscar dados da empresa' })
    }

    if (!company?.stripe_customer_id) {
      return res.status(400).json({ error: 'no_stripe_customer' })
    }

    // ── 4. Validar assinatura gerenciável ─────────────────────────────────
    const { data: sub, error: subError } = await svc
      .from('company_subscriptions')
      .select('status')
      .eq('company_id', effectiveCompanyId)
      .maybeSingle()

    if (subError) {
      console.error('[POST /api/stripe/customer-portal] Erro ao buscar assinatura:', subError.message)
      return res.status(500).json({ error: 'Erro interno ao buscar assinatura' })
    }

    if (!sub || !MANAGEABLE_SUB_STATUS.has(sub.status)) {
      return res.status(400).json({ error: 'no_active_subscription' })
    }

    // ── 5. Criar sessão no Stripe Customer Portal ─────────────────────────
    const appBaseUrl = process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com'
    const returnUrl  = `${appBaseUrl}/settings?tab=planos-e-uso`

    const session = await getStripe().billingPortal.sessions.create({
      customer:   company.stripe_customer_id,
      return_url: returnUrl,
    })

    console.log('[POST /api/stripe/customer-portal] Sessão criada | company:', effectiveCompanyId)

    // ── 6. Resposta — stripe_customer_id e dados internos nunca expostos ──
    return res.status(200).json({ portal_url: session.url })

  } catch (err) {
    if (err.type?.startsWith('Stripe')) {
      console.error('[POST /api/stripe/customer-portal] Stripe error:', err.message, {
        type: err.type, code: err.code, company: effectiveCompanyId,
      })
      return res.status(502).json({ error: 'Erro ao comunicar com Stripe. Tente novamente.' })
    }

    console.error('[POST /api/stripe/customer-portal] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao processar solicitação' })
  }
}
