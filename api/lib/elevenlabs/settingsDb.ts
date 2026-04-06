// =====================================================
// Leitura/merge da config ElevenLabs (empresa Pai) — sem secrets
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { ELEVENLABS_MODEL_SENTINEL, ELEVENLABS_PROVIDER, PARENT_COMPANY_ID } from './config.js'

export const FALLBACK_TIMEOUT_MS = 60_000

/** Shape v1 oficial em provider_config */
export type ElevenLabsProviderConfigV1 = {
  version: 1
}

export const DEFAULT_ELEVENLABS_PROVIDER_CONFIG: ElevenLabsProviderConfigV1 = { version: 1 }

export type ParentElevenLabsSettingsResolved = {
  enabled: boolean
  timeout_ms: number
  provider_config: ElevenLabsProviderConfigV1
}

type SettingsRow = {
  enabled: boolean | null
  model: string | null
  timeout_ms: number | null
  provider_config: unknown
}

function parseProviderConfig(raw: unknown): ElevenLabsProviderConfigV1 {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw as ElevenLabsProviderConfigV1).version === 1
  ) {
    const o = raw as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length === 1 && keys[0] === 'version') {
      return { version: 1 }
    }
  }
  return DEFAULT_ELEVENLABS_PROVIDER_CONFIG
}

export function mergeElevenLabsSettingsRow(row: SettingsRow | null): ParentElevenLabsSettingsResolved {
  if (!row) {
    return {
      enabled: false,
      timeout_ms: FALLBACK_TIMEOUT_MS,
      provider_config: DEFAULT_ELEVENLABS_PROVIDER_CONFIG,
    }
  }
  const timeout =
    typeof row.timeout_ms === 'number' && row.timeout_ms >= 1000 && row.timeout_ms <= 600_000
      ? row.timeout_ms
      : FALLBACK_TIMEOUT_MS
  return {
    enabled: Boolean(row.enabled),
    timeout_ms: timeout,
    provider_config: parseProviderConfig(row.provider_config),
  }
}

export async function fetchParentElevenLabsSettings(
  supabase: SupabaseClient
): Promise<ParentElevenLabsSettingsResolved> {
  const { data, error } = await supabase
    .from('integration_settings')
    .select('enabled, model, timeout_ms, provider_config')
    .eq('company_id', PARENT_COMPANY_ID)
    .eq('provider', ELEVENLABS_PROVIDER)
    .maybeSingle()

  if (error) {
    return mergeElevenLabsSettingsRow(null)
  }
  return mergeElevenLabsSettingsRow(data as SettingsRow)
}
