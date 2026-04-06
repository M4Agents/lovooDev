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

export function isElevenLabsApiKeyConfigured(): boolean {
  const k = process.env.ELEVENLABS_API_KEY
  return typeof k === 'string' && k.trim().length > 0
}
