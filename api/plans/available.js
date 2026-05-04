// =============================================================================
// GET /api/plans/available
//
// Retorna os planos disponíveis para a empresa autenticada com comparação de uso.
// Usado na tela "Configurações / Planos e Uso" para exibir opções de upgrade/downgrade.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//
// RESPOSTA:
//   200 {
//     ok: true,
//     current_plan_id: string | null,
//     usage: UsageSnapshot,
//     plans: PlanCard[],
//     pending_request: PendingRequest | null
//   }
//
// SEGURANÇA:
//   - Nunca aceita company_id do body sem validação de membership
//   - Filtra apenas is_active=true AND is_publicly_listed=true
//   - Usa service_role internamente; token do usuário apenas para autenticação
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'
import { getPlanLimits }         from '../lib/plans/limitChecker.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Autenticação e contexto multi-tenant ──────────────────────────────
  const queryCompanyId = req.query?.company_id ?? null
  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ error: ctx.error })
  }

  const { svc, effectiveCompanyId } = ctx

  try {
    // ── 2. Limites e uso atual da empresa ────────────────────────────────────
    const currentLimits = await getPlanLimits(svc, effectiveCompanyId)
    const currentPlanId = currentLimits.plan_id

    // ── 3. Uso atual dos recursos (para validação de downgrade) ──────────────
    const [
      leadsRes,
      usersRes,
      funnelsRes,
      autoFlowsRes,
      storageRes,
    ] = await Promise.all([
      svc.from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId)
        .is('deleted_at', null),
      svc.from('company_users')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId)
        .eq('is_active', true)
        .eq('is_platform_member', false),
      svc.from('sales_funnels')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId)
        .eq('is_active', true),
      svc.from('automation_flows')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId)
        .eq('is_active', true),
      svc.rpc('get_company_storage_used_mb', { p_company_id: effectiveCompanyId }),
    ])

    const usage = {
      leads:      leadsRes.count     ?? 0,
      users:      usersRes.count     ?? 0,
      funnels:    funnelsRes.count   ?? 0,
      auto_flows: autoFlowsRes.count ?? 0,
      storage_mb: Math.ceil(parseFloat(storageRes.data) || 0),
    }

    // ── 4. Buscar planos disponíveis para auto-serviço ───────────────────────
    const { data: plans, error: plansError } = await svc
      .from('plans')
      .select(
        'id, name, slug, sort_order, is_popular,' +
        'max_leads, max_users, max_funnels, max_funnel_stages,' +
        'max_automation_flows, max_automation_executions_monthly,' +
        'max_products, max_whatsapp_instances, storage_mb, features,' +
        'stripe_price_id_monthly'
      )
      .eq('is_active', true)
      .eq('is_publicly_listed', true)
      .order('sort_order', { ascending: true })

    if (plansError) {
      console.error('[GET /api/plans/available] Erro ao buscar planos:', plansError.message)
      return res.status(500).json({ error: 'Erro ao buscar planos disponíveis' })
    }

    // ── 5. Buscar pedido pendente da empresa ──────────────────────────────────
    const { data: pendingReq } = await svc
      .from('plan_change_requests')
      .select('id, to_plan_id, status, created_at, plans!to_plan_id(name, slug)')
      .eq('company_id', effectiveCompanyId)
      .eq('status', 'pending')
      .maybeSingle()

    // ── 6. Enriquecer cada plano com comparação de uso ────────────────────────
    const enrichedPlans = (plans ?? []).map(plan => {
      const isCurrent = plan.id === currentPlanId

      let direction = 'same'
      if (!isCurrent && currentPlanId) {
        const currentPlan = plans.find(p => p.id === currentPlanId)
        if (currentPlan) {
          direction = plan.sort_order > currentPlan.sort_order ? 'upgrade' : 'downgrade'
        } else {
          direction = 'upgrade'
        }
      }
      if (isCurrent) direction = 'current'

      const blockedBy = []
      const checks = [
        { key: 'max_leads',            current: usage.leads,      limit: plan.max_leads },
        { key: 'max_users',            current: usage.users,      limit: plan.max_users },
        { key: 'max_funnels',          current: usage.funnels,    limit: plan.max_funnels },
        { key: 'max_automation_flows', current: usage.auto_flows, limit: plan.max_automation_flows },
        { key: 'storage_mb',           current: usage.storage_mb, limit: plan.storage_mb },
      ]
      for (const { key, current, limit } of checks) {
        if (limit !== null && current > limit) blockedBy.push(key)
      }

      return {
        ...plan,
        is_current:           isCurrent,
        direction,
        is_accessible:        blockedBy.length === 0,
        blocked_by:           blockedBy,
        is_stripe_purchasable: !!plan.stripe_price_id_monthly,
      }
    })

    // Supabase retorna o join como objeto ou array dependendo da relação.
    // Normalmente para FK singular retorna objeto, mas tratamos ambos por segurança.
    const pendingPlanData = pendingReq?.plans
    const pendingPlanName = Array.isArray(pendingPlanData)
      ? (pendingPlanData[0]?.name ?? null)
      : (pendingPlanData?.name ?? null)
    const pendingPlanSlug = Array.isArray(pendingPlanData)
      ? (pendingPlanData[0]?.slug ?? null)
      : (pendingPlanData?.slug ?? null)

    return res.status(200).json({
      ok:              true,
      current_plan_id: currentPlanId,
      usage,
      plans:           enrichedPlans,
      pending_request: pendingReq
        ? {
            id:           pendingReq.id,
            to_plan_id:   pendingReq.to_plan_id,
            to_plan_name: pendingPlanName,
            to_plan_slug: pendingPlanSlug,
            status:       pendingReq.status,
            created_at:   pendingReq.created_at,
          }
        : null,
    })
  } catch (err) {
    console.error('[GET /api/plans/available] Erro:', err)
    return res.status(500).json({ error: 'Erro interno ao buscar planos disponíveis' })
  }
}
