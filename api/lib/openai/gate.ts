// =====================================================
// Gate — ponto único de uso do cliente OpenAI para o restante do backend.
// Importe daqui nas rotas / features; não importe `client.ts` diretamente.
// SDK `openai`: apenas em client.ts (neste diretório).
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOpenAIClient } from './client'
import { isOpenAIApiKeyConfigured } from './config'
import { fetchParentOpenAISettings, fetchParentOpenAISettingsForSystem } from './settingsDb'
import { logOpenAIEvent } from './log'

export type ConnectionTestResult = {
  ok: boolean
}

/**
 * Teste de conectividade (models.list) com timeout da config central.
 * Requer cliente Supabase do usuário (gestão na empresa Pai).
 * Falhas não incluem mensagens brutas da OpenAI (apenas logs internos com errorCode).
 */
export async function runOpenAIConnectionTest(
  supabase: SupabaseClient
): Promise<ConnectionTestResult> {
  const started = Date.now()

  if (!isOpenAIApiKeyConfigured()) {
    logOpenAIEvent({
      event: 'connection_test',
      ok: false,
      errorCode: 'missing_api_key',
      durationMs: Date.now() - started,
    })
    return { ok: false }
  }

  const client = getOpenAIClient()
  if (!client) {
    logOpenAIEvent({
      event: 'connection_test',
      ok: false,
      errorCode: 'client_null',
      durationMs: Date.now() - started,
    })
    return { ok: false }
  }

  const settings = await fetchParentOpenAISettings(supabase)
  const timeoutMs = settings.timeout_ms

  try {
    const signal = AbortSignal.timeout(timeoutMs)
    await client.models.list({ signal })
    logOpenAIEvent({
      event: 'connection_test',
      ok: true,
      durationMs: Date.now() - started,
    })
    return { ok: true }
  } catch (e) {
    const isTimeout =
      e instanceof Error &&
      (e.name === 'TimeoutError' || /aborted|timeout/i.test(e.message))
    logOpenAIEvent({
      event: 'connection_test',
      ok: false,
      errorCode: isTimeout ? 'openai_timeout' : 'openai_request_failed',
      durationMs: Date.now() - started,
    })
    return { ok: false }
  }
}

export type OpenAIUsageGateResult =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Consumo futuro (qualquer empresa): exige integração habilitada na config central (empresa Pai).
 * Usa leitura via service role no servidor quando disponível.
 */
export async function assertOpenAIAvailableForConsumer(
  consumerCompanyId: string
): Promise<OpenAIUsageGateResult> {
  if (!consumerCompanyId?.trim()) {
    return { allowed: false, reason: 'company_id inválido' }
  }

  if (!isOpenAIApiKeyConfigured() || !getOpenAIClient()) {
    return { allowed: false, reason: 'OpenAI não configurada no servidor' }
  }

  const settings = await fetchParentOpenAISettingsForSystem()
  if (!settings.enabled) {
    return { allowed: false, reason: 'Integração OpenAI desabilitada' }
  }

  return { allowed: true }
}
