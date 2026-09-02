// =====================================================
// GET /api/stage-transition-questions/list
// Data: 02/09/2026 - Etapa D
//
// Lista todas as perguntas de uma stage para administração.
// Requer: admin, system_admin ou super_admin
//
// Query params:
//   funnel_stage_id (obrigatório)
//   include_inactive (opcional, default: false)
//
// Response: { ok: true, data: { questions: StageTransitionQuestion[] } }
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

// Roles com permissão administrativa
const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

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

    // Derivar company_id: stage → funnel → company
    const { data: stage, error: stageError } = await svc
      .from('funnel_stages')
      .select('funnel_id, sales_funnels!inner(company_id)')
      .eq('id', stageId)
      .maybeSingle()

    if (stageError) {
      console.error('[stage-transition-questions/list] stageError:', stageError)
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

    // Membership + role
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) {
      // Não revelar detalhes de acesso
      jsonError(res, 404, 'Recurso não encontrado')
      return
    }

    const callerRole = membership.role as string

    // RBAC: apenas admin+
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

    // include_inactive
    const includeInactive = req.query.include_inactive === 'true'

    // Query
    let query = svc
      .from('stage_transition_questions')
      .select('*')
      .eq('company_id', companyId)
      .eq('funnel_stage_id', stageId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })

    if (!includeInactive) {
      query = query.eq('active', true)
    }

    const { data: questions, error: queryError } = await query

    if (queryError) {
      console.error('[stage-transition-questions/list] queryError:', queryError)
      jsonError(res, 500, 'Erro ao buscar perguntas')
      return
    }

    res.status(200).json({
      ok: true,
      data: { questions: questions ?? [] }
    })

  } catch (err) {
    console.error('[stage-transition-questions/list] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
