// =============================================================================
// GET /api/integrations/notifications/settings
// PUT /api/integrations/notifications/settings
//
// Gestão das configurações de notificações da plataforma.
//
// AUTENTICAÇÃO: Authorization: Bearer <JWT>
// AUTORIZAÇÃO:  super_admin ou system_admin da empresa pai (PARENT_COMPANY_ID)
//
// GET — retorna configuração atual + instâncias WhatsApp disponíveis
// PUT — salva habilitação, canais e instância WhatsApp
//
// SEGURANÇA:
//   - Autorização validada no backend via assertNotificationsAdmin()
//   - company_id e provider são constantes do backend — nunca do body
//   - Canais permitidos: 'email', 'whatsapp' (lista fixa no backend)
//   - Se whatsapp habilitado: instância deve existir e estar connected
//   - fallback_email_if_whatsapp_fails permanece false (V1)
//   - model e timeout_ms (campos legados da tabela) são preservados ao atualizar
// =============================================================================

import { assertNotificationsAdmin, PARENT_COMPANY_ID } from '../../lib/notifications/auth.js'

// ── Constantes ─────────────────────────────────────────────────────────────────

const NOTIFICATIONS_PROVIDER  = 'notifications'
const VALID_CHANNELS           = ['email', 'whatsapp']

// Valores defaults para campos obrigatórios da tabela integration_settings
// que não pertencem ao domínio de notificações (preservar ao atualizar)
const DEFAULT_MODEL      = 'none'
const DEFAULT_TIMEOUT_MS = 30000

// ── Helpers internos ───────────────────────────────────────────────────────────

/**
 * Lê a configuração atual de notificações.
 * Retorna defaults seguros se a linha não existir.
 */
async function readCurrentSettings(supabase) {
  const { data, error } = await supabase
    .from('integration_settings')
    .select('enabled, provider_config, model, timeout_ms')
    .eq('company_id', PARENT_COMPANY_ID)
    .eq('provider', NOTIFICATIONS_PROVIDER)
    .maybeSingle()

  if (error || !data) {
    return {
      enabled:              false,
      whatsapp_instance_id: null,
      enabled_channels:     [],
      model:                DEFAULT_MODEL,
      timeout_ms:           DEFAULT_TIMEOUT_MS,
    }
  }

  const cfg = (data.provider_config && typeof data.provider_config === 'object' && !Array.isArray(data.provider_config))
    ? data.provider_config
    : {}

  return {
    enabled:              Boolean(data.enabled),
    whatsapp_instance_id: typeof cfg.whatsapp_instance_id === 'string' ? cfg.whatsapp_instance_id : null,
    enabled_channels:     Array.isArray(cfg.enabled_channels)
      ? cfg.enabled_channels.filter(c => VALID_CHANNELS.includes(c))
      : [],
    model:      data.model      ?? DEFAULT_MODEL,
    timeout_ms: data.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  }
}

/**
 * Lista instâncias WhatsApp conectadas da empresa pai.
 */
async function readAvailableInstances(supabase) {
  const { data, error } = await supabase
    .from('whatsapp_life_instances')
    .select('id, name, status')
    .eq('company_id', PARENT_COMPANY_ID)
    .eq('status', 'connected')
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error || !data) return []
  return data.map(inst => ({ id: inst.id, name: inst.name, status: inst.status }))
}

/**
 * Valida o body recebido no PUT.
 * Retorna { ok: true, value } ou { ok: false, error }.
 */
function validatePutBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body inválido' }
  }

  // Rejeitar campos não permitidos
  const allowed = new Set(['enabled', 'enabled_channels', 'whatsapp_instance_id'])
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return { ok: false, error: `Campo não permitido: ${key}` }
    }
  }

  if ('enabled' in body && typeof body.enabled !== 'boolean') {
    return { ok: false, error: 'enabled deve ser boolean' }
  }

  if ('enabled_channels' in body) {
    if (!Array.isArray(body.enabled_channels)) {
      return { ok: false, error: 'enabled_channels deve ser um array' }
    }
    const invalid = body.enabled_channels.filter(c => !VALID_CHANNELS.includes(c))
    if (invalid.length > 0) {
      return { ok: false, error: `Canais inválidos: ${invalid.join(', ')}. Aceitos: ${VALID_CHANNELS.join(', ')}` }
    }
  }

  if ('whatsapp_instance_id' in body) {
    const val = body.whatsapp_instance_id
    if (val !== null && typeof val !== 'string') {
      return { ok: false, error: 'whatsapp_instance_id deve ser string ou null' }
    }
  }

  return { ok: true, value: body }
}

// ── Handler principal ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') return res.status(204).end()

  // ── Autenticação e autorização ─────────────────────────────────────────────
  const auth = await assertNotificationsAdmin(req)
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error })
  }

  const { supabase } = auth

  // ── GET — retornar config + instâncias disponíveis ─────────────────────────
  if (req.method === 'GET') {
    try {
      const [current, instances] = await Promise.all([
        readCurrentSettings(supabase),
        readAvailableInstances(supabase),
      ])

      return res.status(200).json({
        ok:                   true,
        enabled:              current.enabled,
        enabled_channels:     current.enabled_channels,
        whatsapp_instance_id: current.whatsapp_instance_id,
        available_instances:  instances,
      })
    } catch (err) {
      console.error('[notifications/settings GET] Erro interno:', err?.message)
      return res.status(500).json({ ok: false, error: 'Erro ao buscar configurações' })
    }
  }

  // ── PUT — salvar configuração ──────────────────────────────────────────────
  if (req.method === 'PUT') {
    const parsed = validatePutBody(req.body)
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: parsed.error })
    }

    const body = parsed.value

    // Ler estado atual para merge e preservar campos legados (model, timeout_ms)
    const current = await readCurrentSettings(supabase)

    const nextEnabled  = 'enabled'          in body ? body.enabled          : current.enabled
    const nextChannels = 'enabled_channels' in body ? body.enabled_channels : current.enabled_channels
    const nextWaId     = 'whatsapp_instance_id' in body ? body.whatsapp_instance_id : current.whatsapp_instance_id

    // Se whatsapp está nos canais habilitados, validar a instância
    if (nextChannels.includes('whatsapp') && nextEnabled) {
      if (!nextWaId) {
        return res.status(400).json({
          ok:    false,
          error: 'whatsapp_instance_id é obrigatório quando o canal whatsapp está habilitado',
        })
      }

      // Verificar se a instância existe e está conectada
      const { data: inst, error: instError } = await supabase
        .from('whatsapp_life_instances')
        .select('id, status, deleted_at')
        .eq('id', nextWaId)
        .eq('company_id', PARENT_COMPANY_ID)
        .maybeSingle()

      if (instError || !inst) {
        return res.status(400).json({ ok: false, error: 'Instância WhatsApp não encontrada' })
      }
      if (inst.deleted_at !== null) {
        return res.status(400).json({ ok: false, error: 'Instância WhatsApp foi removida' })
      }
      if (inst.status !== 'connected') {
        return res.status(400).json({
          ok:    false,
          error: `Instância WhatsApp não está conectada (status atual: ${inst.status})`,
        })
      }
    }

    // Upsert na tabela integration_settings
    const { error: upsertError } = await supabase
      .from('integration_settings')
      .upsert(
        {
          company_id:     PARENT_COMPANY_ID,
          provider:       NOTIFICATIONS_PROVIDER,
          enabled:        nextEnabled,
          model:          current.model,
          timeout_ms:     current.timeout_ms,
          provider_config: {
            whatsapp_instance_id:             nextWaId,
            enabled_channels:                 nextChannels,
            fallback_email_if_whatsapp_fails: false,
          },
        },
        { onConflict: 'company_id,provider' }
      )

    if (upsertError) {
      console.error('[notifications/settings PUT] Erro ao salvar:', upsertError.message)
      return res.status(500).json({ ok: false, error: 'Erro ao salvar configurações' })
    }

    return res.status(200).json({ ok: true, success: true })
  }

  return res.status(405).json({ ok: false, error: 'Método não permitido' })
}
