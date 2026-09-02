// =====================================================
// PUT /api/stage-transition-questions/set-stage-enabled
// Data: 02/09/2026 - Etapa D
//
// Habilita ou desabilita perguntas de transição para uma stage.
// Altera: funnel_stages.enable_transition_questions
//
// Requer: admin, system_admin ou super_admin
//
// Body:
//   funnel_stage_id (obrigatório)
//   enabled (obrigatório: boolean)
//
// Validações:
//   - Stage deve existir
//   - Usuário deve ter acesso ao funnel
//
// Response: { ok: true, data: { stage: { id, enable_transition_questions } } }
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

    // funnel_stage_id
    const stageId = typeof body.funnel_stage_id === 'string' ? body.funnel_stage_id.trim() : ''
    if (!stageId) {
      jsonError(res, 400, 'funnel_stage_id é obrigatório')
      return
    }

    // enabled
    if (typeof body.enabled !== 'boolean') {
      jsonError(res, 400, 'enabled deve ser boolean')
      return
    }

    const targetEnabled = body.enabled

    // Derivar company_id: stage → funnel → company
    const { data: stage, error: stageError } = await svc
      .from('funnel_stages')
      .select('id, funnel_id, enable_transition_questions, sales_funnels!inner(company_id)')
      .eq('id', stageId)
      .maybeSingle()

    if (stageError) {
      console.error('[stage-transition-questions/set-stage-enabled] stageError:', stageError)
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

    // Se já está no estado desejado, retornar sucesso
    const currentEnabled = stage.enable_transition_questions ?? false
    if (currentEnabled === targetEnabled) {
      return res.status(200).json({
        ok: true,
        data: {
          stage: {
            id: stage.id,
            enable_transition_questions: currentEnabled
          }
        }
      })
    }

    // Atualizar
    const { data: updatedStage, error: updateError } = await svc
      .from('funnel_stages')
      .update({ enable_transition_questions: targetEnabled })
      .eq('id', stageId)
      .select('id, enable_transition_questions')
      .single()

    if (updateError) {
      console.error('[stage-transition-questions/set-stage-enabled] updateError:', updateError)
      jsonError(res, 500, 'Erro ao atualizar configuração da etapa')
      return
    }

    res.status(200).json({
      ok: true,
      data: { stage: updatedStage }
    })

  } catch (err) {
    console.error('[stage-transition-questions/set-stage-enabled] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
