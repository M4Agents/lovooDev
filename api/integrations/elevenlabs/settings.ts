// =====================================================
// GET/PATCH /api/integrations/elevenlabs/settings
// Gestão apenas empresa Pai + super_admin/admin (sessão JWT)
//
// company_id e provider são constantes do backend; o cliente não envia tenant/provider.
// =====================================================

import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'
import {
  DEFAULT_ELEVENLABS_PROVIDER_CONFIG,
  fetchParentElevenLabsSettings,
  type ElevenLabsProviderConfigV1,
} from '../../lib/elevenlabs/settingsDb.js'
import {
  ELEVENLABS_MODEL_SENTINEL,
  ELEVENLABS_PROVIDER,
  isElevenLabsApiKeyConfigured,
  PARENT_COMPANY_ID,
} from '../../lib/elevenlabs/config.js'

const TIMEOUT_MS_MIN = 1000
const TIMEOUT_MS_MAX = 600_000

type PatchFields = {
  enabled?: boolean
  timeout_ms?: number
  provider_config?: unknown
}

function validateElevenLabsProviderConfigInput(raw: unknown): { ok: true; value: ElevenLabsProviderConfigV1 } | { ok: false; error: string } {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'provider_config deve ser um objeto' }
  }
  const o = raw as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length === 0) {
    return { ok: true, value: DEFAULT_ELEVENLABS_PROVIDER_CONFIG }
  }
  for (const k of keys) {
    if (k !== 'version') {
      return { ok: false, error: `Chave não permitida em provider_config: ${k}` }
    }
  }
  if (o.version !== 1 || typeof o.version !== 'number') {
    return { ok: false, error: 'provider_config.version deve ser 1' }
  }
  return { ok: true, value: { version: 1 } }
}

function validatePatchBody(body: unknown): { ok: true; value: PatchFields } | { ok: false; error: string } {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: 'Body inválido' }
  }
  const o = body as Record<string, unknown>
  const allowed = new Set(['enabled', 'timeout_ms', 'provider_config'])
  for (const key of Object.keys(o)) {
    if (!allowed.has(key)) {
      return { ok: false, error: `Campo não permitido: ${key}` }
    }
  }
  const out: PatchFields = {}
  if ('enabled' in o) {
    if (typeof o.enabled !== 'boolean') {
      return { ok: false, error: 'enabled deve ser boolean' }
    }
    out.enabled = o.enabled
  }
  if ('timeout_ms' in o) {
    if (typeof o.timeout_ms !== 'number' || !Number.isInteger(o.timeout_ms)) {
      return { ok: false, error: 'timeout_ms deve ser inteiro' }
    }
    if (o.timeout_ms < TIMEOUT_MS_MIN || o.timeout_ms > TIMEOUT_MS_MAX) {
      return {
        ok: false,
        error: `timeout_ms deve estar entre ${TIMEOUT_MS_MIN} e ${TIMEOUT_MS_MAX}`,
      }
    }
    out.timeout_ms = o.timeout_ms
  }
  if ('provider_config' in o) {
    const v = validateElevenLabsProviderConfigInput(o.provider_config)
    if (!v.ok) {
      return { ok: false, error: v.error }
    }
    out.provider_config = v.value
  }
  if (Object.keys(out).length === 0) {
    return { ok: false, error: 'Nenhum campo para atualizar' }
  }
  return { ok: true, value: out }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const auth = await assertCanManageOpenAIIntegration(req)
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.message })
    return
  }

  if (req.method === 'GET') {
    const settings = await fetchParentElevenLabsSettings(auth.supabase)
    res.status(200).json({
      ok: true,
      enabled: settings.enabled,
      timeout_ms: settings.timeout_ms,
      provider_config: settings.provider_config,
      api_key_configured: isElevenLabsApiKeyConfigured(),
    })
    return
  }

  if (req.method === 'PATCH') {
    const parsed = validatePatchBody(req.body)
    if (!parsed.ok) {
      res.status(400).json({ ok: false, error: parsed.error })
      return
    }

    const current = await fetchParentElevenLabsSettings(auth.supabase)
    let nextProviderConfig = current.provider_config

    if (parsed.value.provider_config !== undefined) {
      nextProviderConfig = parsed.value.provider_config as ElevenLabsProviderConfigV1
    }

    const next = {
      enabled: parsed.value.enabled !== undefined ? parsed.value.enabled : current.enabled,
      timeout_ms:
        parsed.value.timeout_ms !== undefined ? parsed.value.timeout_ms : current.timeout_ms,
      provider_config: nextProviderConfig,
    }

    const { error } = await auth.supabase.from('integration_settings').upsert(
      {
        company_id: PARENT_COMPANY_ID,
        provider: ELEVENLABS_PROVIDER,
        enabled: next.enabled,
        model: ELEVENLABS_MODEL_SENTINEL,
        timeout_ms: next.timeout_ms,
        provider_config: next.provider_config,
      },
      { onConflict: 'company_id,provider' }
    )

    if (error) {
      res.status(500).json({ ok: false, error: 'Não foi possível salvar as configurações' })
      return
    }

    const merged = await fetchParentElevenLabsSettings(auth.supabase)
    res.status(200).json({
      ok: true,
      enabled: merged.enabled,
      timeout_ms: merged.timeout_ms,
      provider_config: merged.provider_config,
      api_key_configured: isElevenLabsApiKeyConfigured(),
    })
    return
  }

  res.status(405).json({ ok: false, error: 'Método não permitido' })
}
