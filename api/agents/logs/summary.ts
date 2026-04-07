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

  // ── 1. Auth: JWT + empresa pai ANTES de qualquer query ────────────────────
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
