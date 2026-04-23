// =============================================================================
// PUT /api/admin/consulting-packages/[id]
//
// Atualiza um pacote consultivo existente (platform_admin).
//
// SEGURANÇA:
//   - Apenas super_admin ou system_admin
//   - Validação de bonus_credit_package_id (is_available_for_bonus)
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
  if (req.method !== 'PUT') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  const ctx = await resolveCreditsContext(req, null)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, userId } = ctx

  const isAdmin = await isPlatformAdmin(svc, userId)
  if (!isAdmin) {
    return res.status(403).json({ ok: false, error: 'Apenas administradores da plataforma podem editar o catálogo consultivo' })
  }

  const packageId = req.query?.id ?? req.url?.split('/').filter(Boolean).pop()?.split('?')[0]

  if (!packageId) {
    return res.status(400).json({ ok: false, error: 'ID do pacote é obrigatório' })
  }

  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ ok: false, error: 'Body inválido' })
  }

  const allowedFields = [
    'name', 'description', 'package_type', 'hours', 'price',
    'is_active', 'is_available_for_sale', 'bonus_credit_package_id',
    'headline', 'subheadline', 'features', 'cta_text', 'badge_text',
    'is_highlighted', 'display_order',
  ]

  const updates = {}
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field]
  }

  // Coerce types para campos novos
  if ('features' in updates) {
    updates.features = Array.isArray(updates.features) ? updates.features : null
  }
  if ('is_highlighted' in updates) {
    updates.is_highlighted = Boolean(updates.is_highlighted)
  }
  if ('display_order' in updates) {
    updates.display_order = Number(updates.display_order) || 0
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ ok: false, error: 'Nenhum campo para atualizar' })
  }

  // Validações
  if (updates.package_type && !['implementation', 'training', 'consulting'].includes(updates.package_type)) {
    return res.status(400).json({ ok: false, error: 'package_type inválido' })
  }
  if (updates.hours != null && Number(updates.hours) <= 0) {
    return res.status(400).json({ ok: false, error: 'hours deve ser maior que zero' })
  }
  if (updates.price != null && Number(updates.price) < 0) {
    return res.status(400).json({ ok: false, error: 'price não pode ser negativo' })
  }
  if ('bonus_credit_package_id' in updates && updates.bonus_credit_package_id) {
    const { data: bonusPkg } = await svc
      .from('credit_packages')
      .select('id, is_available_for_bonus')
      .eq('id', updates.bonus_credit_package_id)
      .eq('is_active', true)
      .maybeSingle()

    if (!bonusPkg) {
      return res.status(400).json({ ok: false, error: 'Pacote de bônus não encontrado ou inativo' })
    }
    if (!bonusPkg.is_available_for_bonus) {
      return res.status(400).json({ ok: false, error: 'Pacote não está marcado como disponível para bônus' })
    }
  }

  const { data, error } = await svc
    .from('consulting_packages')
    .update(updates)
    .eq('id', packageId)
    .select()
    .single()

  if (error) {
    console.error('[PUT /api/admin/consulting-packages/:id] Erro:', error.message)
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar pacote' })
  }

  return res.status(200).json({ ok: true, package: data })
}
