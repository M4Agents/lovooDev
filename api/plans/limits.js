// =============================================================================
// GET /api/plans/limits
//
// Retorna os limites do plano da empresa autenticada (ou de uma empresa filha
// específica, quando chamado por empresa pai).
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   ?company_id=<UUID> (obrigatório para empresa pai)
//
// RESPOSTA:
//   200 { limits: PlanLimits }
//   401 Token inválido
//   403 Sem acesso
//   500 Erro interno
//
// USO:
//   - Frontend: para exibir limites do plano ao usuário
//   - Backend: para gates de enforcement (fase futura)
//   - Nunca expõe campos de governança interna (internal_price, etc.)
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'
import { getPlanLimits }         from '../lib/plans/limitChecker.js'

/**
 * Calcula estatísticas de storage para exibição no frontend.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} companyId
 * @param {number|null} maxMb - null = ilimitado
 * @returns {Promise<{ used_mb: number|null, max_mb: number|null, pct: number|null }>}
 */
async function getStorageStats(svc, companyId, maxMb) {
  const { data, error } = await svc.rpc('get_company_storage_used_mb', {
    p_company_id: companyId,
  })

  if (error) {
    console.warn('[GET /api/plans/limits] Erro ao calcular storage:', error.message)
    return { used_mb: null, max_mb: maxMb, pct: null }
  }

  const usedMb = Math.round((parseFloat(data) || 0) * 100) / 100

  if (maxMb === null) {
    return { used_mb: usedMb, max_mb: null, pct: null }
  }

  const pct = maxMb > 0 ? Math.round((usedMb / maxMb) * 100 * 10) / 10 : 100
  return { used_mb: usedMb, max_mb: maxMb, pct }
}

/**
 * Calcula estatísticas de leads para alertas de proximidade de plano.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} companyId
 * @param {number|null} maxLeads - null = ilimitado
 * @returns {Promise<{ current: number, over_plan: number, max: number|null, proximity_pct: number|null, alert_level: string }>}
 */
async function getLeadStats(svc, companyId, maxLeads) {
  // Ilimitado: sem contagem necessária
  if (maxLeads === null) {
    return { current: null, over_plan: 0, max: null, proximity_pct: null, alert_level: 'unlimited' }
  }

  const [totalRes, overPlanRes] = await Promise.all([
    svc.from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('deleted_at', null),
    svc.from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_over_plan', true)
      .is('deleted_at', null),
  ])

  const current  = totalRes.count    ?? 0
  const overPlan = overPlanRes.count ?? 0
  const pct      = maxLeads > 0 ? Math.round((current / maxLeads) * 100 * 10) / 10 : 100

  let alertLevel
  if (overPlan > 0 || pct >= 100) {
    alertLevel = 'critical'
  } else if (pct >= 90) {
    alertLevel = 'danger'
  } else if (pct >= 80) {
    alertLevel = 'warning'
  } else {
    alertLevel = 'ok'
  }

  return { current, over_plan: overPlan, max: maxLeads, proximity_pct: pct, alert_level: alertLevel }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Resolver contexto de autenticação e multi-tenant ──────────────────

  const queryCompanyId = req.query?.company_id ?? null

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ error: ctx.error })
  }

  const { svc, effectiveCompanyId } = ctx

  // ── 2. Buscar limites do plano ────────────────────────────────────────────

  try {
    const limits          = await getPlanLimits(svc, effectiveCompanyId)
    const [leadStatsReal, storageStats] = await Promise.all([
      getLeadStats(svc, effectiveCompanyId, limits.max_leads),
      getStorageStats(svc, effectiveCompanyId, limits.storage_mb),
    ])

    // Nunca retornar campos de governança interna (internal_price está em ai_plans)
    // A resposta é segura para exibição ao frontend da empresa filha.

    return res.status(200).json({
      ok: true,
      company_id: effectiveCompanyId,
      has_plan:   limits.has_plan,
      plan: {
        id:   limits.plan_id,
        name: limits.plan_name,
        slug: limits.plan_slug,
      },
      ai_plan: {
        id:              limits.ai_plan_id,
        name:            limits.ai_plan_name,
        monthly_credits: limits.ai_plan_monthly_credits,
      },
      limits: {
        max_whatsapp_instances:            limits.max_whatsapp_instances,
        max_leads:                         limits.max_leads,
        max_users:                         limits.max_users,
        max_funnels:                       limits.max_funnels,
        max_funnel_stages:                 limits.max_funnel_stages,
        max_automation_flows:              limits.max_automation_flows,
        max_automation_executions_monthly: limits.max_automation_executions_monthly,
        max_products:                      limits.max_products,
        storage_mb:                        limits.storage_mb,
      },
      features:   limits.features,
      // Estatísticas de leads para alertas de proximidade e modal de "leads fora do plano"
      // alert_level: 'unlimited' | 'ok' | 'warning' (≥80%) | 'danger' (≥90%) | 'critical' (≥100% ou over_plan > 0)
      lead_stats: leadStatsReal,
      // Estatísticas de storage: used_mb, max_mb (null = ilimitado), pct (null = ilimitado)
      storage_stats: storageStats,
    })
  } catch (err) {
    console.error('[GET /api/plans/limits] Erro:', err)
    return res.status(500).json({ error: 'Erro interno ao buscar limites' })
  }
}
