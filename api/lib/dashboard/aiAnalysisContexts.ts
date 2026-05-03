// =====================================================
// aiAnalysisContexts
//
// Builders de contexto seguro para IA Analítica sob demanda.
// Cada builder: consulta o banco, agrega dados, retorna contexto
// sem dados sensíveis + estimativa de créditos.
//
// PROIBIDO no contexto: nome de lead, CPF, telefone, email,
// conteúdo bruto de conversa, mensagens de WhatsApp.
//
// Permitido: contagens, médias, taxas, IDs opacos, resumos.
//
// context_version = 'v1' — incrementar se a estrutura mudar.
// =====================================================

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type AnalysisType = 'cooling_opportunities' | 'conversion_drop' | 'funnel_overview'

export const MVP_ANALYSIS_TYPES: AnalysisType[] = [
  'cooling_opportunities',
  'conversion_drop',
  'funnel_overview',
]

const CONTEXT_VERSION  = 'v1'
export const PROMPT_VERSION   = 'v2'
const CREDIT_RATE      = 100
const INSIGHTS_MULTIPLIER = 6

// Estimativas conservadoras por tipo (tokens: system + contexto + resposta esperada)
const ESTIMATED_TOKENS: Record<AnalysisType, number> = {
  cooling_opportunities: 2000,
  conversion_drop:       2500,
  funnel_overview:       3000,
}

// max_tokens por tipo: evita truncamento sem desperdiçar tokens em respostas curtas
export const MAX_TOKENS_BY_TYPE: Record<AnalysisType, number> = {
  cooling_opportunities: 1500,
  conversion_drop:       1500,
  funnel_overview:       2000,
}

export interface AnalysisContextResult {
  input_summary:      Record<string, unknown>
  system_prompt:      string
  user_prompt:        string
  context_version:    string
  input_hash:         string
  estimated_tokens:   number
  estimated_credits:  number
  max_tokens:         number
  system_prompt_hash: string
}

// ---------------------------------------------------------------------------
// Hash determinístico
// ---------------------------------------------------------------------------

function generateHash(seed: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(seed)).digest('hex')
}

// ---------------------------------------------------------------------------
// Builder 1 — cooling_opportunities
// ---------------------------------------------------------------------------

async function buildCoolingContext(
  svc: SupabaseClient,
  companyId: string,
  period: string,
  resolvedRange: { start: string; end: string },
  funnelId: string | null,
): Promise<AnalysisContextResult> {
  const COOLING_DAYS = 7
  const cutoff = new Date(Date.now() - COOLING_DAYS * 86_400_000).toISOString()
  const coolingFilter = `last_interaction_at.lt.${cutoff},and(last_interaction_at.is.null,updated_at.lt.${cutoff})`

  let query = svc
    .from('opportunities')
    .select('id, probability, last_interaction_at, updated_at', { count: 'exact' })
    .eq('company_id', companyId)
    .eq('status', 'open')
    .or(coolingFilter)
    .limit(500)

  if (funnelId) {
    const { data: positions } = await svc
      .from('opportunity_funnel_positions')
      .select('opportunity_id')
      .eq('funnel_id', funnelId)
    const ids = (positions ?? []).map((p: any) => p.opportunity_id)
    if (ids.length === 0) {
      query = query.in('id', ['00000000-0000-0000-0000-000000000000'])
    } else {
      query = query.in('id', ids)
    }
  }

  const { data: rows, count } = await query
  const total = count ?? 0
  const now = Date.now()

  // Distribuição por dias sem interação (buckets)
  const buckets = { d7to14: 0, d14to30: 0, d30to60: 0, d60plus: 0 }
  let totalDays = 0

  for (const row of (rows ?? []) as any[]) {
    const ref  = row.last_interaction_at ?? row.updated_at
    const days = ref ? Math.floor((now - new Date(ref).getTime()) / 86_400_000) : 0
    totalDays += days
    if (days < 14)       buckets.d7to14++
    else if (days < 30)  buckets.d14to30++
    else if (days < 60)  buckets.d30to60++
    else                 buckets.d60plus++
  }

  // Probabilidade média (sem expor valores individuais)
  const avgProbability = rows && rows.length > 0
    ? Math.round((rows as any[]).reduce((s: number, r: any) => s + (r.probability ?? 0), 0) / rows.length)
    : 0

  // Funil (nome apenas se funnel_id fornecido)
  let funnelName: string | null = null
  if (funnelId) {
    const { data: funnel } = await svc
      .from('sales_funnels').select('name').eq('id', funnelId).maybeSingle()
    funnelName = funnel?.name ?? null
  }

  const input_summary = {
    analysis_type:       'cooling_opportunities',
    context_version:     CONTEXT_VERSION,
    period,
    resolved_range:      resolvedRange,
    funnel_id:           funnelId,
    funnel_name:         funnelName,
    cooling_threshold_days: COOLING_DAYS,
    total_cooling:       total,
    distribution_days:   buckets,
    avg_days_without_interaction: rows?.length
      ? Math.round(totalDays / rows.length) : 0,
    avg_probability:     avgProbability,
    sample_size:         rows?.length ?? 0,
  }

  const hashSeed = { company_id: companyId, analysis_type: 'cooling_opportunities',
    funnel_id: funnelId, period, context_version: CONTEXT_VERSION,
    total_cooling: total, avg_days: input_summary.avg_days_without_interaction }

  const system_prompt      = buildSystemPrompt('cooling_opportunities')
  const user_prompt        = buildUserPrompt(input_summary)
  const estimated_tokens   = ESTIMATED_TOKENS.cooling_opportunities
  const estimated_credits  = Math.ceil((estimated_tokens / 1000) * CREDIT_RATE * INSIGHTS_MULTIPLIER)
  const max_tokens         = MAX_TOKENS_BY_TYPE.cooling_opportunities
  const system_prompt_hash = generateFinalPromptHash('cooling_opportunities', system_prompt)

  return { input_summary, system_prompt, user_prompt, context_version: CONTEXT_VERSION,
    input_hash: generateHash(hashSeed), estimated_tokens, estimated_credits, max_tokens, system_prompt_hash }
}

// ---------------------------------------------------------------------------
// Builder 2 — conversion_drop (requer funnel_id)
// ---------------------------------------------------------------------------

async function buildConversionDropContext(
  svc: SupabaseClient,
  companyId: string,
  period: string,
  resolvedRange: { start: string; end: string },
  funnelId: string,
): Promise<AnalysisContextResult> {
  const { data: funnel } = await svc
    .from('sales_funnels').select('name').eq('id', funnelId).maybeSingle()

  const { data: stages } = await svc
    .from('funnel_stages').select('id, name, position')
    .eq('funnel_id', funnelId).order('position', { ascending: true })

  const stageList = (stages ?? []) as Array<{ id: string; name: string; position: number }>

  // Histórico de movimentações no período
  const { data: history } = await svc
    .from('opportunity_stage_history')
    .select('opportunity_id, to_stage_id')
    .eq('company_id', companyId).eq('funnel_id', funnelId)
    .gte('created_at', resolvedRange.start).lte('created_at', resolvedRange.end)
    .limit(5000)

  // Contagem de oportunidades distintas por etapa
  const stageCount: Record<string, number> = {}
  for (const h of (history ?? []) as any[]) {
    if (!h.to_stage_id) continue
    stageCount[h.to_stage_id] = (stageCount[h.to_stage_id] ?? 0) + 1
  }

  // Taxa de conversão por par de etapas consecutivas
  const stageConversions: Array<{ from: string; to: string; from_count: number; to_count: number; rate_pct: number }> = []
  for (let i = 0; i < stageList.length - 1; i++) {
    const fromCount = stageCount[stageList[i].id]     ?? 0
    const toCount   = stageCount[stageList[i + 1].id] ?? 0
    const rate = fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0
    stageConversions.push({
      from: stageList[i].name, to: stageList[i + 1].name,
      from_count: fromCount, to_count: toCount, rate_pct: rate,
    })
  }

  // Etapa com pior conversão
  const worstConversion = stageConversions.reduce(
    (worst, s) => (s.from_count > 0 && s.rate_pct < worst.rate_pct) ? s : worst,
    { from: '', to: '', from_count: 0, to_count: 0, rate_pct: 100 }
  )

  const input_summary = {
    analysis_type:    'conversion_drop',
    context_version:  CONTEXT_VERSION,
    period,
    resolved_range:   resolvedRange,
    funnel_id:        funnelId,
    funnel_name:      funnel?.name ?? null,
    total_stages:     stageList.length,
    stage_conversions: stageConversions,
    worst_conversion: worstConversion.from_count > 0 ? worstConversion : null,
    total_movements:  history?.length ?? 0,
  }

  const hashSeed = { company_id: companyId, analysis_type: 'conversion_drop',
    funnel_id: funnelId, period, context_version: CONTEXT_VERSION,
    stage_conversions: stageConversions.map(s => s.rate_pct) }

  const system_prompt      = buildSystemPrompt('conversion_drop')
  const user_prompt        = buildUserPrompt(input_summary)
  const estimated_tokens   = ESTIMATED_TOKENS.conversion_drop
  const estimated_credits  = Math.ceil((estimated_tokens / 1000) * CREDIT_RATE * INSIGHTS_MULTIPLIER)
  const max_tokens         = MAX_TOKENS_BY_TYPE.conversion_drop
  const system_prompt_hash = generateFinalPromptHash('conversion_drop', system_prompt)

  return { input_summary, system_prompt, user_prompt, context_version: CONTEXT_VERSION,
    input_hash: generateHash(hashSeed), estimated_tokens, estimated_credits, max_tokens, system_prompt_hash }
}

// ---------------------------------------------------------------------------
// Builder 3 — funnel_overview (requer funnel_id)
// ---------------------------------------------------------------------------

async function buildFunnelOverviewContext(
  svc: SupabaseClient,
  companyId: string,
  period: string,
  resolvedRange: { start: string; end: string },
  funnelId: string,
): Promise<AnalysisContextResult> {
  const { data: funnel } = await svc
    .from('sales_funnels').select('name').eq('id', funnelId).maybeSingle()

  const { data: stages } = await svc
    .from('funnel_stages').select('id, name, position')
    .eq('funnel_id', funnelId).order('position', { ascending: true })

  const stageList = (stages ?? []) as Array<{ id: string; name: string; position: number }>

  // Posições atuais (pipeline snapshot)
  const { data: positions } = await svc
    .from('opportunity_funnel_positions')
    .select('stage_id, entered_stage_at, updated_at')
    .eq('funnel_id', funnelId).limit(5000)

  // Distribuição por etapa + tempo médio em cada etapa
  const now = Date.now()
  const stageStats: Record<string, { count: number; totalDays: number }> = {}
  for (const pos of (positions ?? []) as any[]) {
    if (!pos.stage_id) continue
    const ref  = pos.entered_stage_at ?? pos.updated_at
    const days = ref ? (now - new Date(ref).getTime()) / 86_400_000 : 0
    if (!stageStats[pos.stage_id]) stageStats[pos.stage_id] = { count: 0, totalDays: 0 }
    stageStats[pos.stage_id].count++
    stageStats[pos.stage_id].totalDays += days
  }

  const stageBreakdown = stageList.map(s => ({
    name:         s.name,
    position:     s.position,
    active_count: stageStats[s.id]?.count ?? 0,
    avg_days_in_stage: stageStats[s.id]?.count
      ? Math.round(stageStats[s.id].totalDays / stageStats[s.id].count)
      : 0,
  }))

  // Status distribution no período
  const { data: statusDist } = await svc
    .from('opportunities')
    .select('status')
    .eq('company_id', companyId)
    .gte('updated_at', resolvedRange.start).lte('updated_at', resolvedRange.end)

  const statusCount: Record<string, number> = {}
  for (const o of (statusDist ?? []) as any[]) {
    statusCount[o.status] = (statusCount[o.status] ?? 0) + 1
  }

  // Total de oportunidades ativas no funil
  const totalActive = positions?.length ?? 0

  const input_summary = {
    analysis_type:    'funnel_overview',
    context_version:  CONTEXT_VERSION,
    period,
    resolved_range:   resolvedRange,
    funnel_id:        funnelId,
    funnel_name:      funnel?.name ?? null,
    total_active_in_funnel: totalActive,
    status_distribution_period: statusCount,
    stage_breakdown:  stageBreakdown,
    total_stages:     stageList.length,
  }

  const hashSeed = { company_id: companyId, analysis_type: 'funnel_overview',
    funnel_id: funnelId, period, context_version: CONTEXT_VERSION,
    total_active: totalActive, stage_counts: stageBreakdown.map(s => s.active_count) }

  const system_prompt      = buildSystemPrompt('funnel_overview')
  const user_prompt        = buildUserPrompt(input_summary)
  const estimated_tokens   = ESTIMATED_TOKENS.funnel_overview
  const estimated_credits  = Math.ceil((estimated_tokens / 1000) * CREDIT_RATE * INSIGHTS_MULTIPLIER)
  const max_tokens         = MAX_TOKENS_BY_TYPE.funnel_overview
  const system_prompt_hash = generateFinalPromptHash('funnel_overview', system_prompt)

  return { input_summary, system_prompt, user_prompt, context_version: CONTEXT_VERSION,
    input_hash: generateHash(hashSeed), estimated_tokens, estimated_credits, max_tokens, system_prompt_hash }
}

// ---------------------------------------------------------------------------
// Dispatcher principal
// ---------------------------------------------------------------------------

export async function buildAnalysisContext(
  svc: SupabaseClient,
  companyId: string,
  analysisType: AnalysisType,
  period: string,
  resolvedRange: { start: string; end: string },
  funnelId: string | null,
): Promise<AnalysisContextResult> {
  if (analysisType === 'cooling_opportunities') {
    return buildCoolingContext(svc, companyId, period, resolvedRange, funnelId)
  }
  if (analysisType === 'conversion_drop') {
    if (!funnelId) throw new Error('funnel_id é obrigatório para conversion_drop')
    return buildConversionDropContext(svc, companyId, period, resolvedRange, funnelId)
  }
  if (analysisType === 'funnel_overview') {
    if (!funnelId) throw new Error('funnel_id é obrigatório para funnel_overview')
    return buildFunnelOverviewContext(svc, companyId, period, resolvedRange, funnelId)
  }
  throw new Error(`Tipo de análise não suportado: ${analysisType}`)
}

// ---------------------------------------------------------------------------
// Reconstrói prompt a partir do input_summary salvo (para resume/retomada)
// ---------------------------------------------------------------------------

export function buildPromptsFromSummary(inputSummary: Record<string, unknown>): {
  system_prompt:      string
  user_prompt:        string
  system_prompt_hash: string
  max_tokens:         number
} {
  const type = inputSummary.analysis_type as AnalysisType
  const system_prompt = buildSystemPrompt(type)
  return {
    system_prompt,
    user_prompt:        buildUserPrompt(inputSummary),
    system_prompt_hash: generateFinalPromptHash(type, system_prompt),
    max_tokens:         MAX_TOKENS_BY_TYPE[type] ?? 1500,
  }
}

// ---------------------------------------------------------------------------
// Builders de prompt — APENAS dados do input_summary (sem dados sensíveis)
//
// Ordem obrigatória no system prompt:
//   1. Persona
//   2. Regras de segurança e integridade (fixas, nunca alteráveis)
//   3. Instrução de análise (específica por tipo)
//   4. Complemento customizado (opcional — inserido entre instrução e contexto)
//   5. Contexto dos dados (referência ao user message)
//   6. Formato de resposta obrigatório (schema JSON)
//   7. Instrução final (apenas JSON, sem texto extra)
//
// prompt_version = PROMPT_VERSION — incrementar ao alterar estrutura
// system_prompt_hash = SHA-256 do prompt COMPLETO FINAL (não parcial)
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA_DESCRIPTION = `{
  "title": "string — 1 frase com o dado central e um número. Ex: '31 oportunidades sem contato há mais de 30 dias'",
  "summary": "string — MÁXIMO 2 frases: (1) problema principal com dado numérico, (2) urgência ou risco. Ex: '40% das oportunidades ativas não receberam contato há mais de 14 dias. O bucket 30-60 dias concentra o maior risco de perda.'",
  "findings": [
    "string — MÁXIMO 3 itens. Cada finding: 1 frase com número ou percentual extraído do contexto. Não repita o title. Ex: '12 oportunidades no bucket 30-60 dias representam 52% do volume esfriando'"
  ],
  "recommended_actions": [
    "string — MÁXIMO 3 itens. Comece com verbo no imperativo + objeto específico + critério. Ex: 'Contate hoje as oportunidades com probabilidade acima de 50% paradas há mais de 30 dias'"
  ],
  "next_best_actions": [
    {
      "title": "string — máximo 5 palavras. Ex: 'Ver leads parados >30 dias'",
      "description": "string — 1 frase: ação + resultado esperado. Ex: 'Acesse as oportunidades mais quentes deste bucket para reativar o pipeline esta semana'",
      "action_type": "open_filtered_opportunities | open_funnel_stage",
      "filters": {},
      "impact": "high | medium | low"
    }
  ],
  "limitations": [
    "string — MÁXIMO 2 itens. Inclua apenas se os dados forem claramente insuficientes para a análise"
  ]
}

FILTROS VÁLIDOS — preencha o objeto filters conforme action_type:
- open_filtered_opportunities → { "days_inactive_min": N, "days_inactive_max": N (opcional), "min_probability": N (opcional, 0-100) }
- open_funnel_stage → { "stage_name": "nome EXATO da etapa conforme stage_breakdown ou stage_conversions" }

REGRAS DO SCHEMA:
- next_best_actions: sempre entre 1 e 3 itens, ordenados por impact (high primeiro)
- next_best_actions[].filters: nunca deixar vazio — use os campos válidos acima
- Se o dado central for zero (ex: total_cooling=0): findings=[], recommended_actions=["Nenhuma ação necessária no momento"], next_best_actions=[], explique em limitations`

const TYPE_INSTRUCTIONS: Record<AnalysisType, string> = {
  cooling_opportunities: [
    'ANÁLISE: OPORTUNIDADES ESFRIANDO',
    '',
    'Objetivo: ajudar o vendedor a decidir QUAIS oportunidades contatar AGORA e em que ordem.',
    '',
    'Execute esta sequência:',
    '1. Identifique o bucket mais crítico usando esta hierarquia: d60plus > d30to60 > d14to30 > d7to14',
    '   — O bucket mais crítico é aquele com maior volume absoluto dentro da hierarquia acima',
    '2. Calcule o percentual de cada bucket sobre total_cooling para o summary',
    '3. Use avg_probability para qualificar o risco financeiro:',
    '   — avg_probability >= 50: risco alto (impacto financeiro direto)',
    '   — avg_probability 25-49: risco médio',
    '   — avg_probability < 25: risco baixo (pipeline frio)',
    '4. Monte next_best_actions (1 a 3) nesta ordem de prioridade:',
    '   a) HIGH: oportunidades no bucket mais crítico → open_filtered_opportunities com days_inactive_min correspondente',
    '      — Ex: d30to60 → { "days_inactive_min": 30, "days_inactive_max": 60 }',
    '      — Se avg_probability >= 40, adicione "min_probability": 40',
    '   b) MEDIUM (se d60plus > 0): oportunidades >60 dias → { "days_inactive_min": 60 }',
    '   c) LOW (opcional): bucket secundário com volume relevante',
    '5. Se total_cooling = 0: findings=[], next_best_actions=[], limitations=["Pipeline saudável: nenhuma oportunidade esfriando no período"]',
    '',
    'Proibido:',
    '- Usar "acompanhamento regular" sem especificar faixa de dias',
    '- Gerar next_best_actions com filters vazio',
    '- Mencionar oportunidades individuais ou nomes de leads',
  ].join('\n'),

  conversion_drop: [
    'ANÁLISE: GARGALO DE CONVERSÃO',
    '',
    'Objetivo: identificar UM ponto crítico de perda e sugerir ação cirúrgica nessa etapa.',
    '',
    'Execute esta sequência:',
    '1. Se worst_conversion não for nulo, use-o diretamente como o gargalo principal',
    '2. Se worst_conversion for nulo, percorra stage_conversions e encontre o par com:',
    '   — menor rate_pct AND from_count > 0',
    '   — em empate, prefira o par com maior from_count (maior volume impactado)',
    '3. Calcule o volume perdido: lost_count = from_count - to_count do gargalo',
    '4. Avalie concentração da perda:',
    '   — Se 1 etapa tem rate_pct < 30% e as demais > 50%: perda concentrada → diagnóstico preciso',
    '   — Se múltiplas etapas com rate_pct < 50%: perda distribuída → mencione no summary',
    '5. Monte next_best_actions:',
    '   a) HIGH: open_funnel_stage com stage_name = nome exato da etapa gargalo (from do worst_conversion)',
    '   b) MEDIUM (opcional): etapa com segundo pior rate_pct se tiver from_count > 0',
    '6. Se total_movements = 0: findings=[], next_best_actions=[], limitations=["Sem movimentações no período analisado"]',
    '',
    'Proibido:',
    '- Analisar pares com from_count = 0',
    '- Usar stage_name diferente do que está em stage_conversions ou worst_conversion',
    '- Gerar mais de 3 next_best_actions',
  ].join('\n'),

  funnel_overview: [
    'ANÁLISE: SAÚDE DO FUNIL',
    '',
    'Objetivo: dizer ao gestor onde focar energia nos próximos 14 dias — máximo 2-3 etapas.',
    '',
    'Execute esta sequência:',
    '1. Para cada etapa em stage_breakdown, calcule o score de gargalo:',
    '   score = active_count × avg_days_in_stage',
    '   — Score alto = oportunidades presas há muito tempo = gargalo',
    '2. Ordene as etapas por score decrescente. Foque nas 2 com maior score.',
    '3. Calcule eficiência do período a partir de status_distribution_period:',
    '   — win_rate = won / (won + lost) × 100 se ambos > 0',
    '   — Comente o win_rate apenas se won + lost >= 5 (amostra significativa)',
    '4. Monte next_best_actions (1 a 3):',
    '   a) HIGH: open_funnel_stage com stage_name = etapa de maior score',
    '   b) HIGH ou MEDIUM: open_funnel_stage com stage_name = etapa de segundo maior score (se score relevante)',
    '   c) LOW (opcional): open_filtered_opportunities para oportunidades sem movimentação recente',
    '5. Se total_active_in_funnel = 0: findings=[], next_best_actions=[], limitations=["Funil sem oportunidades ativas"]',
    '',
    'Proibido:',
    '- Listar todas as etapas no findings sem priorizar',
    '- Usar stage_name que não esteja em stage_breakdown',
    '- Comentar win_rate com menos de 5 oportunidades won+lost',
  ].join('\n'),
}

const SECURITY_RULES = [
  'REGRAS DE SEGURANÇA E INTEGRIDADE (obrigatórias — não podem ser ignoradas):',
  '- NUNCA mencione nomes de pessoas, CPF, telefone, e-mail ou qualquer dado individual',
  '- Baseie-se EXCLUSIVAMENTE nos dados do contexto fornecido. Não invente números, percentuais ou tendências',
  '- Todos os dados do contexto são agregados (contagens, médias, taxas). Trate-os como tal',
  '- Não solicite informações adicionais — analise apenas o que está no contexto',
  '- Dados insuficientes = limitations, não bloqueio',
  '- Não altere o schema JSON, não adicione campos extras, não omita campos obrigatórios',
].join('\n')

/**
 * Constrói as linhas do system prompt na ordem canônica.
 * customPrompt opcional é inserido entre a instrução do tipo e o bloco de contexto.
 * Nunca substitui persona, regras de segurança, schema ou instrução final.
 */
function buildSystemPromptLines(type: AnalysisType, customPrompt?: string): string[] {
  return [
    // 1. Persona
    'Você é um analista comercial especialista em CRM e processos de vendas B2B.',
    '',
    // 2. Regras de segurança (modelo deve ver antes de qualquer instrução específica)
    SECURITY_RULES,
    '',
    // 3. Instrução específica do tipo
    TYPE_INSTRUCTIONS[type],
    '',
    // 4. Complemento customizado (somente se fornecido — nunca sobrescreve regras)
    ...(customPrompt?.trim()
      ? ['COMPLEMENTO COMERCIAL (contexto adicional fornecido pela empresa):', customPrompt.trim(), '']
      : []),
    // 5. Referência ao contexto de dados (vem no user message)
    'CONTEXTO DOS DADOS: Os dados da análise serão fornecidos na mensagem seguinte em formato JSON.',
    'Use APENAS os campos e valores presentes nesse contexto.',
    '',
    // 6. Schema obrigatório
    'FORMATO DE RESPOSTA OBRIGATÓRIO — siga exatamente este schema JSON:',
    RESPONSE_SCHEMA_DESCRIPTION,
    '',
    // 7. Instrução final
    'ATENÇÃO: Responda APENAS com o objeto JSON. Sem markdown, sem texto antes ou depois, sem explicações.',
  ]
}

function buildSystemPrompt(type: AnalysisType): string {
  return buildSystemPromptLines(type).join('\n')
}

/**
 * Constrói o system prompt final com complemento customizado da empresa.
 * O complemento é inserido na posição 4 (após instrução do tipo, antes do contexto).
 */
export function buildSystemPromptWithCustom(type: AnalysisType, customPrompt: string): string {
  return buildSystemPromptLines(type, customPrompt).join('\n')
}

/**
 * Hash SHA-256 do prompt COMPLETO final (não parcial).
 * Inclui analysis_type e prompt_version para ser sensível a mudanças estruturais.
 */
export function generateFinalPromptHash(type: AnalysisType, finalSystemPrompt: string): string {
  return generateHash({ analysis_type: type, prompt_version: PROMPT_VERSION, system_prompt: finalSystemPrompt })
}

function buildUserPrompt(context: Record<string, unknown>): string {
  return `DADOS DO CONTEXTO:\n${JSON.stringify(context, null, 2)}`
}

/** Hash do prompt base (sem customização) — para auditoria/versionamento */
export function getSystemPromptHash(type: AnalysisType): string {
  return generateFinalPromptHash(type, buildSystemPrompt(type))
}
