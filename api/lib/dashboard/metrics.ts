import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvedRange } from './period'

// ---------------------------------------------------------------------------
// Tipos de modo
// ---------------------------------------------------------------------------

export type AgentMode = 'single-agent' | 'multi-agent'
export type FunnelMode = 'single-funnel' | 'multi-funnel'

// ---------------------------------------------------------------------------
// Tipo de filtro canônico (descriptor — não executado aqui)
// ---------------------------------------------------------------------------

export type FilterOp = 'eq' | 'gte' | 'lte' | 'gt' | 'lt' | 'neq' | 'is'

export interface FilterDescriptor {
  field: string
  op: FilterOp
  value: string | number | boolean | null
}

export interface HotOpportunityFilter {
  company_id: string
  funnel_id?: string
  filters: FilterDescriptor[]
}

// ---------------------------------------------------------------------------
// Tipos de retorno das métricas executivas
// ---------------------------------------------------------------------------

export interface ExecutiveMetrics {
  leads_count: number
  conversations_count: number
  hot_opportunities_count: number
  alerts_count: number
}

// ---------------------------------------------------------------------------
// Tipos de stubs (Fase 1 — preenchidos quando endpoints forem implementados)
// ---------------------------------------------------------------------------

export interface StubResult<T = unknown> {
  data: T[]
  meta: { note: string }
}

export interface StageSnapshot {
  stage_id: string
  stage_name: string
  position: number
  count: number
  total_value: number
  avg_days_in_stage: number
}

export interface FunnelSnapshotResult {
  funnel_id: string
  stages: StageSnapshot[]
}

export interface StageFlow {
  stage_id: string
  stage_name: string
  position: number
  unique_count: number
  total_count: number
  by_trigger_source: {
    ai: number
    human: number
    automation: number
    system: number
  }
  avg_days_prev_stage: number
}

export interface FunnelFlowResult {
  funnel_id: string
  stages: StageFlow[]
}

export interface StageConversion {
  from_stage_id: string
  from_stage_name: string
  to_stage_id: string
  to_stage_name: string
  advanced: number
  in_source: number
  conversion_rate_pct: number
}

export interface FunnelConversionResult {
  funnel_id: string
  conversions: StageConversion[]
}

export interface FunnelOverviewItem {
  funnel_id: string
  funnel_name: string
  count: number
  total_count: number
  top_bottleneck_stage_name: string | null
}

// ---------------------------------------------------------------------------
// detectAgentMode
// ---------------------------------------------------------------------------

/**
 * Detecta se a empresa opera com um único agente ativo ou múltiplos.
 *
 * Estratégia: amostra os últimos 30 dias de agent_tool_executions
 * e conta agent_ids distintos. Janela curta garante query leve.
 * company_id obrigatório — sem ele a query varre toda a tabela.
 */
export async function detectAgentMode(
  svc: SupabaseClient,
  companyId: string,
): Promise<AgentMode> {
  if (!companyId) throw new Error('detectAgentMode: companyId é obrigatório')

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const { data, error } = await svc
    .from('agent_tool_executions')
    .select('agent_id')
    .eq('company_id', companyId)
    .gte('executed_at', since)
    .limit(500) // nunca varre a tabela inteira

  if (error) throw new Error(`detectAgentMode: ${error.message}`)

  const unique = new Set((data ?? []).map((r: { agent_id: string }) => r.agent_id))
  return unique.size > 1 ? 'multi-agent' : 'single-agent'
}

// ---------------------------------------------------------------------------
// detectFunnelMode
// ---------------------------------------------------------------------------

/**
 * Detecta se a empresa tem um único funil ativo ou múltiplos.
 * Query leve: apenas COUNT em sales_funnels com company_id + is_active.
 */
export async function detectFunnelMode(
  svc: SupabaseClient,
  companyId: string,
): Promise<FunnelMode> {
  if (!companyId) throw new Error('detectFunnelMode: companyId é obrigatório')

  const { count, error } = await svc
    .from('sales_funnels')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_active', true)

  if (error) throw new Error(`detectFunnelMode: ${error.message}`)

  return (count ?? 0) > 1 ? 'multi-funnel' : 'single-funnel'
}

// ---------------------------------------------------------------------------
// buildHotOpportunityFilter
// ---------------------------------------------------------------------------

/**
 * Retorna o filtro canônico de "oportunidades quentes" como descriptor.
 * Implementação real e sem acesso ao banco — os endpoints aplicam os filtros.
 *
 * Regras autoritativas (nunca calculadas no frontend):
 * - status = 'open'
 * - probability >= 70
 * - updated_at >= resolvedRange.start (contexto temporal obrigatório)
 */
export function buildHotOpportunityFilter(
  companyId: string,
  resolvedRange: ResolvedRange,
  funnelId?: string,
): HotOpportunityFilter {
  if (!companyId) throw new Error('buildHotOpportunityFilter: companyId é obrigatório')
  if (!resolvedRange?.start) throw new Error('buildHotOpportunityFilter: resolvedRange.start é obrigatório')

  const filter: HotOpportunityFilter = {
    company_id: companyId,
    filters: [
      { field: 'status',      op: 'eq',  value: 'open' },
      { field: 'probability', op: 'gte', value: 70 },
      { field: 'updated_at',  op: 'gte', value: resolvedRange.start },
    ],
  }

  if (funnelId) {
    filter.funnel_id = funnelId
  }

  return filter
}

// ---------------------------------------------------------------------------
// buildExecutiveMetrics
// ---------------------------------------------------------------------------

/**
 * KPIs executivos: 4 contagens simples em paralelo.
 * Cada query é leve (COUNT com company_id + filtro temporal).
 * Promise.allSettled garante que falha isolada retorna 0 sem quebrar o restante.
 */
export async function buildExecutiveMetrics(
  svc: SupabaseClient,
  companyId: string,
  resolvedRange: ResolvedRange,
): Promise<ExecutiveMetrics> {
  if (!companyId) throw new Error('buildExecutiveMetrics: companyId é obrigatório')
  if (!resolvedRange?.start) throw new Error('buildExecutiveMetrics: resolvedRange é obrigatório')

  const [leadsResult, convsResult, alertsResult, hotResult] = await Promise.allSettled([
    svc
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('created_at', resolvedRange.start)
      .lte('created_at', resolvedRange.end),

    svc
      .from('chat_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('updated_at', resolvedRange.start),

    svc
      .from('ai_insights')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('insight_type', 'critical')
      .is('acknowledged_at', null)
      .gt('expires_at', new Date().toISOString()),

    svc
      .from('opportunity_funnel_positions')
      .select('opportunity_id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .gte('updated_at', resolvedRange.start),
  ])

  const safeCount = (r: PromiseSettledResult<{ count: number | null; error: unknown }>) =>
    r.status === 'fulfilled' ? (r.value.count ?? 0) : 0

  return {
    leads_count:             safeCount(leadsResult  as PromiseSettledResult<{ count: number | null; error: unknown }>),
    conversations_count:     safeCount(convsResult  as PromiseSettledResult<{ count: number | null; error: unknown }>),
    hot_opportunities_count: safeCount(hotResult    as PromiseSettledResult<{ count: number | null; error: unknown }>),
    alerts_count:            safeCount(alertsResult as PromiseSettledResult<{ count: number | null; error: unknown }>),
  }
}

// ---------------------------------------------------------------------------
// buildFunnelSnapshotMetrics  (SNAPSHOT — estado atual)
// ---------------------------------------------------------------------------

/**
 * Responde: "Onde estão as oportunidades AGORA?"
 *
 * Fonte: opportunity_funnel_positions (posição atual de cada oportunidade).
 * NÃO usa período. NÃO usa opportunity_stage_history.
 *
 * Complexidade: 2 queries + agregação em memória.
 *   - Query 1: etapas do funil (tabela pequena, cache amigável)
 *   - Query 2: posições ativas, company_id + funnel_id (índice esperado)
 *
 * Limite defensivo: 10 000 posições por funil.
 * Etapas sem oportunidades são retornadas com count = 0.
 */
export async function buildFunnelSnapshotMetrics(
  svc: SupabaseClient,
  companyId: string,
  funnelId: string,
): Promise<FunnelSnapshotResult> {
  if (!companyId) throw new Error('buildFunnelSnapshotMetrics: companyId é obrigatório')
  if (!funnelId)  throw new Error('buildFunnelSnapshotMetrics: funnelId é obrigatório')

  // 1. Etapas do funil ordenadas por posição
  const { data: stages, error: stagesErr } = await svc
    .from('funnel_stages')
    .select('id, name, position')
    .eq('funnel_id', funnelId)
    .order('position', { ascending: true })

  if (stagesErr) throw new Error(`buildFunnelSnapshotMetrics/stages: ${stagesErr.message}`)
  if (!stages || stages.length === 0) return { funnel_id: funnelId, stages: [] }

  // 2. Posições atuais de todas as oportunidades no funil
  const { data: positions, error: posErr } = await svc
    .from('opportunity_funnel_positions')
    .select('stage_id, entered_stage_at, updated_at')
    .eq('company_id', companyId)
    .eq('funnel_id', funnelId)
    .limit(10_000)

  if (posErr) throw new Error(`buildFunnelSnapshotMetrics/positions: ${posErr.message}`)

  // 3. Agregar por stage_id em memória
  type StageAgg = { count: number; totalDaysSum: number }
  const aggMap = new Map<string, StageAgg>()
  const nowMs  = Date.now()

  for (const pos of positions ?? []) {
    const stageId  = pos.stage_id
    if (!stageId) continue

    const ref  = pos.entered_stage_at ?? pos.updated_at
    const days = ref ? (nowMs - new Date(ref).getTime()) / 86_400_000 : 0

    const agg = aggMap.get(stageId) ?? { count: 0, totalDaysSum: 0 }
    agg.count++
    agg.totalDaysSum += Math.max(0, days)
    aggMap.set(stageId, agg)
  }

  // 4. Montar resultado — todas as etapas retornadas, mesmo vazias
  const resultStages: StageSnapshot[] = (stages as Array<{ id: string; name: string; position: number }>)
    .map((s) => {
      const agg = aggMap.get(s.id)
      return {
        stage_id:          s.id,
        stage_name:        s.name,
        position:          s.position,
        count:             agg?.count ?? 0,
        total_value:       0,
        avg_days_in_stage: agg && agg.count > 0
          ? Math.round((agg.totalDaysSum / agg.count) * 10) / 10
          : 0,
      }
    })

  return { funnel_id: funnelId, stages: resultStages }
}

// ---------------------------------------------------------------------------
// buildFunnelFlowMetrics  (FLOW — movimento no período)
// ---------------------------------------------------------------------------

/**
 * Responde: "Por quais etapas as oportunidades PASSARAM no período?"
 *
 * Fonte: opportunity_stage_history filtrado por [start, end].
 * NUNCA usa opportunity_funnel_positions (seria SNAPSHOT).
 *
 * Contagem correta:
 *   unique_count → COUNT(DISTINCT opportunity_id) via Set
 *   total_count  → COUNT(*) simples
 *
 * trigger_source: pode ser null se migration Pre-Fase 1-B ainda não rodou.
 *   Nesse caso, classifica como 'system'.
 *
 * Limite defensivo: 10 000 registros por funil × período.
 */
export async function buildFunnelFlowMetrics(
  svc: SupabaseClient,
  companyId: string,
  funnelId: string,
  resolvedRange: ResolvedRange,
): Promise<FunnelFlowResult> {
  if (!companyId)         throw new Error('buildFunnelFlowMetrics: companyId é obrigatório')
  if (!funnelId)          throw new Error('buildFunnelFlowMetrics: funnelId é obrigatório')
  if (!resolvedRange?.start) throw new Error('buildFunnelFlowMetrics: resolvedRange é obrigatório')

  // 1. Etapas do funil ordenadas por posição
  const { data: stages, error: stagesErr } = await svc
    .from('funnel_stages')
    .select('id, name, position')
    .eq('funnel_id', funnelId)
    .order('position', { ascending: true })

  if (stagesErr) throw new Error(`buildFunnelFlowMetrics/stages: ${stagesErr.message}`)
  if (!stages || stages.length === 0) return { funnel_id: funnelId, stages: [] }

  // 2. Histórico de movimentações no período
  const { data: history, error: histErr } = await svc
    .from('opportunity_stage_history')
    .select('opportunity_id, to_stage_id, trigger_source')
    .eq('company_id', companyId)
    .eq('funnel_id', funnelId)
    .gte('created_at', resolvedRange.start)
    .lte('created_at', resolvedRange.end)
    .limit(10_000)

  if (histErr) throw new Error(`buildFunnelFlowMetrics/history: ${histErr.message}`)

  // 3. Agregar por to_stage_id + trigger_source em memória
  type SourceKey = 'ai' | 'human' | 'automation' | 'system'
  type StageFlowAgg = {
    uniqueOpps: Set<string>
    total_count: number
    by_source: Record<SourceKey, number>
  }

  const aggMap = new Map<string, StageFlowAgg>()

  for (const row of history ?? []) {
    const stageId = row.to_stage_id
    if (!stageId) continue

    let agg = aggMap.get(stageId)
    if (!agg) {
      agg = {
        uniqueOpps:  new Set<string>(),
        total_count: 0,
        by_source:   { ai: 0, human: 0, automation: 0, system: 0 },
      }
      aggMap.set(stageId, agg)
    }

    agg.uniqueOpps.add(row.opportunity_id)
    agg.total_count++

    const src = (row.trigger_source ?? 'system') as SourceKey
    const validSrc: SourceKey = ['ai', 'human', 'automation', 'system'].includes(src)
      ? src
      : 'system'
    agg.by_source[validSrc]++
  }

  // 4. Montar resultado — todas as etapas, inclusive sem movimentações
  const resultStages: StageFlow[] = (stages as Array<{ id: string; name: string; position: number }>)
    .map((s) => {
      const agg = aggMap.get(s.id)
      return {
        stage_id:           s.id,
        stage_name:         s.name,
        position:           s.position,
        unique_count:       agg?.uniqueOpps.size ?? 0,
        total_count:        agg?.total_count ?? 0,
        by_trigger_source:  agg?.by_source ?? { ai: 0, human: 0, automation: 0, system: 0 },
        avg_days_prev_stage: 0,
      }
    })

  return { funnel_id: funnelId, stages: resultStages }
}

// ---------------------------------------------------------------------------
// buildFunnelStageConversionMetrics  (CONVERSÃO — eficiência entre etapas)
// ---------------------------------------------------------------------------

/**
 * Responde: "Qual a taxa de conversão entre etapas consecutivas?"
 *
 * Fonte: opportunity_stage_history (FLOW), mesmo período do endpoint.
 * NUNCA usa SNAPSHOT para conversão.
 *
 * Algoritmo (para cada par de etapas consecutivas A → B):
 *   1. visited_A  = Set(DISTINCT opportunity_id WHERE to_stage_id = A)
 *   2. visited_B  = Set(DISTINCT opportunity_id WHERE to_stage_id = B)
 *   3. advanced   = |visited_A ∩ visited_B|
 *   4. conversion = advanced / |visited_A|
 *
 * Observação: "intersecção" garante que só contamos oportunidades que
 * visitaram AMBAS as etapas, sem assumir ordem temporal exata.
 * Uma oportunidade que foi A→B→A→B é contada uma vez em cada set.
 *
 * Limite defensivo: mesmos 10 000 registros.
 */
export async function buildFunnelStageConversionMetrics(
  svc: SupabaseClient,
  companyId: string,
  funnelId: string,
  resolvedRange: ResolvedRange,
): Promise<FunnelConversionResult> {
  if (!companyId)         throw new Error('buildFunnelStageConversionMetrics: companyId é obrigatório')
  if (!funnelId)          throw new Error('buildFunnelStageConversionMetrics: funnelId é obrigatório')
  if (!resolvedRange?.start) throw new Error('buildFunnelStageConversionMetrics: resolvedRange é obrigatório')

  // 1. Etapas do funil ordenadas por posição
  const { data: stages, error: stagesErr } = await svc
    .from('funnel_stages')
    .select('id, name, position')
    .eq('funnel_id', funnelId)
    .order('position', { ascending: true })

  if (stagesErr) throw new Error(`buildFunnelStageConversionMetrics/stages: ${stagesErr.message}`)

  const stageList = (stages ?? []) as Array<{ id: string; name: string; position: number }>
  if (stageList.length < 2) return { funnel_id: funnelId, conversions: [] }

  // 2. Histórico no período — apenas campos necessários para conversão
  const { data: history, error: histErr } = await svc
    .from('opportunity_stage_history')
    .select('opportunity_id, to_stage_id')
    .eq('company_id', companyId)
    .eq('funnel_id', funnelId)
    .gte('created_at', resolvedRange.start)
    .lte('created_at', resolvedRange.end)
    .limit(10_000)

  if (histErr) throw new Error(`buildFunnelStageConversionMetrics/history: ${histErr.message}`)

  // 3. Construir Set de oportunidades distintas por etapa
  //    (DISTINCT garantido pelo Set — COUNT(*) jamais usado para conversão)
  const oppSetPerStage = new Map<string, Set<string>>()

  for (const row of history ?? []) {
    if (!row.to_stage_id) continue
    let s = oppSetPerStage.get(row.to_stage_id)
    if (!s) { s = new Set<string>(); oppSetPerStage.set(row.to_stage_id, s) }
    s.add(row.opportunity_id)
  }

  // 4. Calcular conversão para cada par consecutivo de etapas
  const conversions: StageConversion[] = []

  for (let i = 0; i < stageList.length - 1; i++) {
    const fromStage = stageList[i]
    const toStage   = stageList[i + 1]

    const fromSet = oppSetPerStage.get(fromStage.id) ?? new Set<string>()
    const toSet   = oppSetPerStage.get(toStage.id)   ?? new Set<string>()

    const inSource = fromSet.size
    // Intersecção: opps que visitaram AMBAS as etapas no período
    let advanced = 0
    for (const oppId of fromSet) {
      if (toSet.has(oppId)) advanced++
    }

    conversions.push({
      from_stage_id:       fromStage.id,
      from_stage_name:     fromStage.name,
      to_stage_id:         toStage.id,
      to_stage_name:       toStage.name,
      advanced,
      in_source:           inSource,
      conversion_rate_pct: inSource > 0 ? Math.round((advanced / inSource) * 1000) / 10 : 0,
    })
  }

  return { funnel_id: funnelId, conversions }
}

// ---------------------------------------------------------------------------
// buildAllFunnelsOverview — STUB (Fase 1)
// ---------------------------------------------------------------------------

/**
 * STUB — implementação completa no endpoint summary (visão "Todos os funis").
 * Nunca calcula conversão por etapa entre funis diferentes.
 */
export async function buildAllFunnelsOverview(
  _svc: SupabaseClient,
  companyId: string,
  _resolvedRange: ResolvedRange,
): Promise<FunnelOverviewItem[]> {
  if (!companyId) throw new Error('buildAllFunnelsOverview: companyId é obrigatório')

  return []
}
