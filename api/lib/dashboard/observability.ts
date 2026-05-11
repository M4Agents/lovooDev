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
