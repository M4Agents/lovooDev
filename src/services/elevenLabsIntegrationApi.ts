// =====================================================
// Chamadas autenticadas às rotas /api/integrations/elevenlabs/*
// =====================================================

import { supabase } from '../lib/supabase'

export type ElevenLabsProviderConfigDTO = {
  version: number
}

export type ElevenLabsIntegrationSettingsDTO = {
  enabled: boolean
  timeout_ms: number
  provider_config: ElevenLabsProviderConfigDTO
  api_key_configured: boolean
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
  const pc = data.provider_config
  return {
    enabled: Boolean(data.enabled),
    timeout_ms: Number(data.timeout_ms) || 60_000,
    provider_config:
      pc && typeof pc === 'object' && !Array.isArray(pc) && typeof (pc as { version?: unknown }).version === 'number'
        ? { version: (pc as { version: number }).version }
        : { version: 1 },
    api_key_configured: Boolean(data.api_key_configured),
  }
}

export async function patchElevenLabsSettings(
  patch: Partial<Pick<ElevenLabsIntegrationSettingsDTO, 'enabled' | 'timeout_ms'>>
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
  const pc = data.provider_config
  return {
    enabled: Boolean(data.enabled),
    timeout_ms: Number(data.timeout_ms) || 60_000,
    provider_config:
      pc && typeof pc === 'object' && !Array.isArray(pc) && typeof (pc as { version?: unknown }).version === 'number'
        ? { version: (pc as { version: number }).version }
        : { version: 1 },
    api_key_configured: Boolean(data.api_key_configured),
  }
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
