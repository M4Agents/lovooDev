// =====================================================
// API: PUT /api/funnel/bulk-move-opportunities
//
// Move oportunidades de uma etapa para outra em massa.
// Suporta troca de funil (cross-funnel).
//
// SEGURANÇA:
//   - JWT obrigatório (service_role só no backend)
//   - Membership + role validados no banco (nunca confia no body)
//   - company_id do body NÃO é fonte de verdade
//   - Elegíveis calculados no backend pelos filtros, não por IDs do frontend
//   - Limite de 200 oportunidades em TODOS os caminhos
//
// RBAC: super_admin, system_admin, partner, admin, manager
// BLOQUEADO: seller
//
// RESOLUÇÃO DE IDs (único caminho, com ou sem filtros):
//   Sempre chama get_stage_opportunity_ids_filtered antes da RPC.
//   Sem filtros → todos os params NULL → retorna todos os IDs da etapa
//   Com filtros → aplica search/origin/period_days → retorna IDs filtrados
//   Limite de 200 aplicado sobre o array resolvido — p_opportunity_ids NUNCA é NULL.
//
// ORDEM DE EXECUÇÃO:
//   1. Validar JWT → usuário real
//   2. Validar campos obrigatórios
//   3. Validar membership + role no banco (Trilha 1 + Trilha 2)
//   4. Validar etapa de origem (propriedade da empresa)
//   5. Resolver IDs elegíveis + verificar limite de 200
//   6. Validar etapa de destino (propriedade da empresa)
//   7. Chamar RPC bulk_move_opportunities com p_opportunity_ids = IDs resolvidos
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
  // opportunity_ids não existe mais — elegíveis são calculados pelos filtros.
  const {
    company_id,
    from_funnel_id,
    from_stage_id,
    to_funnel_id,
    to_stage_id,
    search,
    origin,
    period_days,
  } = req.body ?? {}

  if (!company_id)     return res.status(400).json({ error: 'company_id é obrigatório',     field: 'company_id' })
  if (!from_funnel_id) return res.status(400).json({ error: 'from_funnel_id é obrigatório', field: 'from_funnel_id' })
  if (!from_stage_id)  return res.status(400).json({ error: 'from_stage_id é obrigatório',  field: 'from_stage_id' })
  if (!to_funnel_id)   return res.status(400).json({ error: 'to_funnel_id é obrigatório',   field: 'to_funnel_id' })
  if (!to_stage_id)    return res.status(400).json({ error: 'to_stage_id é obrigatório',    field: 'to_stage_id' })

  // ── 3. Validar membership + role no banco ───────────────────────────────
  // O company_id do body NÃO é fonte de verdade: validamos no banco.
  //
  // Trilha 1 — membership direta:
  //   admin, manager            → membership ativa direta na empresa
  //   super_admin, system_admin → membership ativa direta na empresa
  //   partner                   → membership ativa + assignment em partner_company_assignments
  //   seller                    → bloqueado
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
    if (!ALLOWED_ROLES.includes(directMembership.role)) {
      return res.status(403).json({
        error:          'Permissão insuficiente para mover oportunidades em massa',
        required_roles: ALLOWED_ROLES,
        your_role:      directMembership.role,
      })
    }

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

  // ── 4. Validar etapa de origem antes de resolver IDs ────────────────────
  // Verificado antes de qualquer operação nos dados, logo após o RBAC.
  const { data: fromStageEarly } = await svc
    .from('funnel_stages')
    .select('id, sales_funnels!inner(company_id)')
    .eq('id', from_stage_id)
    .eq('funnel_id', from_funnel_id)
    .maybeSingle()

  if (!fromStageEarly || fromStageEarly.sales_funnels?.company_id !== company_id) {
    return res.status(400).json({ error: 'Etapa de origem não encontrada ou não pertence à empresa', field: 'from_stage_id' })
  }

  // ── 5. Resolver IDs elegíveis + verificar limite ──────────────────────────
  // Único caminho para ambos os cenários (com ou sem filtros).
  //
  // Sempre resolve os IDs antes de chamar a RPC — garante que:
  //   - a contagem exibida ao usuário é exatamente o conjunto que será movido
  //   - o limite de 200 é realmente respeitado (sem race condition entre count e move)
  //   - p_opportunity_ids nunca é NULL: a RPC sempre opera sobre um conjunto fixo
  //
  // Sem filtros → get_stage_opportunity_ids_filtered com todos os params NULL
  //               retorna todos os IDs da etapa
  // Com filtros → get_stage_opportunity_ids_filtered com os filtros ativos
  //               retorna apenas os IDs que correspondem
  const hasFilters = !!(search || origin || period_days)

  const { data: ids, error: idsErr } = await svc.rpc('get_stage_opportunity_ids_filtered', {
    p_funnel_id:   from_funnel_id,
    p_stage_id:    from_stage_id,
    p_company_id:  company_id,
    p_search:      search      ?? null,
    p_origin:      origin      ?? null,
    p_period_days: period_days ?? null,
  })

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'bf3f9d'},body:JSON.stringify({sessionId:'bf3f9d',location:'index.js:rpc-result',message:'get_stage_opportunity_ids_filtered result',data:{idsErr: idsErr ? {message: idsErr.message, code: idsErr.code, details: idsErr.details, hint: idsErr.hint} : null, idsCount: ids?.length ?? null, has_filters: hasFilters, from_funnel_id, from_stage_id, company_id, search: search ?? null, origin: origin ?? null, period_days: period_days ?? null},timestamp:Date.now(),hypothesisId:'H-A,H-B,H-C,H-D,H-E'})}).catch(()=>{});
  // #endregion

  if (idsErr) {
    return res.status(500).json({ error: 'Erro ao resolver oportunidades elegíveis', detail: idsErr.message })
  }

  const opportunityIds = ids ?? []
  const eligibleCount  = opportunityIds.length

  console.log(`[bulk-move] company=${company_id} stage=${from_stage_id} has_filters=${hasFilters} eligible=${eligibleCount}`)

  if (eligibleCount === 0) {
    const msg = hasFilters
      ? 'Nenhuma oportunidade elegível encontrada com os filtros aplicados'
      : 'Nenhuma oportunidade encontrada na etapa de origem'
    return res.status(400).json({ error: msg })
  }

  if (eligibleCount > MAX_OPPORTUNITIES) {
    return res.status(422).json({
      error:          `Limite de ${MAX_OPPORTUNITIES} oportunidades por operação excedido. Aplique filtros para reduzir o volume.`,
      eligible_count: eligibleCount,
      limit:          MAX_OPPORTUNITIES,
    })
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
  // Sempre passa p_opportunity_ids com o array resolvido no step 5.
  // Nunca usa NULL — garante que a RPC opera exatamente sobre o conjunto
  // já validado e contado, sem divergência por race condition.
  const { data: rpcResult, error: rpcErr } = await svc.rpc('bulk_move_opportunities', {
    p_company_id:      company_id,
    p_actor_user_id:   user.id,
    p_from_funnel_id:  from_funnel_id,
    p_from_stage_id:   from_stage_id,
    p_to_funnel_id:    to_funnel_id,
    p_to_stage_id:     to_stage_id,
    p_opportunity_ids: opportunityIds,
  })

  if (rpcErr) {
    console.error('[bulk-move] RPC error:', rpcErr)
    return res.status(500).json({ error: 'Erro ao mover oportunidades', detail: rpcErr.message })
  }

  const moved      = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
  const movedCount = moved?.moved_count ?? 0
  const movedIds   = moved?.moved_ids   ?? []

  console.log(`[bulk-move] RPC concluída moved_count=${movedCount} has_filters=${hasFilters}`)

  // ── 8. Aguardar automações em batches ANTES de responder ────────────────
  // Somente quando a etapa realmente muda (from_stage_id !== to_stage_id).
  // Falhas de automação são logadas mas NÃO causam rollback nem erro HTTP.
  //
  // NOTA: Para volumes > 200, o processamento assíncrono via fila seria
  // necessário. Com o limite atual de 200 e batches de 10, o pior caso é
  // 20 batches sequenciais — aceitável dentro do timeout da Vercel Function.
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
      console.error('[bulk-move] erro ao processar automações (não crítico):', automationErr?.message)
    }
  }

  // ── 9. Responder ─────────────────────────────────────────────────────────
  return res.status(200).json({
    success:      true,
    moved_count:  movedCount,
    moved_ids:    movedIds,
    has_filters:  hasFilters,
  })
}
