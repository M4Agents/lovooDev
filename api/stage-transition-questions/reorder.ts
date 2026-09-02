// =====================================================
// PUT /api/stage-transition-questions/reorder
// Data: 02/09/2026 - Etapa D
//
// Reordena perguntas de uma stage.
// Requer: admin, system_admin ou super_admin
//
// Body:
//   funnel_stage_id (obrigatório)
//   question_order (obrigatório: array de { id, sort_order })
//
// Validações:
//   - Todas as perguntas devem existir
//   - Todas devem pertencer à mesma stage
//   - Todas devem pertencer à mesma company
//   - Sem IDs duplicados
//
// Response: { ok: true, data: { updated_count: number } }
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

interface QuestionOrder {
  id: string
  sort_order: number
}

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

    // funnel_stage_id
    const stageId = typeof body.funnel_stage_id === 'string' ? body.funnel_stage_id.trim() : ''
    if (!stageId) {
      jsonError(res, 400, 'funnel_stage_id é obrigatório')
      return
    }

    // question_order
    if (!Array.isArray(body.question_order)) {
      jsonError(res, 400, 'question_order deve ser array')
      return
    }

    const questionOrder: QuestionOrder[] = body.question_order

    if (questionOrder.length === 0) {
      jsonError(res, 400, 'question_order não pode ser vazio')
      return
    }

    // Validar estrutura
    for (const item of questionOrder) {
      if (typeof item.id !== 'string' || !item.id.trim()) {
        jsonError(res, 400, 'Cada item de question_order deve ter id (string)')
        return
      }
      if (typeof item.sort_order !== 'number') {
        jsonError(res, 400, 'Cada item de question_order deve ter sort_order (number)')
        return
      }
    }

    // Verificar IDs duplicados
    const ids = questionOrder.map(q => q.id)
    const uniqueIds = new Set(ids)
    if (uniqueIds.size !== ids.length) {
      jsonError(res, 400, 'question_order contém IDs duplicados')
      return
    }

    // Derivar company_id: stage → funnel → company
    const { data: stage, error: stageError } = await svc
      .from('funnel_stages')
      .select('funnel_id, sales_funnels!inner(company_id)')
      .eq('id', stageId)
      .maybeSingle()

    if (stageError) {
      console.error('[stage-transition-questions/reorder] stageError:', stageError)
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

    // Chamar RPC atômico reorder_stage_transition_questions
    // Este RPC:
    // - Valida IDs únicos
    // - Valida existência das perguntas
    // - Valida mesma stage e company
    // - Atualiza atomicamente (all-or-nothing)
    // - Usa advisory lock para prevenir race

    const { data: result, error: rpcError } = await svc.rpc(
      'reorder_stage_transition_questions',
      {
        p_company_id: companyId,
        p_funnel_stage_id: stageId,
        p_question_order: questionOrder
      }
    )

    if (rpcError) {
      console.error('[stage-transition-questions/reorder] rpcError:', rpcError)
      
      // Mapear erros específicos do RPC
      const errorMessage = rpcError.message || ''
      
      if (errorMessage.includes('INVALID_INPUT')) {
        jsonError(res, 400, 'Dados de entrada inválidos')
        return
      }
      
      if (errorMessage.includes('DUPLICATE_QUESTION_ID')) {
        jsonError(res, 400, 'question_order contém IDs duplicados')
        return
      }
      
      if (errorMessage.includes('UNKNOWN_QUESTION')) {
        jsonError(res, 400, 'Uma ou mais perguntas não foram encontradas')
        return
      }
      
      if (errorMessage.includes('INVALID_STAGE')) {
        jsonError(res, 400, 'Uma ou mais perguntas não pertencem à etapa especificada')
        return
      }
      
      if (errorMessage.includes('PERMISSION_DENIED')) {
        jsonError(res, 403, 'Acesso negado')
        return
      }
      
      jsonError(res, 500, 'Erro ao reordenar perguntas')
      return
    }

    res.status(200).json({
      ok: true,
      data: result
    })

  } catch (err) {
    console.error('[stage-transition-questions/reorder] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
