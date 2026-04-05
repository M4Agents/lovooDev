// =====================================================
// Logging mínimo para OpenAI (server-side)
// Não registrar prompts completos em produção.
// =====================================================

export type OpenAILogPayload = {
  event: string
  companyId?: string
  consumerCompanyId?: string
  durationMs?: number
  model?: string
  ok?: boolean
  errorCode?: string
}

/**
 * Log estruturado em uma linha (Vercel / stdout).
 * Evite passar texto de prompt ou PII em `extra`.
 */
export function logOpenAIEvent(payload: OpenAILogPayload, extra?: Record<string, unknown>): void {
  const line = {
    source: 'openai',
    ts: new Date().toISOString(),
    ...payload,
    ...extra,
  }
  console.log(JSON.stringify(line))
}
