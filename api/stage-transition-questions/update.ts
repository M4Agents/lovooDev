// =====================================================
// PUT /api/stage-transition-questions/update
// Data: 02/09/2026 - Etapa D
//
// Atualiza pergunta existente.
// Requer: admin, system_admin ou super_admin
//
// Body:
//   question_id (obrigatório)
//   label (opcional)
//   required (opcional: boolean)
//   sort_order (opcional: number)
//
// IMUTÁVEL após resposta:
//   - field_type
//   - options
//   - funnel_stage_id
//
// Campos editáveis:
//   - label
//   - required
//   - sort_order
//   - active (via endpoint separado set-active)
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

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'PUT') {
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

    // question_id
    const questionId = typeof body.question_id === 'string' ? body.question_id.trim() : ''
    if (!questionId) {
      jsonError(res, 400, 'question_id é obrigatório')
      return
    }

    // Buscar pergunta existente
    const { data: existingQuestion, error: fetchError } = await svc
      .from('stage_transition_questions')
      .select('*, funnel_stages!inner(funnel_id, sales_funnels!inner(company_id))')
      .eq('id', questionId)
      .maybeSingle()

    if (fetchError) {
      console.error('[stage-transition-questions/update] fetchError:', fetchError)
      jsonError(res, 500, 'Erro ao buscar pergunta')
      return
    }

    if (!existingQuestion) {
      // Não revelar se question não existe vs não acessível
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    // Derivar company_id
    const companyId = (existingQuestion.funnel_stages as any)?.sales_funnels?.company_id
    const funnelId = (existingQuestion.funnel_stages as any)?.funnel_id

    if (!companyId || !funnelId) {
      jsonError(res, 500, 'Erro ao derivar company_id da pergunta')
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
    const funnelBelongs = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
    if (!funnelBelongs) {
      jsonError(res, 403, 'Acesso negado ao funil')
      return
    }

    // Verificar imutabilidade: se já existe resposta, field_type e options são IMUTÁVEIS
    const { count: answerCount, error: answerError } = await svc
      .from('stage_transition_answers')
      .select('*', { count: 'exact', head: true })
      .eq('question_id', questionId)

    if (answerError) {
      console.error('[stage-transition-questions/update] answerError:', answerError)
      jsonError(res, 500, 'Erro ao verificar imutabilidade')
      return
    }

    const hasAnswers = (answerCount ?? 0) > 0

    // Rejeitar tentativa de alterar campos imutáveis
    if (hasAnswers) {
      if ('field_type' in body) {
        jsonError(res, 409, 'field_type não pode ser alterado após respostas existentes')
        return
      }
      if ('options' in body) {
        jsonError(res, 409, 'options não pode ser alterado após respostas existentes')
        return
      }
    }

    // Rejeitar tentativa de alterar funnel_stage_id (sempre imutável)
    if ('funnel_stage_id' in body) {
      jsonError(res, 400, 'funnel_stage_id não pode ser alterado após criação')
      return
    }

    // Preparar updates permitidos
    const updates: any = {}

    if ('label' in body) {
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      if (!label) {
        jsonError(res, 400, 'label não pode ser vazio')
        return
      }
      updates.label = label
    }

    if ('required' in body) {
      if (typeof body.required !== 'boolean') {
        jsonError(res, 400, 'required deve ser boolean')
        return
      }
      updates.required = body.required
    }

    if ('sort_order' in body) {
      if (typeof body.sort_order !== 'number') {
        jsonError(res, 400, 'sort_order deve ser number')
        return
      }
      updates.sort_order = body.sort_order
    }

    if (Object.keys(updates).length === 0) {
      jsonError(res, 400, 'Nenhum campo válido fornecido para atualização')
      return
    }

    // Atualizar
    const { data: updatedQuestion, error: updateError } = await svc
      .from('stage_transition_questions')
      .update(updates)
      .eq('id', questionId)
      .eq('company_id', companyId)
      .select()
      .single()

    if (updateError) {
      console.error('[stage-transition-questions/update] updateError:', updateError)
      jsonError(res, 500, 'Erro ao atualizar pergunta')
      return
    }

    res.status(200).json({
      ok: true,
      data: { question: updatedQuestion }
    })

  } catch (err) {
    console.error('[stage-transition-questions/update] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
