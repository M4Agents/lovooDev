// =============================================================================
// GET /api/consulting/packages
//
// Lista pacotes consultivos disponíveis para compra.
//
// QUERY:
//   ?company_id=<uuid>  — obrigatório para admin da empresa pai atuando em filha
//
// RESPOSTA (200):
//   { "ok": true, "packages": [...] }
//
// SEGURANÇA:
//   - Autenticação obrigatória (Bearer token)
//   - Qualquer membro ativo pode visualizar o catálogo (SELECT RLS aberto)
//   - Filtra apenas is_active=true e is_available_for_sale=true
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc } = ctx

  const { data, error } = await svc
    .from('consulting_packages')
    .select(`
      id,
      name,
      description,
      package_type,
      hours,
      price,
      headline,
      subheadline,
      features,
      cta_text,
      badge_text,
      is_highlighted,
      display_order,
      bonus_credit_package_id,
      bonus_credit:bonus_credit_package_id (
        id, name, credits
      )
    `)
    .eq('is_active', true)
    .eq('is_available_for_sale', true)
    .order('display_order', { ascending: true })
    .order('price', { ascending: true })

  if (error) {
    console.error('[GET /api/consulting/packages] Erro:', error.message)
    return res.status(500).json({ ok: false, error: 'Erro ao carregar pacotes' })
  }

  return res.status(200).json({ ok: true, packages: data ?? [] })
}
