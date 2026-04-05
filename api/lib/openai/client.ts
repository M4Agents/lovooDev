// =====================================================
// Cliente OpenAI — ÚNICO arquivo que importa o SDK `openai`.
// Rotas em api/** e outros módulos devem usar `gate.ts`, não importar este arquivo.
// =====================================================

import OpenAI from 'openai'
import { OPENAI_CLIENT_MAX_TIMEOUT_MS } from './config.js'

let cached: OpenAI | null | undefined

/**
 * Retorna instância singleton ou null se OPENAI_API_KEY ausente.
 * Timeout por requisição vem de integration_settings (gate); o cliente usa teto fixo.
 */
export function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) {
    cached = null
    return null
  }
  if (cached !== undefined) return cached

  cached = new OpenAI({
    apiKey: key,
    maxRetries: 1,
    timeout: OPENAI_CLIENT_MAX_TIMEOUT_MS,
  })
  return cached
}

/**
 * Limpa cache (útil em testes; evitar uso em produção sem necessidade).
 */
export function resetOpenAIClientCacheForTests(): void {
  cached = undefined
}
