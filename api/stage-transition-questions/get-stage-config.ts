// =====================================================
// GET /api/stage-transition-questions/get-stage-config
// Data: 02/09/2026 - Etapa F.5 Hardening
//
// Retorna configuração explícita de stage transition questions:
//   - enable_transition_questions (boolean)
//   - activeQuestionCount (number)
//
// NÃO requer role admin (apenas acesso ao funil).
//
// Query params:
//   funnel_stage_id (obrigatório)
//
// Response: { 
//   ok: true, 
//   data: { 
//     enabled: boolean, 
//     activeQuestionCount: number 
//   } 
// }
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  assertUserFunnelAccess,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'

// Feature flag server-side
function isFeatureEnabled(): boolean {
  const flag = process.env.FEATURE_STAGE_TRANSITION_QUESTIONS
  return flag === 'true'
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'GET') {
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

    // funnel_stage_id
    const stageId = typeof req.query.funnel_stage_id === 'string'
      ? req.query.funnel_stage_id.trim()
      : ''

    if (!stageId) {
      jsonError(res, 400, 'funnel_stage_id é obrigatório')
      return
    }

    // Derivar company_id + funnel_id: stage → funnel → company
    const { data: stage, error: stageError } = await svc
      .from('funnel_stages')
      .select('funnel_id, enable_transition_questions, sales_funnels!inner(company_id)')
      .eq('id', stageId)
      .maybeSingle()

    if (stageError) {
      console.error('[stage-transition-questions/get-stage-config] stageError:', stageError)
      jsonError(res, 500, 'Erro ao verificar etapa')
      return
    }

    if (!stage) {
      // Não revelar se stage não existe vs não acessível
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    const funnelId = stage.funnel_id
    const companyId = (stage.sales_funnels as any)?.company_id

    if (!companyId || !funnelId) {
      jsonError(res, 500, 'Erro ao derivar company_id/funnel_id da etapa')
      return
    }

    // Membership
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) {
      // Não revelar se company não acessível
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    const callerRole = membership.role as string

    // Funnel access (seller/manager restrictions)
    const funnelAccess = await assertUserFunnelAccess({
      svc,
      userId: user.id,
      companyId,
      role: callerRole,
      funnelId
    })

    if (!funnelAccess.ok) {
      // Não revelar detalhes de acesso
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    // Validar que funnel pertence à company (defesa adicional)
    const funnelBelongs = await assertFunnelBelongsToCompany(svc, funnelId, companyId)
    if (!funnelBelongs) {
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    // Contar perguntas ativas
    const { count: activeCount, error: countError } = await svc
      .from('stage_transition_questions')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('funnel_stage_id', stageId)
      .eq('active', true)

    if (countError) {
      console.error('[stage-transition-questions/get-stage-config] countError:', countError)
      jsonError(res, 500, 'Erro ao contar perguntas ativas')
      return
    }

    // Enabled state explícito (padrão: false)
    const enabled = stage.enable_transition_questions ?? false

    res.status(200).json({
      ok: true,
      data: {
        enabled,
        activeQuestionCount: activeCount ?? 0
      }
    })

  } catch (err) {
    console.error('[stage-transition-questions/get-stage-config] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
