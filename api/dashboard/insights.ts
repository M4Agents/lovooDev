// =====================================================
// GET /api/dashboard/insights
//
// Retorna até 5 insights automáticos calculados por SQL/regras simples.
// NENHUM insight usa LLM, crédito de IA ou executa ação.
//
// Query params:
//   company_id  (obrigatório)
//   period      (default: '30d')
//   start_date / end_date  (obrigatório quando period = 'custom')
//   funnel_id   (opcional — habilita insights de pipeline/conversão)
//
// Segurança:
//   - company_id validado contra membership
//   - funnel_id validado contra company_id
//   - Promise.allSettled: falha isolada nunca quebra o endpoint
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod, type ResolvedRange } from '../lib/dashboard/period.js'
import { getInsightPolicies, type InsightPolicies } from '../lib/dashboard/insightPolicies.js'
import { canCustomizeInsights } from '../lib/dashboard/insightAccess.js'
import {
  extractToken,
  assertMembership,
  assertFunnelBelongsToCompany,
  jsonError,
} from '../lib/dashboard/auth.js'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type InsightType    = 'cooling_opportunity' | 'hot_opportunity' | 'funnel_bottleneck' | 'conversion_drop' | 'ai_tool_issue'
type InsightPriority = 'critical' | 'high' | 'medium' | 'low'

interface InsightItem {
  id:              string
  type:            InsightType
  priority:        InsightPriority
  title:           string
  description:     string
  entityType:      'opportunities' | 'leads' | 'conversations' | 'funnel'
  filters:         Record<string, unknown>
  actionLabel:     string
  supporting_data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Insight 1 — Oportunidades quentes
// Regra: status=open, probability>=hot_probability_threshold, updated_at no período
// ---------------------------------------------------------------------------

async function computeHotOpportunities(
  svc: SupabaseClient,
  companyId: string,
  resolvedRange: ResolvedRange,
  funnelId: string | null,
  policies: InsightPolicies,
): Promise<InsightItem | null> {
  let query = svc
    .from('opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'open')
    .gte('probability', policies.hot_probability_threshold)
    .gte('updated_at', resolvedRange.start)
    .lte('updated_at', resolvedRange.end)

  if (funnelId) {
    // Filtrar via opportunity_funnel_positions (sem company_id)
    const { data: positions } = await svc
      .from('opportunity_funnel_positions')
      .select('opportunity_id')
      .eq('funnel_id', funnelId)
    const oppIds = (positions ?? []).map((p: { opportunity_id: string }) => p.opportunity_id)
    if (oppIds.length === 0) return null
    query = query.in('id', oppIds)
  }

  const { count, error } = await query
  if (error) throw new Error(`hot_opportunity: ${error.message}`)
  if (!count || count === 0) return null

  return {
    id:          'hot_opportunity',
    type:        'hot_opportunity',
    priority:    'high',
    title:       `${count} oportunidade${count > 1 ? 's' : ''} quente${count > 1 ? 's' : ''}`,
    description: `Com probabilidade ≥ ${policies.hot_probability_threshold}% e abertas no período`,
    entityType:  'opportunities',
    filters:     { probability_min: 70, status: 'open', funnelId: funnelId ?? undefined },
    actionLabel: 'Ver oportunidades',
  }
}

// ---------------------------------------------------------------------------
// Insight 2 — Oportunidades sem atualização (esfriando)
// Regra: COALESCE(last_interaction_at, updated_at) < now() - cooling_threshold_days
// Fallback: se last_interaction_at for NULL, usa updated_at
// ---------------------------------------------------------------------------

type CoolingRow = { id: string; last_interaction_at: string | null; updated_at: string }

async function computeCoolingOpportunities(
  svc: SupabaseClient,
  companyId: string,
  funnelId: string | null,
  policies: InsightPolicies,
): Promise<InsightItem | null> {
  const cutoff = new Date(Date.now() - policies.cooling_threshold_days * 86_400_000).toISOString()

  // Filtro equivalente a: COALESCE(last_interaction_at, updated_at) < cutoff
  // PostgREST: (last_interaction_at IS NOT NULL AND last_interaction_at < cutoff)
  //         OR (last_interaction_at IS NULL AND updated_at < cutoff)
  const coolingFilter = `last_interaction_at.lt.${cutoff},and(last_interaction_at.is.null,updated_at.lt.${cutoff})`

  // count: 'exact' sem head: true retorna data + count total em uma única query
  let query = svc
    .from('opportunities')
    .select('id, last_interaction_at, updated_at', { count: 'exact' })
    .eq('company_id', companyId)
    .eq('status', 'open')
    .or(coolingFilter)
    .limit(500) // defensivo; count continua refletindo o total real

  if (funnelId) {
    const { data: positions } = await svc
      .from('opportunity_funnel_positions')
      .select('opportunity_id')
      .eq('funnel_id', funnelId)
    const oppIds = (positions ?? []).map((p: { opportunity_id: string }) => p.opportunity_id)
    if (oppIds.length === 0) return null
    query = query.in('id', oppIds)
  }

  const { data: rows, count, error } = await query
  if (error) throw new Error(`cooling_opportunity: ${error.message}`)
  if (!count || count === 0) return null

  // Calcular oportunidade mais estagnada dentro do sample retornado
  const now = Date.now()
  let maxDays = 0
  let worstRow: CoolingRow | null = null

  for (const row of (rows as CoolingRow[] ?? [])) {
    const ref = row.last_interaction_at ?? row.updated_at
    const days = Math.floor((now - new Date(ref).getTime()) / (1000 * 60 * 60 * 24))
    if (days > maxDays) {
      maxDays = days
      worstRow  = row
    }
  }

  // Log de debug (DEV only) — usa rows já buscados, sem query extra
  // #region agent log DEV
  const isDev = process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production'
  if (isDev) {
    const debugSample = (rows as CoolingRow[] ?? []).slice(0, 3).map((r) => ({
      opportunity_id:      r.id,
      last_interaction_at: r.last_interaction_at,
      updated_at:          r.updated_at,
      used_field:          r.last_interaction_at ? 'last_interaction_at' : 'updated_at',
    }))
    console.log('[insights/cooling] debug sample:', JSON.stringify(debugSample))
  }
  // #endregion

  const priority: InsightPriority = count >= 10 ? 'critical' : count >= 5 ? 'high' : 'medium'

  return {
    id:          'cooling_opportunity',
    type:        'cooling_opportunity',
    priority,
    title:       `${count} oportunidade${count > 1 ? 's' : ''} sem atualização`,
    description: `Abertas há mais de ${policies.cooling_threshold_days} dia${policies.cooling_threshold_days > 1 ? 's' : ''} sem movimentação`,
    entityType:  'opportunities',
    filters:     { status: 'open', funnelId: funnelId ?? undefined },
    actionLabel: 'Ver oportunidades',
    supporting_data: {
      threshold_days:              policies.cooling_threshold_days,
      reference:                   'last_interaction',
      last_interaction_at:         worstRow?.last_interaction_at ?? null,
      updated_at:                  worstRow?.updated_at ?? null,
      days_since_last_interaction: maxDays,
    },
  }
}

// ---------------------------------------------------------------------------
// Insight 3 — Gargalo no pipeline
// Regra: etapa com maior avg_days_in_stage >= bottleneck_min_days
// Requer funnel_id
// ---------------------------------------------------------------------------

async function computeFunnelBottleneck(
  svc: SupabaseClient,
  _companyId: string,
  funnelId: string,
  policies: InsightPolicies,
): Promise<InsightItem | null> {
  // Etapas do funil
  const { data: stages, error: stagesErr } = await svc
    .from('funnel_stages')
    .select('id, name, position')
    .eq('funnel_id', funnelId)
    .order('position', { ascending: true })

  if (stagesErr) throw new Error(`bottleneck/stages: ${stagesErr.message}`)
  if (!stages || stages.length === 0) return null

  // Posições atuais (sem company_id)
  const { data: positions, error: posErr } = await svc
    .from('opportunity_funnel_positions')
    .select('stage_id, entered_stage_at, updated_at')
    .eq('funnel_id', funnelId)
    .limit(5_000)

  if (posErr) throw new Error(`bottleneck/positions: ${posErr.message}`)
  if (!positions || positions.length === 0) return null

  // Calcular avg_days_in_stage por etapa
  const nowMs = Date.now()
  const stageDays = new Map<string, number[]>()

  for (const pos of positions) {
    if (!pos.stage_id) continue
    const ref  = pos.entered_stage_at ?? pos.updated_at
    const days = ref ? (nowMs - new Date(ref).getTime()) / 86_400_000 : 0
    const list = stageDays.get(pos.stage_id) ?? []
    list.push(Math.max(0, days))
    stageDays.set(pos.stage_id, list)
  }

  // Encontrar a etapa com maior média, mínimo 3 dias
  let worstStageId   = ''
  let worstStageName = ''
  let worstAvg       = 0

  for (const stage of stages as Array<{ id: string; name: string; position: number }>) {
    const days = stageDays.get(stage.id)
    if (!days || days.length === 0) continue
    const avg = days.reduce((a, b) => a + b, 0) / days.length
    if (avg > worstAvg) {
      worstAvg       = avg
      worstStageId   = stage.id
      worstStageName = stage.name
    }
  }

  if (worstAvg < policies.bottleneck_min_days || !worstStageId) return null

  return {
    id:          'funnel_bottleneck',
    type:        'funnel_bottleneck',
    priority:    'high',
    title:       `Gargalo em "${worstStageName}"`,
    description: `Média de ${Math.round(worstAvg)} dias nessa etapa — acima do esperado`,
    entityType:  'opportunities',
    filters:     { stage_id: worstStageId, funnelId, status: 'open' },
    actionLabel: 'Ver oportunidades',
  }
}

// ---------------------------------------------------------------------------
// Insight 4 — Queda de conversão entre etapas
// Regra: menor conversion_rate_pct < conversion_drop_threshold no período
// Requer funnel_id
// ---------------------------------------------------------------------------

async function computeConversionDrop(
  svc: SupabaseClient,
  companyId: string,
  funnelId: string,
  resolvedRange: ResolvedRange,
  policies: InsightPolicies,
): Promise<InsightItem | null> {
  // Etapas ordenadas
  const { data: stages, error: stagesErr } = await svc
    .from('funnel_stages')
    .select('id, name, position')
    .eq('funnel_id', funnelId)
    .order('position', { ascending: true })

  if (stagesErr) throw new Error(`conversion_drop/stages: ${stagesErr.message}`)

  const stageList = (stages ?? []) as Array<{ id: string; name: string }>
  if (stageList.length < 2) return null

  // Histórico no período (apenas campos necessários)
  const { data: history, error: histErr } = await svc
    .from('opportunity_stage_history')
    .select('opportunity_id, to_stage_id')
    .eq('company_id', companyId)
    .eq('funnel_id', funnelId)
    .gte('created_at', resolvedRange.start)
    .lte('created_at', resolvedRange.end)
    .limit(5_000)

  if (histErr) throw new Error(`conversion_drop/history: ${histErr.message}`)
  if (!history || history.length === 0) return null

  // Sets de oportunidades distintas por etapa
  const oppSets = new Map<string, Set<string>>()
  for (const row of history) {
    if (!row.to_stage_id) continue
    let s = oppSets.get(row.to_stage_id)
    if (!s) { s = new Set<string>(); oppSets.set(row.to_stage_id, s) }
    s.add(row.opportunity_id)
  }

  // Encontrar o par de etapas com menor taxa de conversão < 40%
  let worstRate      = 100
  let worstFromName  = ''
  let worstToName    = ''

  for (let i = 0; i < stageList.length - 1; i++) {
    const fromSet = oppSets.get(stageList[i].id) ?? new Set<string>()
    const toSet   = oppSets.get(stageList[i + 1].id) ?? new Set<string>()
    if (fromSet.size === 0) continue

    let advanced = 0
    for (const id of fromSet) { if (toSet.has(id)) advanced++ }
    const rate = (advanced / fromSet.size) * 100

    if (rate < worstRate) {
      worstRate     = rate
      worstFromName = stageList[i].name
      worstToName   = stageList[i + 1].name
    }
  }

  if (worstRate >= policies.conversion_drop_threshold) return null

  return {
    id:          'conversion_drop',
    type:        'conversion_drop',
    priority:    'high',
    title:       `Conversão baixa: ${worstFromName} → ${worstToName}`,
    description: `Apenas ${Math.round(worstRate)}% das oportunidades avançam nessa etapa`,
    entityType:  'funnel',
    filters:     { funnelId },
    actionLabel: 'Analisar funil',
  }
}

// ---------------------------------------------------------------------------
// Insight 5 — Falhas de tools da IA
// Regra: agent_tool_executions, últimos 7 dias, success=false, taxa >= ai_error_rate_threshold
// Tabela e colunas são opcionais — falha silenciosa
// ---------------------------------------------------------------------------

async function computeAiToolIssues(
  svc: SupabaseClient,
  companyId: string,
  policies: InsightPolicies,
): Promise<InsightItem | null> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const [totalResult, failedResult] = await Promise.allSettled([
    svc
      .from('agent_tool_executions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', since),
    svc
      .from('agent_tool_executions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('success', false)
      .gte('created_at', since),
  ])

  if (totalResult.status === 'rejected' || failedResult.status === 'rejected') return null

  const total  = (totalResult.value  as { count: number | null }).count ?? 0
  const failed = (failedResult.value as { count: number | null }).count ?? 0

  if (total === 0 || failed === 0) return null

  const rate = (failed / total) * 100
  if (rate < policies.ai_error_rate_threshold) return null

  const priority: InsightPriority = rate >= 50 ? 'high' : 'medium'

  return {
    id:          'ai_tool_issue',
    type:        'ai_tool_issue',
    priority,
    title:       `${Math.round(rate)}% de falhas nas tools da IA`,
    description: `${failed} de ${total} execuções falharam nos últimos 7 dias`,
    entityType:  'conversations',
    filters:     {},
    actionLabel: 'Ver conversas',
  }
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<InsightPriority, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // 1. Auth
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // 2. company_id + membership
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // 3. Período
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: ResolvedRange
    try { resolvedRange = resolvePeriod(period, start_date, end_date) }
    catch (e: any) { jsonError(res, 400, e.message ?? 'Período inválido'); return }

    // 4. funnel_id opcional — valida se fornecido
    const rawFunnelId = typeof req.query.funnel_id === 'string' ? req.query.funnel_id.trim() : null
    let funnelId: string | null = null

    if (rawFunnelId) {
      const valid = await assertFunnelBelongsToCompany(svc, rawFunnelId, companyId)
      if (!valid) { jsonError(res, 403, 'funnel_id não pertence à empresa'); return }
      funnelId = rawFunnelId
    }

    // 5. Buscar policies da empresa (mescla com defaults — falha silenciosa)
    // e verificar permissão de customização — em paralelo para não bloquear
    const [policies, canCustomize] = await Promise.all([
      getInsightPolicies(svc, companyId),
      canCustomizeInsights(svc, companyId),
    ])

    // 6. Calcular insights em paralelo — falha isolada nunca quebra o endpoint
    const tasks = [
      computeHotOpportunities(svc, companyId, resolvedRange, funnelId, policies),
      computeCoolingOpportunities(svc, companyId, funnelId, policies),
      computeAiToolIssues(svc, companyId, policies),
      // Insights de funil só disponíveis quando funnel_id fornecido
      ...(funnelId
        ? [
            computeFunnelBottleneck(svc, companyId, funnelId, policies),
            computeConversionDrop(svc, companyId, funnelId, resolvedRange, policies),
          ]
        : []),
    ]

    const results = await Promise.allSettled(tasks)

    const insights: InsightItem[] = results
      .filter((r): r is PromiseFulfilledResult<InsightItem | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((v): v is InsightItem => v !== null)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
      .slice(0, 5)

    // 7. Resposta — cache curto (insights mudam com movimentações)
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120')

    return res.status(200).json({
      ok:   true,
      data: insights,
      meta: {
        period,
        start_date:    resolvedRange.start,
        end_date:      resolvedRange.end,
        funnel_id:     funnelId ?? null,
        can_customize: canCustomize,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/insights] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
