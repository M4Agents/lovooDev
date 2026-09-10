// =====================================================
// DELETE /api/stage-transition-questions/delete
// Data: 10/09/2026
//
// Exclui permanentemente uma pergunta de transição.
// Requer: admin, system_admin ou super_admin
//
// Body:
//   question_id (obrigatório)
//
// Restrições:
//   - Pergunta com respostas NÃO pode ser excluída (409)
//     → Use PUT /set-active para desativar nesses casos
//   - FK ON DELETE RESTRICT protege o histórico no banco
//
// Response: { ok: true, data: { deleted: true } }
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
  return process.env.FEATURE_STAGE_TRANSITION_QUESTIONS === 'true'
}

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'DELETE') {
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

    // Buscar pergunta com dados do funil para derivar company_id
    const { data: existingQuestion, error: fetchError } = await svc
      .from('stage_transition_questions')
      .select('*, funnel_stages!inner(funnel_id, sales_funnels!inner(company_id))')
      .eq('id', questionId)
      .maybeSingle()

    if (fetchError) {
      console.error('[stage-transition-questions/delete] fetchError:', fetchError)
      jsonError(res, 500, 'Erro ao buscar pergunta')
      return
    }

    if (!existingQuestion) {
      // Não revelar se a pergunta não existe vs não acessível
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    // Derivar company_id e funnel_id
    const companyId = (existingQuestion.funnel_stages as any)?.sales_funnels?.company_id
    const funnelId  = (existingQuestion.funnel_stages as any)?.funnel_id

    if (!companyId || !funnelId) {
      jsonError(res, 500, 'Erro ao derivar company_id da pergunta')
      return
    }

    // Membership + RBAC
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) {
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    if (!ADMIN_ROLES.has(membership.role as string)) {
      jsonError(res, 403, 'Permissão insuficiente — requer admin, system_admin ou super_admin')
      return
    }

    // Validar acesso ao funil
    const funnelBelongs = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
    if (!funnelBelongs) {
      jsonError(res, 403, 'Acesso negado ao funil')
      return
    }

    // Verificar respostas registradas — FK RESTRICT bloquearia no banco, mas melhor retornar
    // mensagem amigável antes de tentar o DELETE
    const { count: answerCount, error: answerError } = await svc
      .from('stage_transition_answers')
      .select('*', { count: 'exact', head: true })
      .eq('question_id', questionId)
      .eq('company_id', companyId)

    if (answerError) {
      console.error('[stage-transition-questions/delete] answerError:', answerError)
      jsonError(res, 500, 'Erro ao verificar respostas')
      return
    }

    if ((answerCount ?? 0) > 0) {
      jsonError(
        res,
        409,
        'Não é possível excluir uma pergunta com respostas registradas. Desative a pergunta para removê-la do fluxo.'
      )
      return
    }

    // Excluir
    const { error: deleteError } = await svc
      .from('stage_transition_questions')
      .delete()
      .eq('id', questionId)
      .eq('company_id', companyId)

    if (deleteError) {
      console.error('[stage-transition-questions/delete] deleteError:', deleteError)
      jsonError(res, 500, 'Erro ao excluir pergunta')
      return
    }

    res.status(200).json({
      ok: true,
      data: { deleted: true }
    })

  } catch (err) {
    console.error('[stage-transition-questions/delete] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
