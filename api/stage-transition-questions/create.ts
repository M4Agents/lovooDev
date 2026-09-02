// =====================================================
// POST /api/stage-transition-questions/create
// Data: 02/09/2026 - Etapa D
//
// Cria nova pergunta de transição.
// Requer: admin, system_admin ou super_admin
//
// Body:
//   funnel_stage_id (obrigatório)
//   label (obrigatório)
//   field_type (obrigatório: text|number|boolean|select|multi_select)
//   required (obrigatório: boolean)
//   options (obrigatório para select/multi_select: string[])
//   sort_order (opcional: number, default: 0)
//
// Validações:
//   - Max 15 perguntas ativas por stage
//   - Options: array não vazio, strings trimadas, sem duplicatas
//   - Label: string trimada não vazia
//
// Response: { ok: true, data: { question: StageTransitionQuestion } }
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'

// Feature flag server-side
function isFeatureEnabled(): boolean {
  const flag = process.env.FEATURE_STAGE_TRANSITION_QUESTIONS
  return flag === 'true'
}

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])
const VALID_FIELD_TYPES = new Set(['text', 'number', 'boolean', 'select', 'multi_select'])
const MAX_ACTIVE_QUESTIONS = 15

interface CreateQuestionInput {
  funnel_stage_id: string
  label: string
  field_type: string
  required: boolean
  options: string[] | null
  sort_order: number
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    jsonError(res, 405, 'Método não permitido')
    return
  }

  try {
    // Feature guard
    if (!isFeatureEnabled()) {
      jsonError(res, 503, 'Funcionalidade não disponível')
      return
    }

    // Auth
    const token = extractToken(req.headers.authorization)
    if (!token) {
      jsonError(res, 401, 'Não autenticado')
      return
    }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) {
      jsonError(res, 401, 'Token inválido ou expirado')
      return
    }

    const svc = getSupabaseAdmin()
    const body = req.body ?? {}

    // Validar campos obrigatórios
    const stageId = typeof body.funnel_stage_id === 'string' ? body.funnel_stage_id.trim() : ''
    if (!stageId) {
      jsonError(res, 400, 'funnel_stage_id é obrigatório')
      return
    }

    const label = typeof body.label === 'string' ? body.label.trim() : ''
    if (!label) {
      jsonError(res, 400, 'label é obrigatório e não pode ser vazio')
      return
    }

    const fieldType = typeof body.field_type === 'string' ? body.field_type.trim() : ''
    if (!VALID_FIELD_TYPES.has(fieldType)) {
      jsonError(res, 400, `field_type inválido — valores aceitos: ${[...VALID_FIELD_TYPES].join(', ')}`)
      return
    }

    if (typeof body.required !== 'boolean') {
      jsonError(res, 400, 'required deve ser boolean')
      return
    }

    const sortOrder = typeof body.sort_order === 'number' ? body.sort_order : 0

    // Derivar company_id: stage → funnel → company
    const { data: stage, error: stageError } = await svc
      .from('funnel_stages')
      .select('funnel_id, sales_funnels!inner(company_id)')
      .eq('id', stageId)
      .maybeSingle()

    if (stageError) {
      console.error('[stage-transition-questions/create] stageError:', stageError)
      jsonError(res, 500, 'Erro ao verificar etapa')
      return
    }

    if (!stage) {
      // Não revelar se stage não existe vs não acessível
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    const companyId = (stage.sales_funnels as any)?.company_id
    if (!companyId) {
      jsonError(res, 500, 'Erro ao derivar company_id da etapa')
      return
    }

    // Membership + RBAC
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) {
      // Não revelar detalhes de acesso
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    const callerRole = membership.role as string

    if (!ADMIN_ROLES.has(callerRole)) {
      jsonError(res, 403, 'Permissão insuficiente — requer admin, system_admin ou super_admin')
      return
    }

    // Validar funnel access
    const funnelBelongs = await assertFunnelBelongsToCompany(svc, stage.funnel_id, companyId)
    if (!funnelBelongs) {
      jsonError(res, 403, 'Acesso negado ao funil')
      return
    }

    // Validar options conforme field_type
    let normalizedOptions: string[] | null = null

    if (fieldType === 'select' || fieldType === 'multi_select') {
      if (!Array.isArray(body.options)) {
        jsonError(res, 400, `field_type ${fieldType} requer options como array`)
        return
      }

      const trimmed = body.options
        .map((opt: any) => typeof opt === 'string' ? opt.trim() : '')
        .filter((opt: string) => opt.length > 0)

      if (trimmed.length === 0) {
        jsonError(res, 400, `options não pode ser vazio para ${fieldType}`)
        return
      }

      // Verificar duplicatas (case-sensitive)
      const uniqueSet = new Set(trimmed)
      if (uniqueSet.size !== trimmed.length) {
        jsonError(res, 400, 'options contém valores duplicados')
        return
      }

      normalizedOptions = trimmed

    } else {
      // text, number, boolean → options deve ser null
      if (body.options !== null && body.options !== undefined) {
        jsonError(res, 400, `field_type ${fieldType} não aceita options`)
        return
      }
      normalizedOptions = null
    }

    // Criar pergunta
    // NOTA: O trigger check_max_active_questions garante atomicamente o limite de 15
    // Se exceder, o INSERT falhará com check_violation (23514)
    const newQuestion: any = {
      company_id: companyId,
      funnel_stage_id: stageId,
      label,
      field_type: fieldType,
      required: body.required,
      options: normalizedOptions,
      sort_order: sortOrder,
      active: true, // Nova pergunta nasce ativa
    }

    const { data: question, error: insertError } = await svc
      .from('stage_transition_questions')
      .insert(newQuestion)
      .select()
      .single()

    if (insertError) {
      console.error('[stage-transition-questions/create] insertError:', insertError)
      
      // Se for violação do limite MAX 15 (check_violation)
      if (insertError.code === '23514' && insertError.message?.includes('MAX_ACTIVE_QUESTIONS')) {
        jsonError(res, 409, `Limite de ${MAX_ACTIVE_QUESTIONS} perguntas ativas atingido para esta etapa`)
        return
      }
      
      jsonError(res, 500, 'Erro ao criar pergunta')
      return
    }

    res.status(201).json({
      ok: true,
      data: { question }
    })

  } catch (err) {
    console.error('[stage-transition-questions/create] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
