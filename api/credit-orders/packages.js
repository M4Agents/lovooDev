// =============================================================================
// GET /api/credit-orders/packages
//
// Lista os pacotes de créditos disponíveis para compra pelas empresas filhas.
//
// FILTRO OBRIGATÓRIO (ambos devem ser true):
//   - credit_packages.is_active            = true  (pacote válido no sistema)
//   - credit_packages.is_available_for_sale = true  (publicado para venda)
//
// SEGURANÇA:
//   - Nunca retorna dados de governança interna (estimated_ai_cost, estimated_profit)
//   - company_id resolvido via resolveCreditsContext (nunca aceito do frontend)
//   - Empresa pai pode consultar em nome de empresa filha via ?company_id=
//
// RESPOSTA (200):
//   {
//     "ok": true,
//     "data": [
//       {
//         "id":                     string,
//         "name":                   string,
//         "credits":                number,
//         "price":                  number,
//         "estimated_conversations": number   // créditos / 50 (preview UX)
//       }
//     ]
//   }
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

const CREDITS_PER_CONVERSATION = 50

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── Parsear query params ──────────────────────────────────────────────────
  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params         = new URLSearchParams(qs)
  const queryCompanyId = params.get('company_id') ?? null

  // ── Auth + multi-tenant ───────────────────────────────────────────────────
  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc } = ctx

  // ── Buscar pacotes disponíveis para venda ─────────────────────────────────
  // Filtra ambas as flags: is_active E is_available_for_sale
  // Ordena por preço crescente para UX consistente

  const { data, error } = await svc
    .from('credit_packages')
    .select('id, name, credits, price')
    .eq('is_active', true)
    .eq('is_available_for_sale', true)
    .order('price', { ascending: true })

  if (error) {
    return res.status(500).json({ ok: false, error: 'Erro ao buscar pacotes disponíveis' })
  }

  const enriched = (data ?? []).map(pkg => ({
    id:                      pkg.id,
    name:                    pkg.name,
    credits:                 pkg.credits,
    price:                   pkg.price,
    estimated_conversations: Math.floor(pkg.credits / CREDITS_PER_CONVERSATION),
  }))

  return res.status(200).json({ ok: true, data: enriched })
}
