// =============================================================================
// GET  /api/admin/consulting-packages  — lista todos os pacotes do catálogo
// POST /api/admin/consulting-packages  — cria novo pacote (platform_admin)
//
// SEGURANÇA:
//   - Apenas super_admin ou system_admin (platform_admin) têm acesso a POST
//   - GET retorna todos os pacotes (incluindo inativos) para gestão no catálogo
// =============================================================================

import { resolvePlatformAdminContext } from '../../lib/credits/authContext.js'

export default async function handler(req, res) {
  // Catálogo global — apenas super_admin/system_admin da empresa pai, sem company_id
  const ctx = await resolvePlatformAdminContext(req)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc } = ctx

  // ── GET: listar todos os pacotes (incluindo inativos) ─────────────────────
  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('consulting_packages')
      .select(`
        id, name, description, package_type, hours, price,
        is_active, is_available_for_sale,
        headline, subheadline, features, cta_text, badge_text,
        is_highlighted, display_order,
        bonus_credit_package_id,
        bonus_credit:bonus_credit_package_id (id, name, credits),
        created_at, updated_at
      `)
      .order('display_order', { ascending: true })
      .order('price', { ascending: true })

    if (error) {
      console.error('[GET /api/admin/consulting-packages] Erro:', error.message)
      return res.status(500).json({ ok: false, error: 'Erro ao carregar catálogo' })
    }

    return res.status(200).json({ ok: true, packages: data ?? [] })
  }

  // ── POST: criar pacote ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body = {}
    try {
      body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
    } catch {
      return res.status(400).json({ ok: false, error: 'Body inválido' })
    }

    const {
      name,
      description,
      package_type,
      hours,
      price,
      is_active               = true,
      is_available_for_sale   = true,
      bonus_credit_package_id = null,
      headline                = null,
      subheadline             = null,
      features                = null,
      cta_text                = null,
      badge_text              = null,
      is_highlighted          = false,
      display_order           = 0,
    } = body

    if (!name || !package_type || hours == null || price == null) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: name, package_type, hours, price' })
    }

    if (!['implementation', 'training', 'consulting'].includes(package_type)) {
      return res.status(400).json({ ok: false, error: 'package_type inválido. Use: implementation, training, consulting' })
    }

    if (Number(hours) <= 0) {
      return res.status(400).json({ ok: false, error: 'hours deve ser maior que zero' })
    }

    if (Number(price) < 0) {
      return res.status(400).json({ ok: false, error: 'price não pode ser negativo' })
    }

    // Validar bonus_credit_package_id se informado
    if (bonus_credit_package_id) {
      const { data: bonusPkg } = await svc
        .from('credit_packages')
        .select('id, is_available_for_bonus')
        .eq('id', bonus_credit_package_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!bonusPkg) {
        return res.status(400).json({ ok: false, error: 'Pacote de bônus não encontrado ou inativo' })
      }
      if (!bonusPkg.is_available_for_bonus) {
        return res.status(400).json({ ok: false, error: 'Pacote de créditos não está marcado como disponível para bônus (is_available_for_bonus=false)' })
      }
    }

    const { data, error } = await svc
      .from('consulting_packages')
      .insert({
        name,
        description:              description ?? null,
        package_type,
        hours:                    Number(hours),
        price:                    Number(price),
        is_active,
        is_available_for_sale,
        bonus_credit_package_id:  bonus_credit_package_id ?? null,
        headline:                 headline    ?? null,
        subheadline:              subheadline ?? null,
        features:                 Array.isArray(features) ? features : null,
        cta_text:                 cta_text    ?? null,
        badge_text:               badge_text  ?? null,
        is_highlighted:           Boolean(is_highlighted),
        display_order:            Number(display_order) || 0,
      })
      .select()
      .single()

    if (error) {
      console.error('[POST /api/admin/consulting-packages] Erro:', error.message)
      return res.status(500).json({ ok: false, error: 'Erro ao criar pacote' })
    }

    return res.status(201).json({ ok: true, package: data })
  }

  return res.status(405).json({ ok: false, error: 'Método não permitido' })
}
