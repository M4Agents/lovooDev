// =====================================================
// Chamadas autenticadas às rotas /api/integrations/openai/*
// =====================================================

import { supabase } from '../lib/supabase'

export type OpenAIIntegrationSettingsDTO = {
  enabled: boolean
  model: string
  timeout_ms: number
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

export async function fetchOpenAISettings(): Promise<OpenAIIntegrationSettingsDTO> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/integrations/openai/settings', { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Erro ao carregar configurações')
  }
  if (!data.ok) {
    throw new Error((data as { error?: string }).error || 'Resposta inválida')
  }
  return {
    enabled: Boolean(data.enabled),
    model: String(data.model ?? ''),
    timeout_ms: Number(data.timeout_ms) || 60_000,
  }
}

export async function patchOpenAISettings(
  patch: Partial<Pick<OpenAIIntegrationSettingsDTO, 'enabled' | 'model' | 'timeout_ms'>>
): Promise<OpenAIIntegrationSettingsDTO> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/integrations/openai/settings', {
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
    model: String(data.model ?? ''),
    timeout_ms: Number(data.timeout_ms) || 60_000,
  }
}

export async function postOpenAIConnectionTest(): Promise<void> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/integrations/openai/test', {
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
