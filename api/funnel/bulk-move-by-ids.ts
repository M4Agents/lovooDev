// =====================================================
// API: PUT /api/funnel/bulk-move-by-ids
//
// Move um conjunto explícito de oportunidades selecionadas pelo usuário
// para uma etapa de destino, de forma atômica.
//
// Usado pela feature de multi-drag do Funil de Vendas.
// Difere do endpoint bulk-move-opportunities que opera por filtros:
//   aqui os IDs são explícitos (seleção do usuário), não resolvidos por filtro.
//
// SEGURANÇA:
//   - JWT obrigatório; service_role só no backend
//   - company_id NUNCA vem do frontend — resolvido a partir do funil
//   - fromStageId NUNCA vem do frontend — resolvido a partir dos IDs
//   - Membership + is_active validados antes de qualquer operação
//   - Todas as oportunidades devem pertencer à empresa, ao funil e à mesma etapa
//   - Atomicidade garantida pela RPC (migração M9.2: FOR UPDATE + count check)
//
// RBAC: todos os usuários com membership ativa (espelha drag individual)
//   super_admin, system_admin, admin, manager, seller → Trilha 1 (membership direta)
//   super_admin / system_admin da empresa pai            → Trilha 2 (parent → child)
//   partner com assignment ativo na mesma parent         → Trilha 3 (partner path)
//   partner sem assignment / inativo / cross-parent      → 403
//
// PAYLOAD:
//   { opportunityIds: string[], funnelId: string, toStageId: string }
//
// ORDEM DE EXECUÇÃO:
//   1.  Autenticação JWT → usuário real
//   2.  Validar payload (array, UUIDs, limite 50)
//   3.  Resolver company_id a partir do funnel (nunca do body)
//   4.  Validar acesso:
//       4a. Trilha 1 + Trilha 2 via assertMembership
//       4b. Trilha 3: partner com assignment ativo (fallback quando Trilha 1/2 = null)
//   5.  Validar etapa de destino (pertence ao funil, stage_type === 'active')
//   6.  Buscar oportunidades + suas posições no funil
//   7.  Validar: todas existem, mesma empresa, mesmo funil, mesma etapa de origem
//   8.  Validar: etapa de origem stage_type === 'active'
//   9.  Chamar RPC bulk_move_opportunities UMA única vez
//  10.  Disparar automações em batches (fail-safe, Promise.allSettled)
//  11.  Responder
// =====================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from '@supabase/supabase-js'
import { extractToken, getUserFromToken, assertMembership } from '../lib/dashboard/auth.js'
// @ts-expect-error — módulo JS sem types
import { matchesTriggerConditions } from '../lib/automation/triggerEvaluator.js'
// @ts-expect-error — módulo JS sem types
import { createExecution, processFlowAsync } from '../lib/automation/executor.js'

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://etzdsywunlpbgxkphuil.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const MAX_IDS    = 50
const BATCH_SIZE = 10
const UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getServiceClient() {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ---------------------------------------------------------------------------
// dispatchStageChanged — dispara automation opportunity.stage_changed (fail-safe)
// Reutiliza flows pré-carregados (1 query para todos os IDs, não N queries).
// ---------------------------------------------------------------------------
async function dispatchStageChanged(
  svc: any,
  payload: { companyId: string; opportunityId: string; fromStageId: string; toStageId: string; funnelId: string },
  preloadedFlows: any[],
) {
  try {
    if (!preloadedFlows?.length) return

    const event = {
      type: 'opportunity.stage_changed',
      data: {
        opportunity_id: payload.opportunityId,
        old_stage:      payload.fromStageId,
        new_stage:      payload.toStageId,
        opportunity:    { funnel_id: payload.funnelId },
      },
    }

    const matched = preloadedFlows.filter((f: any) => matchesTriggerConditions(f, event))
    if (!matched.length) return

    for (const flow of matched) {
      if (flow.is_over_plan === true) {
        console.warn(`[bulk-move-by-ids][plan_limit] flow=${flow.id} is_over_plan=true — ignorado`)
        continue
      }
      try {
        const triggerData = {
          opportunity_id: payload.opportunityId,
          old_stage:      payload.fromStageId,
          new_stage:      payload.toStageId,
        }
        const execution = await createExecution(flow, triggerData, payload.companyId, svc)
        if (!execution) continue
        await processFlowAsync(flow, execution, svc)
      } catch (flowErr: any) {
        console.error(`[bulk-move-by-ids] flow=${flow.id} opp=${payload.opportunityId} error:`, flowErr?.message)
      }
    }
  } catch (err: any) {
    console.error(`[bulk-move-by-ids] dispatchStageChanged opp=${payload.opportunityId} error:`, err?.message)
  }
}

// ---------------------------------------------------------------------------
// assertPartnerAccess
//
// Trilha 3: valida que o usuário é partner com assignment ativo para a empresa.
// Espelha a lógica de auth_user_is_partner_for_company (SQL) e do endpoint
// api/funnel/bulk-move-opportunities/index.js (linhas 155–210).
//
// Cadeia obrigatória (todas as condições devem ser verdadeiras):
//   A) company_users.role = 'partner' AND is_active = true
//   B) company_users.company_id → companies.company_type = 'parent'
//   C) partner_company_assignments.company_id = targetCompanyId AND is_active = true
//   D) target company.parent_company_id = partnerMember.company_id (anti cross-parent)
//
// Retorna true somente quando toda a cadeia é válida.
// ---------------------------------------------------------------------------
async function assertPartnerAccess(svc: any, userId: string, targetCompanyId: string): Promise<boolean> {
  // A + B: partner ativo em empresa parent
  const { data: partnerMember } = await svc
    .from('company_users')
    .select('company_id, companies!inner(company_type)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('role', 'partner')
    .maybeSingle()

  if (!partnerMember || (partnerMember.companies as any)?.company_type !== 'parent') {
    return false
  }

  const partnerParentId: string = partnerMember.company_id

  // D: empresa alvo deve pertencer à mesma parent do partner (anti cross-parent)
  const { data: targetCompany } = await svc
    .from('companies')
    .select('id')
    .eq('id', targetCompanyId)
    .eq('parent_company_id', partnerParentId)
    .maybeSingle()

  if (!targetCompany) return false

  // C: assignment ativo para a empresa alvo
  const { data: assignment } = await svc
    .from('partner_company_assignments')
    .select('id')
    .eq('partner_user_id', userId)
    .eq('company_id', targetCompanyId)
    .eq('is_active', true)
    .maybeSingle()

  return !!assignment
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
export default async function handler(req: any, res: any) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Autenticação JWT ───────────────────────────────────────────────────
  const token = extractToken(req.headers?.authorization)
  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' })
  }

  const svc = getServiceClient()
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Configuração de servidor incompleta' })
  }

  const { user, error: authErr } = await getUserFromToken(token)
  if (authErr || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  // ── 2. Validar payload ─────────────────────────────────────────────────────
  const { opportunityIds, funnelId, toStageId } = req.body ?? {}

  if (!Array.isArray(opportunityIds) || opportunityIds.length === 0) {
    return res.status(400).json({ error: 'opportunityIds deve ser um array não vazio', field: 'opportunityIds' })
  }
  if (!funnelId || typeof funnelId !== 'string' || !UUID_RE.test(funnelId)) {
    return res.status(400).json({ error: 'funnelId inválido', field: 'funnelId' })
  }
  if (!toStageId || typeof toStageId !== 'string' || !UUID_RE.test(toStageId)) {
    return res.status(400).json({ error: 'toStageId inválido', field: 'toStageId' })
  }

  // Validar e deduplicar os IDs
  const invalidIds = opportunityIds.filter((id: any) => typeof id !== 'string' || !UUID_RE.test(id))
  if (invalidIds.length > 0) {
    return res.status(400).json({ error: 'opportunityIds contém valores inválidos (esperado UUID)', field: 'opportunityIds' })
  }
  const deduplicatedIds: string[] = [...new Set<string>(opportunityIds)]

  if (deduplicatedIds.length === 0 || deduplicatedIds.length > MAX_IDS) {
    return res.status(400).json({
      error:  `Quantidade de oportunidades deve ser entre 1 e ${MAX_IDS}`,
      count:  deduplicatedIds.length,
      limit:  MAX_IDS,
      field:  'opportunityIds',
    })
  }

  // ── 3. Resolver company_id a partir do funil ──────────────────────────────
  // Nunca confiar em company_id vindo do frontend.
  const { data: funnelRow, error: funnelErr } = await svc
    .from('sales_funnels')
    .select('id, company_id')
    .eq('id', funnelId)
    .maybeSingle()

  if (funnelErr || !funnelRow) {
    return res.status(404).json({ error: 'Funil não encontrado' })
  }
  const companyId: string = funnelRow.company_id

  // ── 4. Validar acesso à empresa ──────────────────────────────────────────
  //
  // Trilha 1 — membership direta (admin, manager, seller, super_admin, system_admin):
  //   company_users WHERE user_id = X AND company_id = companyId AND is_active = true
  //
  // Trilha 2 — parent admin sem membership direta (super_admin / system_admin da parent):
  //   Implementada dentro de assertMembership.
  //
  // Trilha 3 — partner com assignment ativo (fallback quando Trilha 1/2 retorna null):
  //   partner NÃO tem company_users na empresa client (só na parent).
  //   assertMembership retorna null para esse cenário.
  //   assertPartnerAccess valida a cadeia completa:
  //     company_users[role=partner, parent] → companies[parent] →
  //     companies[target.parent_company_id] → partner_company_assignments[active].
  //
  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) {
    // Trilha 1 e Trilha 2 falharam — tentar Trilha 3 (partner)
    const isPartner = await assertPartnerAccess(svc, user.id, companyId)
    if (!isPartner) {
      return res.status(403).json({ error: 'Sem acesso a esta empresa' })
    }
    // Partner autorizado — continua sem restrição de role adicional
    // (drag individual também não possui restrição de role)
  } else if (membership.role === 'partner') {
    // Defesa em profundidade: partner com row acidental em company_users da empresa
    // client (estado inconsistente de DB) ainda DEVE ter assignment ativo validado.
    // Regra Lovoo: partner NUNCA acessa empresa client apenas por membership/role —
    // partner_company_assignments é sempre obrigatório.
    // Espelha o comportamento de api/funnel/bulk-move-opportunities/index.js.
    const isPartner = await assertPartnerAccess(svc, user.id, companyId)
    if (!isPartner) {
      return res.status(403).json({ error: 'Sem acesso a esta empresa' })
    }
  }

  // ── 5. Validar etapa de destino ────────────────────────────────────────────
  const { data: destStage } = await svc
    .from('funnel_stages')
    .select('id, name, stage_type, funnel_id, sales_funnels!inner(company_id)')
    .eq('id', toStageId)
    .eq('funnel_id', funnelId)
    .maybeSingle()

  if (!destStage || (destStage.sales_funnels as any)?.company_id !== companyId) {
    return res.status(400).json({ error: 'Etapa de destino não encontrada ou não pertence ao funil informado', field: 'toStageId' })
  }
  if (destStage.stage_type !== 'active') {
    return res.status(400).json({
      error:     'Movimentação em massa para etapas de fechamento não está disponível nesta versão',
      field:     'toStageId',
      stage_type: destStage.stage_type,
    })
  }

  // ── 6. Buscar oportunidades e suas posições no funil ──────────────────────
  // Uma query com JOIN via opportunity_funnel_positions para obter:
  //   - opportunity.company_id (validação de propriedade)
  //   - position.stage_id (para verificar mesma origem)
  //   - position.funnel_id (para verificar mesmo funil)
  const { data: positions, error: posErr } = await svc
    .from('opportunity_funnel_positions')
    .select(`
      id,
      stage_id,
      funnel_id,
      opportunity_id,
      opportunities!inner(company_id)
    `)
    .in('opportunity_id', deduplicatedIds)
    .eq('funnel_id', funnelId)

  if (posErr) {
    console.error('[bulk-move-by-ids] erro ao buscar posições:', posErr.message)
    return res.status(500).json({ error: 'Erro ao buscar oportunidades' })
  }

  // ── 7. Validações de consistência dos IDs ─────────────────────────────────

  // 7a. Quantidade retornada deve ser exatamente igual à solicitada
  //     (não mover subconjunto silenciosamente)
  const foundIds = new Set<string>((positions ?? []).map((p: any) => p.opportunity_id))
  const missingIds = deduplicatedIds.filter(id => !foundIds.has(id))
  if (missingIds.length > 0) {
    return res.status(400).json({
      error:      'Uma ou mais oportunidades não foram encontradas no funil informado',
      missing:    missingIds.length,
      field:      'opportunityIds',
    })
  }

  // 7b. Todas devem pertencer à empresa autorizada (anti cross-tenant)
  const wrongCompany = (positions ?? []).filter((p: any) => p.opportunities?.company_id !== companyId)
  if (wrongCompany.length > 0) {
    return res.status(403).json({ error: 'Uma ou mais oportunidades não pertencem a esta empresa' })
  }

  // ── 8. Validar mesma etapa de origem e stage_type === 'active' ────────────
  // Esta validação é CRÍTICA para atomicidade: a RPC recebe um único from_stage_id.
  const originStageIds = new Set<string>((positions ?? []).map((p: any) => p.stage_id))
  if (originStageIds.size > 1) {
    return res.status(400).json({
      error: 'Todas as oportunidades devem estar na mesma etapa de origem para movimentação em grupo',
      distinct_origin_stages: originStageIds.size,
    })
  }
  const fromStageId: string = [...originStageIds][0]

  // Validar stage_type da origem
  const { data: originStage } = await svc
    .from('funnel_stages')
    .select('id, stage_type')
    .eq('id', fromStageId)
    .eq('funnel_id', funnelId)
    .maybeSingle()

  if (!originStage || originStage.stage_type !== 'active') {
    return res.status(400).json({
      error:     'Movimentação em massa não está disponível para oportunidades em etapas de fechamento',
      field:     'opportunityIds',
      stage_type: originStage?.stage_type,
    })
  }

  // ── 9. Chamar RPC bulk_move_opportunities (UMA única vez) ─────────────────
  const { data: rpcResult, error: rpcErr } = await svc.rpc('bulk_move_opportunities', {
    p_company_id:      companyId,
    p_actor_user_id:   user.id,
    p_from_funnel_id:  funnelId,
    p_from_stage_id:   fromStageId,
    p_to_funnel_id:    funnelId,
    p_to_stage_id:     toStageId,
    p_opportunity_ids: deduplicatedIds,
  })

  if (rpcErr) {
    console.error('[bulk-move-by-ids] RPC error:', rpcErr.message)

    // PARTIAL_MOVE_PREVENTED: race condition — uma ou mais oportunidades mudaram
    // de stage entre a validação do endpoint e a execução da RPC.
    // HTTP 409 Conflict sinaliza ao frontend para fazer boardRefresh autoritativo.
    if (rpcErr.message?.includes('PARTIAL_MOVE_PREVENTED')) {
      return res.status(409).json({
        error: 'Algumas oportunidades mudaram de etapa antes da operação. O funil será atualizado.',
      })
    }

    // Perguntas obrigatórias (R1 enforcement na RPC)
    if (rpcErr.message?.includes('BULK_REQUIRED_QUESTIONS_NOT_ANSWERED')) {
      return res.status(400).json({
        error: 'Esta etapa possui perguntas obrigatórias que impedem movimentação em massa.',
      })
    }

    // Erro inesperado — não expor detalhes internos
    return res.status(500).json({ error: 'Erro ao mover oportunidades. Tente novamente.' })
  }

  const moved      = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
  const movedCount: number = moved?.moved_count ?? 0
  const movedIds: string[] = moved?.moved_ids   ?? []

  // INVARIANT VIOLATION: com a migration M9.2, moved_count deve sempre ser igual
  // a deduplicatedIds.length quando a RPC retorna sem erro. Se divergir, algo
  // inesperado ocorreu no banco — não retornar sucesso e não disparar automações.
  if (movedCount !== deduplicatedIds.length) {
    console.error(
      `[bulk-move-by-ids] INVARIANT_VIOLATION: esperado=${deduplicatedIds.length} movido=${movedCount}`,
      { companyId, fromStageId, toStageId },
    )
    return res.status(500).json({ error: 'Inconsistência inesperada na movimentação. O funil será atualizado.' })
  }

  console.log(`[bulk-move-by-ids] company=${companyId} from=${fromStageId} to=${toStageId} moved=${movedCount}`)

  // ── 10. Disparar automações (fail-safe, batch) ────────────────────────────
  // Somente quando a etapa realmente muda (fromStageId !== toStageId).
  // Multi-drag: backend é o único responsável por disparar opportunity.stage_changed.
  // O frontend NÃO chama /api/automation/trigger-event para estas oportunidades.
  if (movedIds.length > 0 && fromStageId !== toStageId) {
    try {
      const { data: flows } = await svc
        .from('automation_flows')
        .select('id, name, nodes, edges, trigger_operator, is_over_plan')
        .eq('company_id', companyId)
        .eq('is_active', true)

      if (flows?.length) {
        for (let i = 0; i < movedIds.length; i += BATCH_SIZE) {
          const batch = movedIds.slice(i, i + BATCH_SIZE)
          const results = await Promise.allSettled(
            batch.map((oppId: string) =>
              dispatchStageChanged(
                svc,
                { companyId, opportunityId: oppId, fromStageId, toStageId, funnelId },
                flows,
              )
            )
          )
          const failed = results.filter((r: any) => r.status === 'rejected')
          if (failed.length) {
            console.error(
              `[bulk-move-by-ids] batch ${Math.floor(i / BATCH_SIZE) + 1}: ${failed.length} automação(ões) falharam`,
              failed.map((r: any) => r.reason?.message),
            )
          }
        }
      }
    } catch (automationErr: any) {
      console.error('[bulk-move-by-ids] erro ao processar automações (não crítico):', automationErr?.message)
    }
  }

  // ── 11. Responder ──────────────────────────────────────────────────────────
  return res.status(200).json({
    success:     true,
    moved_count: movedCount,
    moved_ids:   movedIds,
  })
}
