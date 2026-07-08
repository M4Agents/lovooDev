// =====================================================
// PUT /api/contact-cycles/questions/[questionId]
//
// Atualiza label, field_type, options, required, sort_order e/ou active.
// Não existe DELETE físico — desativação via active = false.
//
// RBAC: admin, system_admin, super_admin
// Anti-IDOR: questionId é validado contra company_id antes do update
//
// Campos aceitos: label, field_type, options, required, sort_order, active
// =====================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

const ADMIN_ROLES    = new Set(['admin', 'system_admin', 'super_admin'])
const VALID_FIELD_TYPES = new Set(['text', 'textarea', 'select', 'boolean', 'number'])

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

    if (!ADMIN_ROLES.has(membership.role)) {
      jsonError(res, 403, 'Permissão insuficiente — requer admin, system_admin ou super_admin')
      return
    }

    // ------------------------------------------------------------------
    // 3. questionId da rota dinâmica
    // ------------------------------------------------------------------
    const questionId = typeof req.query.questionId === 'string' ? req.query.questionId.trim() : ''
    if (!questionId) { jsonError(res, 400, 'questionId é obrigatório'); return }

    // ------------------------------------------------------------------
    // 4. Anti-IDOR — confirmar que questionId pertence à empresa
    // ------------------------------------------------------------------
    const { data: existing, error: lookupError } = await svc
      .from('contact_attempt_questions')
      .select('id, field_type, active')
      .eq('id', questionId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (lookupError) {
      console.error('[contact-cycles/questions/[questionId]] lookup error:', lookupError)
      jsonError(res, 500, 'Erro ao verificar pergunta')
      return
    }

    if (!existing) {
      jsonError(res, 404, 'Pergunta não encontrada')
      return
    }

    // ------------------------------------------------------------------
    // 5. Validar e extrair campos permitidos
    // ------------------------------------------------------------------
    const body    = req.body ?? {}
    const updates: Record<string, unknown> = {}

    if ('label' in body) {
      const label = typeof body.label === 'string' ? body.label.trim() : null
      if (!label) {
        jsonError(res, 400, 'label não pode ser vazio')
        return
      }
      updates.label = label
    }

    // Tipo efetivo após o update (pode vir do body ou manter o atual)
    const effectiveFieldType: string =
      'field_type' in body
        ? (typeof body.field_type === 'string' ? body.field_type.trim() : '')
        : existing.field_type

    if ('field_type' in body) {
      if (!effectiveFieldType || !VALID_FIELD_TYPES.has(effectiveFieldType)) {
        jsonError(
          res,
          400,
          `field_type inválido — valores aceitos: ${[...VALID_FIELD_TYPES].join(', ')}`,
        )
        return
      }
      updates.field_type = effectiveFieldType
    }

    // options: validar se o tipo efetivo exige ou descarta
    if ('options' in body) {
      if (effectiveFieldType === 'select') {
        if (!Array.isArray(body.options) || body.options.length === 0) {
          jsonError(res, 400, 'options é obrigatório para field_type "select" e deve ser um array não vazio')
          return
        }
        const allStrings = body.options.every(
          (o: unknown) => typeof o === 'string' && (o as string).trim().length > 0,
        )
        if (!allStrings) {
          jsonError(res, 400, 'Cada item de options deve ser uma string não vazia')
          return
        }
        updates.options = (body.options as string[]).map((o: string) => o.trim())
      } else {
        // Tipo não-select: forçar null para limpar options residuais
        updates.options = null
      }
    } else if ('field_type' in body && effectiveFieldType !== 'select') {
      // Se o tipo mudou de select para outro e options não foi enviado: limpar
      updates.options = null
    }

    if ('required' in body) {
      if (typeof body.required !== 'boolean') {
        jsonError(res, 400, 'required deve ser boolean')
        return
      }
      updates.required = body.required
    }

    if ('sort_order' in body) {
      const parsed = Number(body.sort_order)
      if (!Number.isInteger(parsed) || parsed < 0) {
        jsonError(res, 400, 'sort_order deve ser um inteiro não-negativo')
        return
      }
      updates.sort_order = parsed
    }

    if ('active' in body) {
      if (typeof body.active !== 'boolean') {
        jsonError(res, 400, 'active deve ser boolean')
        return
      }
      updates.active = body.active
    }

    if (Object.keys(updates).length === 0) {
      jsonError(
        res,
        400,
        'Nenhum campo válido fornecido — campos aceitos: label, field_type, options, required, sort_order, active',
      )
      return
    }

    updates.updated_at = new Date().toISOString()

    // ------------------------------------------------------------------
    // 6. Update
    // ------------------------------------------------------------------
    const { data: question, error: updateError } = await svc
      .from('contact_attempt_questions')
      .update(updates)
      .eq('id', questionId)
      .eq('company_id', companyId)
      .select('id, label, field_type, options, required, sort_order, active, updated_at')
      .single()

    if (updateError) {
      console.error('[contact-cycles/questions/[questionId]] update error:', updateError)
      jsonError(res, 500, 'Erro ao atualizar pergunta')
      return
    }

    res.status(200).json({ ok: true, data: { question } })

  } catch (err) {
    console.error('[contact-cycles/questions/[questionId]] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
