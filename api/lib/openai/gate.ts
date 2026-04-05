// =====================================================
// Gate — ponto único de uso do cliente OpenAI para o restante do backend.
// Importe daqui nas rotas / features; não importe `client.ts` diretamente.
// SDK `openai`: apenas em client.ts (neste diretório).
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOpenAIClient } from './client.js'
import { isOpenAIApiKeyConfigured, OPENAI_CLIENT_MAX_TIMEOUT_MS } from './config.js'
import { fetchParentOpenAISettings, fetchParentOpenAISettingsForSystem } from './settingsDb.js'
import { logOpenAIEvent } from './log.js'

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

/** Modelos voltados a chat/completions; exclui embedding, áudio, imagem, moderação. */
function isSelectableChatModelId(id: string): boolean {
  const x = id.toLowerCase()
  const exclude = [
    'embedding',
    'whisper',
    'dall-e',
    'tts',
    'moderation',
    'text-similarity',
    'text-search',
    'code-search',
    'davinci',
    'babbage',
    'ada-002',
  ]
  if (exclude.some((s) => x.includes(s))) return false
  if (x.startsWith('gpt-') || x.startsWith('ft:gpt-') || x.startsWith('chatgpt-')) return true
  if (/^o[0-9]/.test(x)) return true
  return false
}

/**
 * Lista IDs de modelos da conta (models.list), filtrados para uso típico em chat.
 */
export async function listOpenAIChatModelIds(): Promise<
  { ok: true; models: string[] } | { ok: false; errorCode: string }
> {
  const started = Date.now()

  if (!isOpenAIApiKeyConfigured()) {
    logOpenAIEvent({ event: 'models_list', ok: false, errorCode: 'missing_api_key', durationMs: Date.now() - started })
    return { ok: false, errorCode: 'missing_api_key' }
  }

  const client = getOpenAIClient()
  if (!client) {
    logOpenAIEvent({ event: 'models_list', ok: false, errorCode: 'client_null', durationMs: Date.now() - started })
    return { ok: false, errorCode: 'client_null' }
  }

  try {
    const signal = AbortSignal.timeout(Math.min(120_000, OPENAI_CLIENT_MAX_TIMEOUT_MS))
    const res = await client.models.list({ signal })
    const models = (res.data ?? [])
      .map((m) => m.id)
      .filter(isSelectableChatModelId)
      .sort((a, b) => a.localeCompare(b))
    logOpenAIEvent({ event: 'models_list', ok: true, durationMs: Date.now() - started })
    return { ok: true, models }
  } catch (e) {
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || /aborted|timeout/i.test(e.message))
    logOpenAIEvent({
      event: 'models_list',
      ok: false,
      errorCode: isTimeout ? 'openai_timeout' : 'openai_request_failed',
      durationMs: Date.now() - started,
    })
    return { ok: false, errorCode: isTimeout ? 'openai_timeout' : 'openai_request_failed' }
  }
}

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
