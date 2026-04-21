// =====================================================
// GET/PATCH /api/integrations/openai/settings
// Gestão apenas empresa Pai + super_admin/admin (sessão JWT)
//
// company_id e provider são sempre constantes do backend (PARENT_COMPANY_ID, OPENAI_PROVIDER);
// o cliente não pode enviá-los (body só: enabled, model, timeout_ms).
// =====================================================

import { assertCanManageOpenAIIntegration } from '../../lib/openai/auth.js'
import { PARENT_COMPANY_ID } from '../../lib/openai/config.js'
import { fetchParentOpenAISettings, OPENAI_PROVIDER } from '../../lib/openai/settingsDb.js'

/** Alinhado à constraint integration_settings_timeout_positive no banco */
const TIMEOUT_MS_MIN = 1000
const TIMEOUT_MS_MAX = 600_000

const MODEL_RE = /^[a-zA-Z0-9._-]{1,128}$/

type PatchFields = {
  enabled?: boolean
  model?: string
  timeout_ms?: number
}

function validatePatchBody(body: unknown): { ok: true; value: PatchFields } | { ok: false; error: string } {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: 'Body inválido' }
  }
  const o = body as Record<string, unknown>
  const allowed = new Set(['enabled', 'model', 'timeout_ms'])
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
  if ('model' in o) {
    if (typeof o.model !== 'string' || !MODEL_RE.test(o.model.trim())) {
      return { ok: false, error: 'model inválido' }
    }
    out.model = o.model.trim()
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
  if (auth.ok === false) {
    res.status(auth.status).json({ ok: false, error: auth.message })
    return
  }

  if (req.method === 'GET') {
    const settings = await fetchParentOpenAISettings(auth.supabase)
    res.status(200).json({
      ok: true,
      enabled: settings.enabled,
      model: settings.model,
      timeout_ms: settings.timeout_ms,
    })
    return
  }

  if (req.method === 'PATCH') {
    const parsed = validatePatchBody(req.body)
    if (parsed.ok === false) {
      res.status(400).json({ ok: false, error: parsed.error })
      return
    }

    const current = await fetchParentOpenAISettings(auth.supabase)
    const next = {
      enabled: parsed.value.enabled !== undefined ? parsed.value.enabled : current.enabled,
      model: parsed.value.model !== undefined ? parsed.value.model : current.model,
      timeout_ms:
        parsed.value.timeout_ms !== undefined ? parsed.value.timeout_ms : current.timeout_ms,
    }

    const { data: existingRow, error: readCfgErr } = await auth.supabase
      .from('integration_settings')
      .select('provider_config')
      .eq('company_id', PARENT_COMPANY_ID)
      .eq('provider', OPENAI_PROVIDER)
      .maybeSingle()

    if (readCfgErr) {
      res.status(500).json({ ok: false, error: 'Não foi possível ler as configurações' })
      return
    }

    const preservedConfig =
      existingRow?.provider_config &&
      typeof existingRow.provider_config === 'object' &&
      !Array.isArray(existingRow.provider_config)
        ? (existingRow.provider_config as Record<string, unknown>)
        : {}

    const { error } = await auth.supabase.from('integration_settings').upsert(
      {
        company_id: PARENT_COMPANY_ID,
        provider: OPENAI_PROVIDER,
        enabled: next.enabled,
        model: next.model,
        timeout_ms: next.timeout_ms,
        provider_config: preservedConfig,
      },
      { onConflict: 'company_id,provider' }
    )

    if (error) {
      res.status(500).json({ ok: false, error: 'Não foi possível salvar as configurações' })
      return
    }

    const merged = await fetchParentOpenAISettings(auth.supabase)
    res.status(200).json({
      ok: true,
      enabled: merged.enabled,
      model: merged.model,
      timeout_ms: merged.timeout_ms,
    })
    return
  }

  res.status(405).json({ ok: false, error: 'Método não permitido' })
}
