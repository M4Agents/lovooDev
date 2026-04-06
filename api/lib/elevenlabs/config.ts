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
 * Remove erros comuns ao colar a chave na Vercel: aspas envolvendo o valor, BOM, quebras de linha.
 * Nunca logar o valor completo.
 */
export function normalizeElevenLabsApiKey(raw: string): string {
  let s = raw.trim()
  if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1).trim()
  }
  s = s.replace(/\r|\n/g, '')
  if (s.length >= 2) {
    const q = s[0]
    if ((q === '"' || q === "'") && s[s.length - 1] === q) {
      s = s.slice(1, -1).trim()
    }
  }
  return s
}

/**
 * Chave da API: preferência ELEVENLABS_API_KEY; fallback XI_API_KEY (nome alternativo comum).
 */
export function getElevenLabsApiKey(): string | null {
  const rawA = process.env.ELEVENLABS_API_KEY
  const rawB = process.env.XI_API_KEY
  const a = rawA ? normalizeElevenLabsApiKey(rawA) : ''
  const b = rawB ? normalizeElevenLabsApiKey(rawB) : ''
  if (a) return a
  if (b) return b
  return null
}

export function isElevenLabsApiKeyConfigured(): boolean {
  return getElevenLabsApiKey() !== null
}
