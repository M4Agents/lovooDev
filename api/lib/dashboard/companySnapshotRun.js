export const COMPANY_RUN_STALE_MS = 10 * 60 * 1000

/**
 * completed só depois da geração inteira.
 * failed, partial e running antigo podem ser retomados.
 * running recente permanece com a invocação que já o assumiu.
 */
export function decideCompanyRunClaim(existing, nowMs) {
  if (!existing) return 'insert'
  if (existing.status === 'completed') return 'skip_completed'
  if (existing.status === 'failed' || existing.status === 'partial') return 'retry'
  if (existing.status === 'running') {
    const age = nowMs - new Date(existing.started_at).getTime()
    return age >= COMPANY_RUN_STALE_MS ? 'retry_stale' : 'concurrent'
  }
  return 'claim_failed'
}

/** partial cobre timeout e falha de parte da geração. Nunca vira completed. */
export function companyRunFinalStatus(timeoutHit, failedCount) {
  if (timeoutHit || failedCount > 0) return 'partial'
  return 'completed'
}
