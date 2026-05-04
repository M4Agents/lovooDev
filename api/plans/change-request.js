// =============================================================================
// POST /api/plans/change-request
// DELETE /api/plans/change-request   (cancelar pedido pendente)
//
// Registra ou cancela uma solicitação de mudança de plano.
// O plano NÃO é alterado automaticamente — exige aprovação do admin da plataforma.
//
// POST body: { to_plan_id: string }
//
// RESPOSTA POST:
//   201 { ok: true, request_id: string }
//   400 { error: 'plan_not_available' | 'already_has_pending_request' | 'downgrade_blocked', blocked_by?: string[] }
//   401/403 erro de autenticação
//   500 erro interno
//
// RESPOSTA DELETE:
//   200 { ok: true }
//   404 { error: 'no_pending_request' }
//
// SEGURANÇA:
//   - to_plan_id é validado no banco (is_active + is_publicly_listed)
//   - Nunca altera companies.plan_id diretamente
//   - Validação de downgrade via uso atual
// =============================================================================

import { resolveCreditsContext } from '../lib/credits/authContext.js'
import { getPlanLimits }         from '../lib/plans/limitChecker.js'

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Autenticação e contexto multi-tenant ──────────────────────────────
  const ctx = await resolveCreditsContext(req, null)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ error: ctx.error })
  }

  const { svc, effectiveCompanyId } = ctx

  // ── CANCELAR pedido pendente ─────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { data, error } = await svc
      .from('plan_change_requests')
      .update({ status: 'cancelled' })
      .eq('company_id', effectiveCompanyId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[DELETE /api/plans/change-request] Erro:', error.message)
      return res.status(500).json({ error: 'Erro ao cancelar solicitação' })
    }

    if (!data) {
      return res.status(404).json({ error: 'no_pending_request' })
    }

    return res.status(200).json({ ok: true })
  }

  // ── CRIAR novo pedido ────────────────────────────────────────────────────
  const { to_plan_id } = req.body ?? {}

  if (!to_plan_id) {
    return res.status(400).json({ error: 'to_plan_id é obrigatório' })
  }

  try {
    // ── 2. Validar que o plano destino existe e está disponível para venda ──
    const { data: targetPlan, error: planError } = await svc
      .from('plans')
      .select('id, name, slug, sort_order, max_leads, max_users, max_funnels, max_automation_flows, storage_mb')
      .eq('id', to_plan_id)
      .eq('is_active', true)
      .eq('is_publicly_listed', true)
      .maybeSingle()

    if (planError || !targetPlan) {
      return res.status(400).json({ error: 'plan_not_available' })
    }

    // ── 3. Verificar pedido pendente existente ───────────────────────────────
    const { data: existing } = await svc
      .from('plan_change_requests')
      .select('id')
      .eq('company_id', effectiveCompanyId)
      .eq('status', 'pending')
      .maybeSingle()

    if (existing) {
      return res.status(400).json({ error: 'already_has_pending_request' })
    }

    // ── 4. Obter plano atual e verificar se é o mesmo plano ─────────────────
    const currentLimits = await getPlanLimits(svc, effectiveCompanyId)
    const fromPlanId    = currentLimits.plan_id

    if (fromPlanId === to_plan_id) {
      return res.status(400).json({ error: 'already_on_this_plan' })
    }

    // ── 5. Validação de downgrade: uso atual vs limites do plano destino ─────
    const [leadsRes, usersRes, funnelsRes, autoFlowsRes, storageRes] = await Promise.all([
      svc.from('leads').select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId).is('deleted_at', null),
      svc.from('company_users').select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId).eq('is_active', true).eq('is_platform_member', false),
      svc.from('sales_funnels').select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId).eq('is_active', true),
      svc.from('automation_flows').select('*', { count: 'exact', head: true })
        .eq('company_id', effectiveCompanyId).eq('is_active', true),
      svc.rpc('get_company_storage_used_mb', { p_company_id: effectiveCompanyId }),
    ])

    const usage = {
      leads:      leadsRes.count     ?? 0,
      users:      usersRes.count     ?? 0,
      funnels:    funnelsRes.count   ?? 0,
      auto_flows: autoFlowsRes.count ?? 0,
      storage_mb: Math.ceil(parseFloat(storageRes.data) || 0),
    }

    const checks = [
      { key: 'max_leads',            current: usage.leads,      limit: targetPlan.max_leads },
      { key: 'max_users',            current: usage.users,      limit: targetPlan.max_users },
      { key: 'max_funnels',          current: usage.funnels,    limit: targetPlan.max_funnels },
      { key: 'max_automation_flows', current: usage.auto_flows, limit: targetPlan.max_automation_flows },
      { key: 'storage_mb',           current: usage.storage_mb, limit: targetPlan.storage_mb },
    ]

    const blockedBy = checks
      .filter(({ current, limit }) => limit !== null && current > limit)
      .map(({ key }) => key)

    if (blockedBy.length > 0) {
      return res.status(400).json({ error: 'downgrade_blocked', blocked_by: blockedBy })
    }

    // ── 6. Obter usuário autenticado ─────────────────────────────────────────
    const authHeader = req.headers.authorization ?? ''
    const token      = authHeader.slice(7)
    const userClient = require('@supabase/supabase-js').createClient(
      process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    )
    const { data: { user } } = await userClient.auth.getUser()

    if (!user?.id) {
      return res.status(401).json({ error: 'Usuário não identificado' })
    }

    // ── 7. Inserir solicitação ────────────────────────────────────────────────
    const { data: newRequest, error: insertError } = await svc
      .from('plan_change_requests')
      .insert({
        company_id:   effectiveCompanyId,
        from_plan_id: fromPlanId ?? null,
        to_plan_id,
        requested_by: user.id,
      })
      .select('id')
      .single()

    if (insertError) {
      // Violação do índice único: pedido pendente já existe (race condition)
      if (insertError.code === '23505') {
        return res.status(400).json({ error: 'already_has_pending_request' })
      }
      console.error('[POST /api/plans/change-request] Erro ao inserir:', insertError.message)
      return res.status(500).json({ error: 'Erro ao registrar solicitação' })
    }

    return res.status(201).json({ ok: true, request_id: newRequest.id })
  } catch (err) {
    console.error('[POST /api/plans/change-request] Erro:', err)
    return res.status(500).json({ error: 'Erro interno ao processar solicitação' })
  }
}
