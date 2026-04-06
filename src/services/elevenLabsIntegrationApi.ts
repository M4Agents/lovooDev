// =====================================================
// Chamadas autenticadas às rotas /api/integrations/elevenlabs/*
// =====================================================

import { supabase } from '../lib/supabase'

export type ElevenLabsProviderConfigDTO = {
  version: 2
  default_voice_id: string | null
}

export type ElevenLabsVoiceDTO = {
  voice_id: string
  name: string
  category?: string
  /** URL de preview da listagem ElevenLabs; null se ausente ou inválida */
  preview_url: string | null
}

export type ElevenLabsIntegrationSettingsDTO = {
  enabled: boolean
  timeout_ms: number
  provider_config: ElevenLabsProviderConfigDTO
  api_key_configured: boolean
}

function parseProviderConfigFromApi(raw: unknown): ElevenLabsProviderConfigDTO {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: 2, default_voice_id: null }
  }
  const o = raw as Record<string, unknown>
  if (o.version === 1) {
    return { version: 2, default_voice_id: null }
  }
  if (o.version === 2) {
    const dv = o.default_voice_id
    if (dv === null || dv === undefined) {
      return { version: 2, default_voice_id: null }
    }
    if (typeof dv === 'string') {
      const t = dv.trim()
      return { version: 2, default_voice_id: t.length > 0 ? t : null }
    }
  }
  return { version: 2, default_voice_id: null }
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('Não autenticado')
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

export async function fetchElevenLabsSettings(): Promise<ElevenLabsIntegrationSettingsDTO> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/integrations/elevenlabs/settings', { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Erro ao carregar configurações')
  }
  if (!data.ok) {
    throw new Error((data as { error?: string }).error || 'Resposta inválida')
  }
  return {
    enabled: Boolean(data.enabled),
    timeout_ms: Number(data.timeout_ms) || 60_000,
    provider_config: parseProviderConfigFromApi(data.provider_config),
    api_key_configured: Boolean(data.api_key_configured),
  }
}

export async function patchElevenLabsSettings(
  patch: Partial<
    Pick<ElevenLabsIntegrationSettingsDTO, 'enabled' | 'timeout_ms' | 'provider_config'>
  >
): Promise<ElevenLabsIntegrationSettingsDTO> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/integrations/elevenlabs/settings', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Erro ao salvar')
  }
  if (!data.ok) {
    throw new Error((data as { error?: string }).error || 'Resposta inválida')
  }
  return {
    enabled: Boolean(data.enabled),
    timeout_ms: Number(data.timeout_ms) || 60_000,
    provider_config: parseProviderConfigFromApi(data.provider_config),
    api_key_configured: Boolean(data.api_key_configured),
  }
}

export async function fetchElevenLabsVoices(): Promise<ElevenLabsVoiceDTO[]> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/integrations/elevenlabs/voices', { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Erro ao carregar vozes')
  }
  if (!data.ok || !Array.isArray(data.voices)) {
    throw new Error((data as { error?: string }).error || 'Resposta inválida')
  }
  return (data.voices as Partial<ElevenLabsVoiceDTO>[]).map((v) => ({
    voice_id: String(v.voice_id ?? ''),
    name: String(v.name ?? ''),
    ...(typeof v.category === 'string' && v.category ? { category: v.category } : {}),
    preview_url:
      typeof v.preview_url === 'string' && v.preview_url.startsWith('https://')
        ? v.preview_url
        : null,
  }))
}

export async function postElevenLabsConnectionTest(): Promise<void> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/integrations/elevenlabs/test', {
    method: 'POST',
    headers,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Falha no teste de conexão')
  }
  if (!data.ok) {
    throw new Error((data as { error?: string }).error || 'Falha no teste de conexão')
  }
}
