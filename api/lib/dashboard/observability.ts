// =====================================================
// api/lib/dashboard/observability.ts
// Observabilidade leve para endpoints da dashboard.
//
// Regras de segurança (obrigatórias):
//   - NUNCA logar token, email, telefone, nome de lead/contato
//   - company_id truncado para os primeiros 8 chars (não é PII, mas por cautela)
//   - Apenas: label, duration_ms, period, status HTTP, message de erro
//   - Alertas de lentidão: duration_ms > SLOW_THRESHOLD_MS → prefixo [SLOW]
//
// withTiming SEMPRE re-lança o erro após logar — nunca engole exceções.
// =====================================================

const SLOW_THRESHOLD_MS = 3_000

// ---------------------------------------------------------------------------
// safeCompanyId — trunca para não expor UUID completo em logs
// ---------------------------------------------------------------------------

function safeCompanyId(companyId: string): string {
  return companyId ? `${companyId.slice(0, 8)}…` : 'unknown'
}

// ---------------------------------------------------------------------------
// withTiming
//
// Envolve qualquer função async, mede tempo de execução e loga resultado.
// Re-lança o erro original sem modificação.
//
// Uso:
//   const result = await withTiming('dashboard.summary.metrics', () =>
//     buildExecutiveMetrics(svc, companyId, resolvedRange)
//   )
// ---------------------------------------------------------------------------

export async function withTiming<T>(
  label: string,
  fn: () => Promise<T>,
  context?: { companyId?: string; period?: string },
): Promise<T> {
  const start = Date.now()
  const ctx = context?.companyId ? `[${safeCompanyId(context.companyId)}]` : ''

  try {
    const result = await fn()
    const ms = Date.now() - start
    const prefix = ms > SLOW_THRESHOLD_MS ? '[SLOW]' : '[OK]'
    const periodInfo = context?.period ? ` period=${context.period}` : ''
    console.info(`${prefix} ${label}${ctx} ${ms}ms${periodInfo}`)
    return result
  } catch (err) {
    const ms = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ERR] ${label}${ctx} ${ms}ms — ${msg}`)
    throw err
  }
}

// ---------------------------------------------------------------------------
// logDashboardError
//
// Log estruturado de erro com contexto seguro.
// Usar no catch dos endpoints quando withTiming não cobre o bloco.
// ---------------------------------------------------------------------------

export function logDashboardError(
  label: string,
  err: unknown,
  context?: { endpoint?: string; period?: string; companyId?: string },
): void {
  const msg      = err instanceof Error ? err.message : String(err)
  const endpoint = context?.endpoint ? ` endpoint=${context.endpoint}` : ''
  const period   = context?.period   ? ` period=${context.period}`     : ''
  const company  = context?.companyId ? ` company=${safeCompanyId(context.companyId)}` : ''
  console.error(`[DASH-ERR] ${label}${endpoint}${company}${period} — ${msg}`)
}

// ---------------------------------------------------------------------------
// logHistoricalFallback
//
// Registra fallbacks históricos dos endpoints v2 em dashboard_snapshot_fallback_logs.
// Fire-and-forget — nunca lança erro, nunca bloqueia o request.
// Chamado pelo backend quando historical: null é determinado.
//
// Não chamar para tenants insufficient_history:
//   o frontend nunca chama endpoints v2 quando canUseSnapshots=false,
//   portanto qualquer fallback registrado aqui é genuinamente operacional.
// ---------------------------------------------------------------------------

export type HistoricalFallbackEndpoint =
  | 'executive-summary-v2'
  | 'seller-ranking-v2'
  | 'sla-alerts-v2'
  | 'forecast-v2'
  | 'funnel-executive-v2'

export type HistoricalFallbackReason =
  | 'aggregate_failed'
  | 'cache_empty'
  | 'no_snapshot_data'

export interface HistoricalFallbackParams {
  companyId:      string
  endpoint:       HistoricalFallbackEndpoint
  reason:         HistoricalFallbackReason
  comparisonMode: 'wow' | 'mom' | null
}

export function logHistoricalFallback(
  svc:    any,
  params: HistoricalFallbackParams,
): void {
  void svc
    .from('dashboard_snapshot_fallback_logs')
    .insert({
      company_id:  params.companyId,
      endpoint:    params.endpoint,
      reason:      params.reason,
      mode:        params.comparisonMode,
      occurred_at: new Date().toISOString(),
    })
    .then(({ error }: { error: any }) => {
      if (error) {
        console.warn('[logHistoricalFallback] insert silenced:', error.message)
      }
    })
    .catch((e: any) => {
      console.warn('[logHistoricalFallback] catch silenced:', e?.message)
    })
}

// ---------------------------------------------------------------------------
// logEndpointCall
//
// Registra chamadas aos endpoints híbridos v2 em dashboard_endpoint_usage_logs.
// Fire-and-forget — nunca lança erro, nunca bloqueia o request.
//
// status:
//   'ok'       → HTTP 200 com historical != null
//   'fallback' → HTTP 200 com historical = null (fallback silencioso)
//   'error'    → HTTP 500 (realtime rejeitado)
//
// Chamar imediatamente antes do return res.status(200|500).
// Capturar duration_ms = Date.now() - _startedAt (primeira linha do handler).
// ---------------------------------------------------------------------------

export type EndpointCallStatus = 'ok' | 'fallback' | 'error'

export interface EndpointCallParams {
  companyId:   string
  endpoint:    HistoricalFallbackEndpoint
  status:      EndpointCallStatus
  mode:        'wow' | 'mom' | null
  durationMs?: number
}

export function logEndpointCall(
  svc:    any,
  params: EndpointCallParams,
): void {
  void svc
    .from('dashboard_endpoint_usage_logs')
    .insert({
      company_id:  params.companyId,
      endpoint:    params.endpoint,
      status:      params.status,
      mode:        params.mode,
      duration_ms: params.durationMs ?? null,
      occurred_at: new Date().toISOString(),
    })
    .then(({ error }: { error: any }) => {
      if (error) {
        console.warn('[logEndpointCall] insert silenced:', error.message)
      }
    })
    .catch((e: any) => {
      console.warn('[logEndpointCall] catch silenced:', e?.message)
    })
}
