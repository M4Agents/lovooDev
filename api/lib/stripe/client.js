// =============================================================================
// api/lib/stripe/client.js
//
// Factory do Stripe SDK para uso exclusivo no backend (Vercel Functions).
//
// SEGURANÇA:
//   - Usa STRIPE_SECRET_KEY do ambiente — nunca exposta no frontend
//   - Arquivo importado apenas por módulos em /api (server-side only)
//   - Nunca importar este módulo em /src (frontend)
//
// USO:
//   import { getStripe } from '../lib/stripe/client.js'
//   const stripe = getStripe()
//   const session = await stripe.checkout.sessions.create(...)
//
// IDEMPOTENCY:
//   Sempre passar idempotencyKey nas chamadas mutáveis:
//   stripe.checkout.sessions.create(params, { idempotencyKey: key })
// =============================================================================

import Stripe from 'stripe'

let _instance = null

/**
 * Retorna a instância singleton do Stripe SDK.
 * Lança erro claro se STRIPE_SECRET_KEY não estiver configurada.
 * Garante que apenas uma instância é criada por processo.
 */
export function getStripe() {
  if (_instance) return _instance

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      '[stripe/client] STRIPE_SECRET_KEY não configurada. ' +
      'Adicione a variável de ambiente no Vercel e no .env local.'
    )
  }

  _instance = new Stripe(key, {
    apiVersion: '2024-06-20',
    // Identifica chamadas originadas do Lovoo CRM nos logs do Stripe Dashboard
    appInfo: {
      name:    'Lovoo CRM',
      version: '2.0.0',
      url:     'https://app.lovoocrm.com',
    },
  })

  return _instance
}
