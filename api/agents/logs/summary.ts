// =====================================================
// GET /api/agents/logs/summary
//
// Agregação de execuções dos Agentes Lovoo globais.
// Acesso restrito: empresa pai + admin/super_admin.
//
// Fluxo:
//   1. Validar JWT e verificar empresa pai (assertCanManageOpenAIIntegration)
//   2. Só após validação: inicializar client service_role
//   3. Aplicar os MESMOS filtros do list.ts (consistência obrigatória)
//   4. Retornar métricas agregadas
//
// IMPORTANTE: os filtros aceitos aqui são IDÊNTICOS aos de list.ts.
// Isso garante que os cards da UI sempre reflitam exatamente os dados da tabela.
//
// Métricas:
//   error_rate    = COUNT WHERE status LIKE 'error_%' / total_executions
//   fallback_rate = COUNT WHERE is_fallback = true / total_executions
//
// estimated_cost_usd retornado é ESTIMATIVA OPERACIONAL.
// Não representa faturamento real nem valor cobrado pela OpenAI.
// =====================================================

import type { IncomingMessage, ServerResponse } from 'http'
import { createClient } from '@supabase/supabase-js'
import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Statuses classificados como erro (para cálculo de error_rate)
const ERROR_STATUSES = new Set([
  'error_missing_context',
  'error_openai',
  'error_db',
])

// ── Billing mode ──────────────────────────────────────────────────────────────
//
// Fluxo completamente separado do modo padrão (governança).
// Fonte de dados: ai_usage_daily — NUNCA ai_agent_execution_logs.
// Auth própria: JWT + membership (qualquer role ativo).
// Multi-tenant:
//   - Empresa pai  → pode passar company_id via query (obrigatório)
//   - Empresa filha → company_id da própria sessão (query ignorada)
// Período: default 30 dias, max 90 (clamp automático).

type MembershipRow = {
  company_id: string
  role: string
  companies: { company_type: string } | null
}

async function handleBillingMode(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // ── Auth: JWT ────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(res, 401, { ok: false, error: 'Token não fornecido' })
  }
  const token = authHeader.slice(7)

  const svc = getServiceSupabase()
  if (!svc) {
    return jsonResponse(res, 500, { ok: false, error: 'Configuração de servidor incompleta' })
  }

  const { data: { user }, error: authError } = await svc.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse(res, 401, { ok: false, error: 'Token inválido ou expirado' })
  }

  // ── Membership: obter company e tipo de empresa ──────────────────────────
  // Supabase retorna o join em companies como objeto aninhado.
  const { data: memberships, error: membershipError } = await svc
    .from('company_users')
    .select('company_id, role, companies!inner(company_type)')
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (membershipError || !memberships?.length) {
    return jsonResponse(res, 403, { ok: false, error: 'Sem acesso ao sistema de billing' })
  }

  const rows = memberships as unknown as MembershipRow[]

  // ── Multi-tenant: determinar company_id efetivo ──────────────────────────
  const rawUrl     = req.url ?? ''
  const qs         = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params     = new URLSearchParams(qs)
  const queryCompanyId = params.get('company_id') ?? ''

  // Empresa pai: ao menos uma membership em empresa com company_type = 'parent'
  const isParentUser = rows.some(m => m.companies?.company_type === 'parent')

  let effectiveCompanyId: string

  if (isParentUser) {
    // Pai precisa especificar qual empresa está consultando
    if (!queryCompanyId) {
      return jsonResponse(res, 400, { ok: false, error: 'company_id obrigatório para empresa pai' })
    }

    // ── Validação de vínculo pai → filha ───────────────────────────────────
    // Garante que a empresa solicitada é CLIENTE (filha) desta empresa pai.
    // Impede acesso cross-tenant: admin da Pai A não pode ver dados da Pai B
    // nem de filhas de outra pai, mesmo passando um company_id válido.
    const parentCompanyId = rows.find(m => m.companies?.company_type === 'parent')?.company_id ?? ''

    const { data: childCheck, error: childCheckError } = await svc
      .from('companies')
      .select('id')
      .eq('id', queryCompanyId)
      .eq('parent_company_id', parentCompanyId)
      .eq('company_type', 'client')
      .maybeSingle()

    if (childCheckError || !childCheck) {
      return jsonResponse(res, 403, { ok: false, error: 'Empresa não encontrada ou sem acesso' })
    }

    effectiveCompanyId = queryCompanyId
  } else {
    // Filha: forçar company_id da própria sessão — query ignorada intencionalmente
    const childMembership = rows.find(m => m.companies?.company_type !== 'parent')
    if (!childMembership) {
      return jsonResponse(res, 403, { ok: false, error: 'Sem acesso ao sistema de billing' })
    }
    effectiveCompanyId = childMembership.company_id
  }

  // ── Período: default 30 dias, max 90 (clamp automático) ─────────────────
  const rawPeriod     = parseInt(params.get('period') ?? '30', 10)
  const effectivePeriod = isNaN(rawPeriod) || rawPeriod <= 0
    ? 30
    : Math.min(rawPeriod, 90)

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - effectivePeriod)
  const cutoffDateStr = cutoff.toISOString().slice(0, 10) // YYYY-MM-DD

  // ── Query: ai_usage_daily ─────────────────────────────────────────────────
  // Fonte exclusiva para billing. ai_agent_execution_logs NÃO é consultado aqui.
  const { data: usageData, error: usageError } = await svc
    .from('ai_usage_daily')
    .select('feature_type, total_credits_used')
    .eq('company_id', effectiveCompanyId)
    .gte('date', cutoffDateStr)

  if (usageError) {
    return jsonResponse(res, 500, { ok: false, error: 'Erro ao buscar dados de consumo' })
  }

  // ── Agregar por feature ──────────────────────────────────────────────────
  const byFeature: Record<string, number> = { whatsapp: 0, insights: 0 }
  let totalCreditsUsed = 0

  for (const row of (usageData ?? [])) {
    const ft = row.feature_type as string
    if (ft in byFeature) byFeature[ft] += row.total_credits_used ?? 0
    totalCreditsUsed += row.total_credits_used ?? 0
  }

  return jsonResponse(res, 200, {
    ok: true,
    data: {
      total_credits_used: totalCreditsUsed,
      by_feature:         byFeature,
      period_days:        effectivePeriod,
    },
  })
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { ok: false, error: 'Método não permitido' })
  }

  // ── 1a. Detectar mode ANTES de qualquer auth ─────────────────────────────
  //
  // Roteamento antecipado: mode=billing → fluxo separado com auth própria.
  // mode inválido → 400 imediato (sem auth, sem banco).
  // Ausência de mode → fluxo padrão de governança abaixo (intacto).

  const _rawUrl  = req.url ?? ''
  const _qs      = _rawUrl.includes('?') ? _rawUrl.slice(_rawUrl.indexOf('?') + 1) : ''
  const rawMode  = new URLSearchParams(_qs).get('mode') ?? ''

  if (rawMode !== '' && rawMode !== 'billing') {
    return jsonResponse(res, 400, { ok: false, error: 'Parâmetro mode inválido. Valores aceitos: billing' })
  }

  if (rawMode === 'billing') {
    return handleBillingMode(req, res)
  }

  // ── 1b. Auth: JWT + empresa pai ANTES de qualquer query ──────────────────
  //
  // Mesmo fluxo de list.ts: JWT → empresa pai → role.
  // Qualquer falha retorna 401/403 sem tocar no banco.

  const auth = await assertCanManageOpenAIIntegration(
    req as Parameters<typeof assertCanManageOpenAIIntegration>[0]
  )
  if (!auth.ok) {
    return jsonResponse(res, auth.status, { ok: false, error: auth.message })
  }

  // ── 2. Inicializa service_role apenas após auth aprovada ──────────────────

  const svc = getServiceSupabase()
  if (!svc) {
    return jsonResponse(res, 500, { ok: false, error: 'Configuração de servidor incompleta' })
  }

  // ── 3. Parse dos query params (MESMOS filtros de list.ts) ─────────────────

  const rawUrl = req.url ?? ''
  const queryString = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params = new URLSearchParams(queryString)

  const from              = params.get('from')   ?? undefined
  const to                = params.get('to')     ?? undefined
  const status            = params.get('status') ?? undefined
  const useId             = params.get('use_id') ?? undefined
  const consumerCompanyId = params.get('consumer_company_id') ?? undefined

  // ── 4. Query agregada com filtros ─────────────────────────────────────────
  //
  // Busca todos os registros do período para calcular métricas.
  // SELECT limitado a colunas estritamente necessárias para agregação.

  let query = svc
    .from('ai_agent_execution_logs')
    .select('status, is_fallback, total_tokens, estimated_cost_usd')

  if (from)              query = query.gte('created_at', from)
  if (to)                query = query.lte('created_at', to)
  if (status)            query = query.eq('status', status)
  if (useId)             query = query.eq('use_id', useId)
  if (consumerCompanyId) query = query.eq('consumer_company_id', consumerCompanyId)

  const { data, error } = await query

  if (error) {
    return jsonResponse(res, 500, { ok: false, error: 'Erro ao calcular métricas' })
  }

  const rows = data ?? []
  const totalExecutions = rows.length

  // Agrega métricas
  let totalTokens       = 0
  let totalCost         = 0
  let errorCount        = 0
  let fallbackCount     = 0
  const byStatus: Record<string, number> = {}

  for (const row of rows) {
    totalTokens   += row.total_tokens        ?? 0
    totalCost     += Number(row.estimated_cost_usd ?? 0)
    if (row.is_fallback)              fallbackCount++
    if (ERROR_STATUSES.has(row.status)) errorCount++

    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
  }

  const errorRate    = totalExecutions > 0 ? errorCount    / totalExecutions : 0
  const fallbackRate = totalExecutions > 0 ? fallbackCount / totalExecutions : 0

  return jsonResponse(res, 200, {
    ok:                  true,
    total_executions:    totalExecutions,
    total_tokens:        totalTokens,
    // Arredondado para 8 casas — alinhado com NUMERIC(12,8) do banco
    estimated_cost_usd:  Math.round(totalCost * 1e8) / 1e8,
    // Taxas como frações (0–1); a UI formata em %
    error_rate:          Math.round(errorRate    * 1e6) / 1e6,
    fallback_rate:       Math.round(fallbackRate * 1e6) / 1e6,
    by_status:           byStatus,
  })
}
