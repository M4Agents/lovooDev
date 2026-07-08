// =====================================================
// PUT /api/contact-cycles/reasons/[reasonId]
//
// Atualiza label e/ou estado ativo de um motivo de tentativa.
// Não existe DELETE físico — desativação via active = false.
//
// RBAC: admin, system_admin, super_admin
// Anti-IDOR: reasonId é validado contra company_id antes do update
//
// Campos aceitos: label, active
// =====================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method !== 'PUT') {
    jsonError(res, 405, 'Método não permitido')
    return
  }

  try {
    // ------------------------------------------------------------------
    // 1. Auth
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // ------------------------------------------------------------------
    // 2. company_id + membership
    // ------------------------------------------------------------------
    const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // RBAC: somente admin+
    if (!ADMIN_ROLES.has(membership.role)) {
      jsonError(res, 403, 'Permissão insuficiente — requer admin, system_admin ou super_admin')
      return
    }

    // ------------------------------------------------------------------
    // 3. reasonId da rota dinâmica
    // ------------------------------------------------------------------
    const reasonId = typeof req.query.reasonId === 'string' ? req.query.reasonId.trim() : ''
    if (!reasonId) { jsonError(res, 400, 'reasonId é obrigatório'); return }

    // ------------------------------------------------------------------
    // 4. Anti-IDOR — confirmar que reasonId pertence à empresa
    // ------------------------------------------------------------------
    const { data: existing, error: lookupError } = await svc
      .from('contact_attempt_reasons')
      .select('id, label, active')
      .eq('id', reasonId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (lookupError) {
      console.error('[contact-cycles/reasons/[reasonId]] lookup error:', lookupError)
      jsonError(res, 500, 'Erro ao verificar motivo')
      return
    }

    if (!existing) {
      jsonError(res, 404, 'Motivo não encontrado')
      return
    }

    // ------------------------------------------------------------------
    // 5. Validar e extrair campos permitidos
    // ------------------------------------------------------------------
    const body = req.body ?? {}
    const updates: Record<string, unknown> = {}

    if ('label' in body) {
      const label = typeof body.label === 'string' ? body.label.trim() : null
      if (!label) {
        jsonError(res, 400, 'label não pode ser vazio')
        return
      }
      updates.label = label
    }

    if ('active' in body) {
      if (typeof body.active !== 'boolean') {
        jsonError(res, 400, 'active deve ser boolean')
        return
      }
      updates.active = body.active
    }

    if (Object.keys(updates).length === 0) {
      jsonError(res, 400, 'Nenhum campo válido fornecido — campos aceitos: label, active')
      return
    }

    updates.updated_at = new Date().toISOString()

    // ------------------------------------------------------------------
    // 6. Update
    // ------------------------------------------------------------------
    const { data: reason, error: updateError } = await svc
      .from('contact_attempt_reasons')
      .update(updates)
      .eq('id', reasonId)
      .eq('company_id', companyId)
      .select('id, label, active, updated_at')
      .single()

    if (updateError) {
      // Tratar violação de unicidade (company_id, label)
      if (updateError.code === '23505') {
        jsonError(res, 409, `Já existe um motivo com o label "${updates.label}" para esta empresa`)
        return
      }
      console.error('[contact-cycles/reasons/[reasonId]] update error:', updateError)
      jsonError(res, 500, 'Erro ao atualizar motivo')
      return
    }

    res.status(200).json({ ok: true, data: { reason } })

  } catch (err) {
    console.error('[contact-cycles/reasons/[reasonId]] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
