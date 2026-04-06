// =====================================================
// Configuração ElevenLabs (server-side apenas)
// ELEVENLABS_API_KEY apenas em process.env — nunca no banco
// =====================================================

const DEFAULT_PARENT_COMPANY_ID = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'

export const PARENT_COMPANY_ID =
  (typeof process !== 'undefined' && typeof process.env?.PARENT_COMPANY_ID === 'string'
    ? process.env.PARENT_COMPANY_ID.trim()
    : '') || DEFAULT_PARENT_COMPANY_ID

export const ELEVENLABS_PROVIDER = 'elevenlabs' as const

/** Sentinela na coluna `model` (NOT NULL + CHECK); semântica ElevenLabs está em provider_config. */
export const ELEVENLABS_MODEL_SENTINEL = '__lovoo_elevenlabs__' as const

/**
 * Chave da API: preferência ELEVENLABS_API_KEY; fallback XI_API_KEY (nome alternativo comum).
 * Nunca logar o valor.
 */
export function getElevenLabsApiKey(): string | null {
  const a = process.env.ELEVENLABS_API_KEY?.trim()
  const b = process.env.XI_API_KEY?.trim()
  if (a) return a
  if (b) return b
  return null
}

export function isElevenLabsApiKeyConfigured(): boolean {
  return getElevenLabsApiKey() !== null
}
