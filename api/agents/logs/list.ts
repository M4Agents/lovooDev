// =====================================================
// GET /api/agents/logs/list
//
// Listagem paginada de execuções dos Agentes Lovoo globais.
// Acesso restrito: empresa pai + admin/super_admin.
//
// Fluxo:
//   1. Validar JWT e verificar empresa pai (assertCanManageOpenAIIntegration)
//   2. Só após validação: inicializar client service_role
//   3. Aplicar filtros e paginação
//   4. Retornar dados + total para paginação no frontend
//
// Paginação: offset/limit (MVP).
//   Futuro: considerar cursor-based pagination quando o volume de logs
//   crescer significativamente (> 100k registros), para evitar performance
//   degradation com offsets altos.
//
// NÃO retorna prompts, mensagens ou respostas da IA.
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

function getQueryParam(
  params: URLSearchParams,
  key: string
): string | undefined {
  return params.get(key) ?? undefined
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

  // ── 1. Auth: JWT + empresa pai ANTES de qualquer query ────────────────────
  //
  // assertCanManageOpenAIIntegration valida:
  //   a) Bearer token presente
  //   b) JWT válido via Supabase
  //   c) usuário pertence à empresa pai com role admin/super_admin
  //      (ou padrão legado: companies.user_id + is_super_admin)
  // Qualquer falha retorna 401/403 sem tocar no banco de logs.

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

  // ── 3. Parse dos query params ─────────────────────────────────────────────

  const rawUrl = req.url ?? ''
  const queryString = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const params = new URLSearchParams(queryString)

  const page     = Math.max(0, parseInt(params.get('page') ?? '0', 10) || 0)
  const pageSize = Math.min(100, Math.max(1, parseInt(params.get('pageSize') ?? '50', 10) || 50))
  const offset   = page * pageSize

  // Filtros — idênticos aos aceitos por summary.ts (contratos alinhados)
  const from               = getQueryParam(params, 'from')
  const to                 = getQueryParam(params, 'to')
  const status             = getQueryParam(params, 'status')
  const useId              = getQueryParam(params, 'use_id')
  const consumerCompanyId  = getQueryParam(params, 'consumer_company_id')

  // ── 4. Query paginada com filtros ─────────────────────────────────────────

  let query = svc
    .from('ai_agent_execution_logs')
    .select(
      'id, use_id, agent_id, consumer_company_id, user_id, channel, model, knowledge_mode, ' +
      'status, is_fallback, duration_ms, input_tokens, output_tokens, total_tokens, ' +
      'estimated_cost_usd, pricing_version, error_code, created_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (from)              query = query.gte('created_at', from)
  if (to)                query = query.lte('created_at', to)
  if (status)            query = query.eq('status', status)
  if (useId)             query = query.eq('use_id', useId)
  if (consumerCompanyId) query = query.eq('consumer_company_id', consumerCompanyId)

  const { data, error, count } = await query

  if (error) {
    return jsonResponse(res, 500, { ok: false, error: 'Erro ao consultar logs' })
  }

  return jsonResponse(res, 200, {
    ok:       true,
    data:     data ?? [],
    total:    count ?? 0,
    page,
    pageSize,
  })
}
