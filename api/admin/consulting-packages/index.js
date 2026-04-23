// =============================================================================
// GET  /api/admin/consulting-packages  — lista todos os pacotes do catálogo
// POST /api/admin/consulting-packages  — cria novo pacote (platform_admin)
//
// SEGURANÇA:
//   - Apenas super_admin ou system_admin (platform_admin) têm acesso a POST
//   - GET retorna todos os pacotes (incluindo inativos) para gestão no catálogo
// =============================================================================

import { resolveCreditsContext } from '../../lib/credits/authContext.js'

async function isPlatformAdmin(svc, userId) {
  const { data } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('role', ['super_admin', 'system_admin'])
    .limit(1)
    .maybeSingle()

  return !!data
}

export default async function handler(req, res) {
  // Admin do catálogo opera sempre no contexto da empresa pai — sem company_id de filha
  const ctx = await resolveCreditsContext(req, null)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, userId } = ctx

  const isAdmin = await isPlatformAdmin(svc, userId)
  if (!isAdmin) {
    return res.status(403).json({ ok: false, error: 'Apenas administradores da plataforma podem gerenciar o catálogo consultivo' })
  }

  // ── GET: listar todos os pacotes (incluindo inativos) ─────────────────────
  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('consulting_packages')
      .select(`
        id, name, description, package_type, hours, price,
        is_active, is_available_for_sale,
        bonus_credit_package_id,
        bonus_credit:bonus_credit_package_id (id, name, credits),
        created_at, updated_at
      `)
      .order('package_type', { ascending: true })
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
      is_active            = true,
      is_available_for_sale = true,
      bonus_credit_package_id = null,
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
