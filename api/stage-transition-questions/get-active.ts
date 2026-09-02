// =====================================================
// GET /api/stage-transition-questions/get-active
// Data: 02/09/2026 - Etapa D
//
// Busca perguntas ATIVAS de uma stage para uso em runtime.
// Será usada futuramente pelo FunnelBoard.
//
// NÃO requer role admin (apenas acesso ao funil).
//
// Query params:
//   funnel_stage_id (obrigatório)
//
// Response: { ok: true, data: { questions: StageTransitionQuestion[] } }
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
      .select('funnel_id, sales_funnels!inner(company_id)')
      .eq('id', stageId)
      .maybeSingle()

    if (stageError) {
      console.error('[stage-transition-questions/get-active] stageError:', stageError)
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
      // Não revelar detalhes de acesso
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
      jsonError(res, 403, 'Acesso negado ao funil')
      return
    }

    // Query: apenas active=true, ordenado por sort_order
    const { data: questions, error: queryError } = await svc
      .from('stage_transition_questions')
      .select('*')
      .eq('company_id', companyId)
      .eq('funnel_stage_id', stageId)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })

    if (queryError) {
      console.error('[stage-transition-questions/get-active] queryError:', queryError)
      jsonError(res, 500, 'Erro ao buscar perguntas')
      return
    }

    res.status(200).json({
      ok: true,
      data: { questions: questions ?? [] }
    })

  } catch (err) {
    console.error('[stage-transition-questions/get-active] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
