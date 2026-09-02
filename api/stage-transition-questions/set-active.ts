// =====================================================
// PUT /api/stage-transition-questions/set-active
// Data: 02/09/2026 - Etapa D
//
// Ativa ou desativa uma pergunta.
// Requer: admin, system_admin ou super_admin
//
// Body:
//   question_id (obrigatório)
//   active (obrigatório: boolean)
//
// Validações:
//   - Se ativar (false → true), verifica limite MAX 15
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
const MAX_ACTIVE_QUESTIONS = 15

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

    // active
    if (typeof body.active !== 'boolean') {
      jsonError(res, 400, 'active deve ser boolean')
      return
    }

    const targetActive = body.active

    // Buscar pergunta existente
    const { data: existingQuestion, error: fetchError } = await svc
      .from('stage_transition_questions')
      .select('*, funnel_stages!inner(funnel_id, sales_funnels!inner(company_id))')
      .eq('id', questionId)
      .maybeSingle()

    if (fetchError) {
      console.error('[stage-transition-questions/set-active] fetchError:', fetchError)
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
    const stageId = existingQuestion.funnel_stage_id

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

    // Se já está no estado desejado, retornar sucesso
    if (existingQuestion.active === targetActive) {
      return res.status(200).json({
        ok: true,
        data: { question: existingQuestion }
      })
    }

    // Atualizar
    // NOTA: O trigger check_max_active_questions garante atomicamente o limite de 15
    // Se tentar ativar excedendo o limite, o UPDATE falhará com check_violation (23514)
    const { data: updatedQuestion, error: updateError } = await svc
      .from('stage_transition_questions')
      .update({ active: targetActive })
      .eq('id', questionId)
      .eq('company_id', companyId)
      .select()
      .single()

    if (updateError) {
      console.error('[stage-transition-questions/set-active] updateError:', updateError)
      
      // Se for violação do limite MAX 15 (check_violation)
      if (updateError.code === '23514' && updateError.message?.includes('MAX_ACTIVE_QUESTIONS')) {
        jsonError(res, 409, `Limite de ${MAX_ACTIVE_QUESTIONS} perguntas ativas atingido para esta etapa`)
        return
      }
      
      jsonError(res, 500, 'Erro ao atualizar status da pergunta')
      return
    }

    res.status(200).json({
      ok: true,
      data: { question: updatedQuestion }
    })

  } catch (err) {
    console.error('[stage-transition-questions/set-active] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
