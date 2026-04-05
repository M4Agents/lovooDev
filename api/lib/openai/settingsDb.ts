// =====================================================
// Leitura da config OpenAI central (empresa Pai) — sem secrets
//
// SUPABASE_SERVICE_ROLE_KEY: usado APENAS neste módulo server-side (Vercel / Node),
// somente em getServiceSupabaseForSettingsRead → fetchParentOpenAISettingsForSystem.
// Nunca importar este arquivo no frontend. Queries usam sempre literais
// company_id = PARENT_COMPANY_ID e provider = OPENAI_PROVIDER (nunca vêm do cliente).
// =====================================================

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PARENT_COMPANY_ID } from './config.js'

export const OPENAI_PROVIDER = 'openai' as const

/** Fallback quando não há linha em integration_settings (não usar env para modelo). */
export const FALLBACK_OPENAI_MODEL = 'gpt-4.1-mini'
export const FALLBACK_TIMEOUT_MS = 60_000

export type ParentOpenAISettingsResolved = {
  enabled: boolean
  model: string
  timeout_ms: number
}

type SettingsRow = {
  enabled: boolean | null
  model: string | null
  timeout_ms: number | null
}

export function mergeOpenAISettingsRow(row: SettingsRow | null): ParentOpenAISettingsResolved {
  if (!row) {
    return {
      enabled: false,
      model: FALLBACK_OPENAI_MODEL,
      timeout_ms: FALLBACK_TIMEOUT_MS,
    }
  }
  const model = row.model?.trim()
  const timeout =
    typeof row.timeout_ms === 'number' && row.timeout_ms >= 1000 && row.timeout_ms <= 600_000
      ? row.timeout_ms
      : FALLBACK_TIMEOUT_MS
  return {
    enabled: Boolean(row.enabled),
    model: model && model.length > 0 ? model : FALLBACK_OPENAI_MODEL,
    timeout_ms: timeout,
  }
}

/** Com cliente do usuário (JWT + RLS) — rotas de gestão na empresa Pai. */
export async function fetchParentOpenAISettings(
  supabase: SupabaseClient
): Promise<ParentOpenAISettingsResolved> {
  const { data, error } = await supabase
    .from('integration_settings')
    .select('enabled, model, timeout_ms')
    .eq('company_id', PARENT_COMPANY_ID)
    .eq('provider', OPENAI_PROVIDER)
    .maybeSingle()

  if (error) {
    return mergeOpenAISettingsRow(null)
  }
  return mergeOpenAISettingsRow(data as SettingsRow)
}

/**
 * Cliente Supabase com service role — somente backend, só leitura de
 * integration_settings da empresa Pai (filtros fixos em fetchParentOpenAISettingsForSystem).
 * Nunca expor esta chave ao cliente.
 */
export function getServiceSupabaseForSettingsRead(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function fetchParentOpenAISettingsForSystem(): Promise<ParentOpenAISettingsResolved> {
  const svc = getServiceSupabaseForSettingsRead()
  if (!svc) {
    return mergeOpenAISettingsRow(null)
  }
  const { data, error } = await svc
    .from('integration_settings')
    .select('enabled, model, timeout_ms')
    .eq('company_id', PARENT_COMPANY_ID)
    .eq('provider', OPENAI_PROVIDER)
    .maybeSingle()

  if (error) {
    return mergeOpenAISettingsRow(null)
  }
  return mergeOpenAISettingsRow(data as SettingsRow)
}
