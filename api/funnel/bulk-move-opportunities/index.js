// =====================================================
// API: PUT /api/funnel/bulk-move-opportunities
//
// Move oportunidades visíveis de uma etapa para outra em massa.
// Suporta troca de funil (cross-funnel).
//
// SEGURANÇA:
//   - JWT obrigatório (service_role só no backend)
//   - Membership + role validados no banco (nunca confia no body)
//   - company_id do body NÃO é fonte de verdade
//   - opportunity_ids revalidados contra BD antes da RPC
//   - Limite de 200 oportunidades por operação
//
// RBAC: super_admin, system_admin, partner, admin, manager
// BLOQUEADO: seller
//
// ORDEM DE EXECUÇÃO:
//   1. Validar JWT → usuário real
//   2. Validar campos obrigatórios + limite
//   3. Validar membership + role no banco (Trilha 1 + Trilha 2)
//   4. Revalidar opportunity_ids no banco → log requested/valid/invalid
//   5. Validar etapa origem (propriedade da empresa)
//   6. Validar etapa destino (propriedade da empresa)
//   7. Chamar RPC bulk_move_opportunities
//   8. Aguardar automações em batches de 10 (Promise.allSettled, fail-safe)
//   9. Retornar resposta
// =====================================================

import { createClient } from '@supabase/supabase-js'
// @ts-ignore
import { matchesTriggerConditions } from '../../lib/automation/triggerEvaluator.js'
// @ts-ignore
import { createExecution, processFlowAsync } from '../../lib/automation/executor.js'

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://etzdsywunlpbgxkphuil.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const ALLOWED_ROLES     = ['super_admin', 'system_admin', 'partner', 'admin', 'manager']
const MAX_OPPORTUNITIES = 200
const BATCH_SIZE        = 10

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ---------------------------------------------------------------------------
// Dispatch: opportunity.stage_changed para uma única oportunidade (fail-safe).
// Reutiliza flows pré-carregados (1 query para todos os IDs, não N queries).
// ---------------------------------------------------------------------------
async function dispatchStageChanged(svc, { companyId, opportunityId, fromStageId, toStageId, toFunnelId }, preloadedFlows) {
  try {
    if (!preloadedFlows?.length) return

    const event = {
      type: 'opportunity.stage_changed',
      data: {
        opportunity_id: opportunityId,
        old_stage:      fromStageId,
        new_stage:      toStageId,
        opportunity:    { funnel_id: toFunnelId },
      },
    }

    const matched = preloadedFlows.filter(f => matchesTriggerConditions(f, event))
    if (!matched.length) return

    for (const flow of matched) {
      try {
        const triggerData = {
          opportunity_id: opportunityId,
          old_stage:      fromStageId,
          new_stage:      toStageId,
        }
        const execution = await createExecution(flow, triggerData, companyId, svc)
        if (!execution) continue
        await processFlowAsync(flow, execution, svc)
      } catch (flowErr) {
        console.error(`[bulk-move] automation flow=${flow.id} opp=${opportunityId} error:`, flowErr?.message)
      }
    }
  } catch (err) {
    console.error(`[bulk-move] dispatchStageChanged opp=${opportunityId} error:`, err?.message)
  }
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Autenticação via service_role (nunca exposto ao frontend) ─────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' })
  }
  const token = authHeader.slice(7)

  const svc = getServiceClient()
  if (!svc) {
    return res.status(500).json({ error: 'Configuração de servidor incompleta' })
  }

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  // ── 2. Extrair e validar campos obrigatórios ────────────────────────────
  const {
    company_id,
    from_funnel_id,
    from_stage_id,
    to_funnel_id,
    to_stage_id,
    opportunity_ids,
  } = req.body ?? {}

  if (!company_id)     return res.status(400).json({ error: 'company_id é obrigatório',     field: 'company_id' })
  if (!from_funnel_id) return res.status(400).json({ error: 'from_funnel_id é obrigatório', field: 'from_funnel_id' })
  if (!from_stage_id)  return res.status(400).json({ error: 'from_stage_id é obrigatório',  field: 'from_stage_id' })
  if (!to_funnel_id)   return res.status(400).json({ error: 'to_funnel_id é obrigatório',   field: 'to_funnel_id' })
  if (!to_stage_id)    return res.status(400).json({ error: 'to_stage_id é obrigatório',    field: 'to_stage_id' })

  if (!Array.isArray(opportunity_ids) || opportunity_ids.length === 0) {
    return res.status(400).json({ error: 'opportunity_ids deve ser um array não vazio', field: 'opportunity_ids' })
  }

  if (opportunity_ids.length > MAX_OPPORTUNITIES) {
    return res.status(400).json({
      error:    `Limite de ${MAX_OPPORTUNITIES} oportunidades por operação. Recebido: ${opportunity_ids.length}`,
      limit:    MAX_OPPORTUNITIES,
      received: opportunity_ids.length,
    })
  }

  // ── 3. Validar membership + role no banco ───────────────────────────────
  // O company_id do body NÃO é fonte de verdade: validamos no banco.
  //
  // Trilha 1 — membership direta:
  //   admin, manager         → membership ativa direta na empresa
  //   super_admin, system_admin → membership ativa direta na empresa
  //   partner                → membership ativa + assignment em partner_company_assignments
  //   seller                 → bloqueado
  //
  // Trilha 2 — parent-admin sem membership direta:
  //   super_admin / system_admin de empresa pai com vínculo de parentesco validado
  const { data: directMembership } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', company_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!directMembership) {
    // Trilha 2: super_admin / system_admin de empresa pai acessando empresa filha
    const { data: parentMembership } = await svc
      .from('company_users')
      .select('role, company_id, companies!inner(company_type)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .in('role', ['super_admin', 'system_admin'])
      .maybeSingle()

    if (!parentMembership || parentMembership.companies?.company_type !== 'parent') {
      return res.status(403).json({ error: 'Sem acesso a esta empresa' })
    }

    // Garante que company_id é filha direta da empresa pai do usuário
    const { data: childCheck } = await svc
      .from('companies')
      .select('id')
      .eq('id', company_id)
      .eq('parent_company_id', parentMembership.company_id)
      .maybeSingle()

    if (!childCheck) {
      return res.status(403).json({ error: 'Empresa não encontrada ou sem acesso' })
    }
  } else {
    // Trilha 1: verificar role permitido
    if (!ALLOWED_ROLES.includes(directMembership.role)) {
      return res.status(403).json({
        error:          'Permissão insuficiente para mover oportunidades em massa',
        required_roles: ALLOWED_ROLES,
        your_role:      directMembership.role,
      })
    }

    // Partner exige assignment explícito em partner_company_assignments para a empresa alvo.
    // Membership em company_users é necessária mas não suficiente.
    if (directMembership.role === 'partner') {
      const { data: assignment } = await svc
        .from('partner_company_assignments')
        .select('id')
        .eq('partner_user_id', user.id)
        .eq('company_id', company_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!assignment) {
        return res.status(403).json({ error: 'Partner sem assignment ativo para esta empresa' })
      }
    }
  }

  // ── 4. Revalidar opportunity_ids contra o banco ─────────────────────────
  // O backend nunca executa IDs sem checar company_id + funnel + stage.
  // A RPC fará a validação definitiva, mas logamos aqui para rastreabilidade.
  const { data: validRows } = await svc
    .from('opportunity_funnel_positions')
    .select('opportunity_id')
    .eq('funnel_id', from_funnel_id)
    .eq('stage_id', from_stage_id)
    .in('opportunity_id', opportunity_ids)

  const requestedCount  = opportunity_ids.length
  const preValidCount   = validRows?.length ?? 0
  const preInvalidCount = requestedCount - preValidCount

  console.log(`[bulk-move] company=${company_id} requested=${requestedCount} pre_valid=${preValidCount} pre_invalid=${preInvalidCount}`)

  if (preInvalidCount > 0) {
    console.warn(`[bulk-move] ${preInvalidCount} IDs descartados: não pertencem à etapa/funil de origem`)
  }

  if (preValidCount === 0) {
    return res.status(400).json({
      error:           'Nenhuma oportunidade válida encontrada para mover',
      requested_count: requestedCount,
      valid_count:     0,
      invalid_count:   preInvalidCount,
    })
  }

  // ── 5. Validar etapa de origem ───────────────────────────────────────────
  const { data: fromStage } = await svc
    .from('funnel_stages')
    .select('id, name, stage_type, sales_funnels!inner(company_id)')
    .eq('id', from_stage_id)
    .eq('funnel_id', from_funnel_id)
    .maybeSingle()

  if (!fromStage || fromStage.sales_funnels?.company_id !== company_id) {
    return res.status(400).json({ error: 'Etapa de origem não encontrada ou não pertence à empresa', field: 'from_stage_id' })
  }

  // ── 6. Validar etapa de destino ──────────────────────────────────────────
  const { data: toStage } = await svc
    .from('funnel_stages')
    .select('id, name, stage_type, sales_funnels!inner(company_id)')
    .eq('id', to_stage_id)
    .eq('funnel_id', to_funnel_id)
    .maybeSingle()

  if (!toStage || toStage.sales_funnels?.company_id !== company_id) {
    return res.status(400).json({ error: 'Etapa de destino não encontrada ou não pertence à empresa', field: 'to_stage_id' })
  }

  // ── 7. Chamar RPC bulk_move_opportunities ───────────────────────────────
  // A RPC revalida internamente: company_id, funnel_id e stage_id de cada ID.
  const { data: rpcResult, error: rpcErr } = await svc.rpc('bulk_move_opportunities', {
    p_company_id:      company_id,
    p_actor_user_id:   user.id,
    p_from_funnel_id:  from_funnel_id,
    p_from_stage_id:   from_stage_id,
    p_to_funnel_id:    to_funnel_id,
    p_to_stage_id:     to_stage_id,
    p_opportunity_ids: opportunity_ids,
  })

  if (rpcErr) {
    console.error('[bulk-move] RPC error:', rpcErr)
    return res.status(500).json({ error: 'Erro ao mover oportunidades', detail: rpcErr.message })
  }

  const moved      = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
  const movedCount = moved?.moved_count ?? 0
  const movedIds   = moved?.moved_ids   ?? []

  console.log(`[bulk-move] RPC concluída moved_count=${movedCount} requested=${requestedCount} pre_valid=${preValidCount}`)

  // ── 8. Aguardar automações em batches ANTES de responder ────────────────
  // Somente quando a etapa realmente muda (from_stage_id !== to_stage_id).
  // Falhas de automação são logadas mas NÃO causam rollback nem erro HTTP.
  if (movedIds.length > 0 && from_stage_id !== to_stage_id) {
    try {
      const { data: flows } = await svc
        .from('automation_flows')
        .select('id, name, nodes, edges, trigger_operator')
        .eq('company_id', company_id)
        .eq('is_active', true)

      if (flows?.length) {
        for (let i = 0; i < movedIds.length; i += BATCH_SIZE) {
          const batch = movedIds.slice(i, i + BATCH_SIZE)
          const results = await Promise.allSettled(
            batch.map(opportunityId =>
              dispatchStageChanged(svc, {
                companyId:   company_id,
                opportunityId,
                fromStageId: from_stage_id,
                toStageId:   to_stage_id,
                toFunnelId:  to_funnel_id,
              }, flows)
            )
          )
          const failed = results.filter(r => r.status === 'rejected')
          if (failed.length) {
            console.error(`[bulk-move] batch ${Math.floor(i / BATCH_SIZE) + 1}: ${failed.length} automação(ões) falharam`, failed.map(r => r.reason?.message))
          }
        }
      }
    } catch (automationErr) {
      // Nunca bloqueia a resposta — apenas loga
      console.error('[bulk-move] erro ao processar automações (não crítico):', automationErr?.message)
    }
  }

  // ── 9. Responder ─────────────────────────────────────────────────────────
  return res.status(200).json({
    success:         true,
    moved_count:     movedCount,
    moved_ids:       movedIds,
    requested_count: requestedCount,
    valid_count:     preValidCount,
    invalid_count:   preInvalidCount,
  })
}
