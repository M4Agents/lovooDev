// =====================================================
// GET  /api/dashboard/ranking-scope?company_id=UUID
// POST /api/dashboard/ranking-scope
//
// Escopo de funis e etapas ativas do Ranking Comercial.
// Ganhou e Perdeu não são configuráveis.
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { logDashboardError } from '../lib/dashboard/observability.js'
import {
  ADMIN_ROLES,
  RANKING_SCOPE_DEFAULTS,
  validateRankingScopeSettings,
  type RankingScopeSettings,
} from '../lib/dashboard/alertSettingsDefaults.js'

function isUUID(v: unknown): v is string {
  return typeof v === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method === 'GET')  return handleGet(req, res)
  if (req.method === 'POST') return handlePost(req, res)
  jsonError(res, 405, 'Método não permitido')
}

async function handleGet(req: any, res: any): Promise<void> {
  try {
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!isUUID(companyId)) { jsonError(res, 400, 'company_id inválido ou ausente'); return }

    const svc = getSupabaseAdmin()
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    const { data, error } = await svc
      .from('dashboard_alert_settings')
      .select('ranking_scope_settings, updated_at')
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) {
      logDashboardError('dashboard.ranking-scope.get', error, { companyId })
      jsonError(res, 500, 'Erro ao buscar o escopo do ranking'); return
    }

    if (!data) {
      return res.status(200).json({
        ok: true,
        data: RANKING_SCOPE_DEFAULTS,
        meta: { is_default: true },
      })
    }

    return res.status(200).json({
      ok: true,
      data: (data.ranking_scope_settings as RankingScopeSettings) ?? RANKING_SCOPE_DEFAULTS,
      meta: { is_default: false, updated_at: data.updated_at as string },
    })
  } catch (err: unknown) {
    logDashboardError('dashboard.ranking-scope.get', err, {
      endpoint: '/api/dashboard/ranking-scope',
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

async function handlePost(req: any, res: any): Promise<void> {
  try {
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const body = req.body ?? {}
    const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : ''
    if (!isUUID(companyId)) { jsonError(res, 400, 'company_id inválido ou ausente'); return }

    const svc = getSupabaseAdmin()
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }
    if (!ADMIN_ROLES.has(membership.role)) {
      jsonError(res, 403, 'Permissão insuficiente — necessário admin ou superior'); return
    }

    const shapeErr = validateRankingScopeSettings(body.ranking_scope_settings)
    if (shapeErr) { jsonError(res, 400, shapeErr); return }

    const scope = body.ranking_scope_settings as RankingScopeSettings
    const stored: RankingScopeSettings = scope.mode === 'all'
      ? { mode: 'all' }
      : await assertCustomScope(svc, companyId, scope, res)

    if (!stored) return

    const { data: saved, error } = await svc
      .from('dashboard_alert_settings')
      .upsert(
        {
          company_id: companyId,
          ranking_scope_settings: stored,
          updated_by: user.id,
        },
        { onConflict: 'company_id' },
      )
      .select('ranking_scope_settings, updated_at')
      .single()

    if (error) {
      logDashboardError('dashboard.ranking-scope.post', error, { companyId })
      jsonError(res, 500, 'Erro ao salvar o escopo do ranking'); return
    }

    return res.status(200).json({
      ok: true,
      data: saved.ranking_scope_settings as RankingScopeSettings,
      meta: { is_default: false, updated_at: saved.updated_at as string },
    })
  } catch (err: unknown) {
    logDashboardError('dashboard.ranking-scope.post', err, {
      endpoint: '/api/dashboard/ranking-scope',
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

async function assertCustomScope(
  svc: any,
  companyId: string,
  scope: RankingScopeSettings,
  res: any,
): Promise<RankingScopeSettings | null> {
  const funnelIds = scope.funnel_ids ?? []
  const stageIds = scope.stage_ids ?? []

  const { data: funnels, error: funnelError } = await svc
    .from('sales_funnels')
    .select('id')
    .eq('company_id', companyId)
    .in('id', funnelIds)

  if (funnelError) {
    logDashboardError('dashboard.ranking-scope.post.funnels', funnelError, { companyId })
    jsonError(res, 500, 'Erro ao validar funis'); return null
  }

  if ((funnels ?? []).length !== funnelIds.length) {
    jsonError(res, 400, 'ranking_scope_settings: funil inválido ou de outra empresa'); return null
  }

  const { data: stages, error: stageError } = await svc
    .from('funnel_stages')
    .select('id, funnel_id, stage_type')
    .in('id', stageIds)

  if (stageError) {
    logDashboardError('dashboard.ranking-scope.post.stages', stageError, { companyId })
    jsonError(res, 500, 'Erro ao validar etapas'); return null
  }

  const byId = new Map((stages ?? []).map((stage: { id: string; funnel_id: string; stage_type: string }) => [stage.id, stage]))
  const allowedFunnels = new Set(funnelIds)

  for (const id of stageIds) {
    const stage = byId.get(id)
    if (!stage || !allowedFunnels.has(stage.funnel_id)) {
      jsonError(res, 400, 'ranking_scope_settings: etapa inválida ou de outro funil'); return null
    }
    if (stage.stage_type !== 'active') {
      jsonError(res, 400, 'Ganhou e Perdeu são fixas e não podem ser marcadas'); return null
    }
  }

  return { mode: 'custom', funnel_ids: funnelIds, stage_ids: stageIds }
}
