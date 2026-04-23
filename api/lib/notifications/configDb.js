// =============================================================================
// api/lib/notifications/configDb.js
//
// Leitura da configuração do sistema de notificações a partir de
// integration_settings (provider='notifications', company_id=PARENT_COMPANY_ID).
//
// Padrão: mesmo modelo de api/lib/openai/settingsDb.ts e
//         api/lib/elevenlabs/settingsDb.ts — auto-contido, tolerante a falhas,
//         sem side effects, sem dependência de contexto de usuário.
//
// Uso: chamado pelo cron (api/cron/alert-trials.js) no início de cada execução.
// Nunca importar no frontend.
// =============================================================================

import { createClient } from '@supabase/supabase-js'

// ── Constantes ────────────────────────────────────────────────────────────────

const NOTIFICATIONS_PROVIDER = 'notifications'

const DEFAULT_PARENT_COMPANY_ID = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'

/** PARENT_COMPANY_ID: env Vercel (PARENT_COMPANY_ID) com fallback para M4 Digital. */
const PARENT_COMPANY_ID =
  (typeof process !== 'undefined' && typeof process.env?.PARENT_COMPANY_ID === 'string'
    ? process.env.PARENT_COMPANY_ID.trim()
    : '') || DEFAULT_PARENT_COMPANY_ID

/**
 * Config retornada quando não há linha em integration_settings ou quando
 * o sistema está desabilitado. Garante comportamento seguro por padrão:
 * nenhum canal habilitado, nenhuma instância WA selecionada.
 */
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  whatsapp_instance_id: null,
  enabled_channels: [],
  fallback_email_if_whatsapp_fails: false,
})

// ── Cliente service_role (criado sob demanda, isolado neste módulo) ───────────

/**
 * Cria cliente Supabase com service_role exclusivamente para leitura de
 * integration_settings da empresa pai.
 * Retorna null se variáveis de ambiente estiverem ausentes.
 * Nunca expor esta chave no frontend.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
function createServiceClient() {
  const url = process.env.VITE_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// ── Parser do provider_config ─────────────────────────────────────────────────

/**
 * Normaliza o provider_config lido do banco para o shape esperado.
 * Tolerante a campos ausentes, nulos ou com tipos inesperados.
 *
 * @param {unknown} raw - Valor raw do campo provider_config (jsonb)
 * @returns {{ whatsapp_instance_id: string|null, enabled_channels: string[], fallback_email_if_whatsapp_fails: boolean }}
 */
function parseProviderConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      whatsapp_instance_id: null,
      enabled_channels: [],
      fallback_email_if_whatsapp_fails: false,
    }
  }

  const o = /** @type {Record<string, unknown>} */ (raw)

  // whatsapp_instance_id: string UUID ou null
  const waId = o.whatsapp_instance_id
  const whatsapp_instance_id =
    typeof waId === 'string' && waId.trim().length > 0 ? waId.trim() : null

  // enabled_channels: array de strings válidas ('email' | 'whatsapp')
  const VALID_CHANNELS = ['email', 'whatsapp']
  const rawChannels = o.enabled_channels
  const enabled_channels = Array.isArray(rawChannels)
    ? rawChannels.filter(c => typeof c === 'string' && VALID_CHANNELS.includes(c))
    : []

  // fallback_email_if_whatsapp_fails: boolean (false por padrão)
  const fallback_email_if_whatsapp_fails =
    o.fallback_email_if_whatsapp_fails === true

  return { whatsapp_instance_id, enabled_channels, fallback_email_if_whatsapp_fails }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} NotificationsConfig
 * @property {boolean}     enabled                          - Sistema habilitado
 * @property {string|null} whatsapp_instance_id             - UUID da instância WA selecionada
 * @property {string[]}    enabled_channels                 - Canais ativos: 'email' e/ou 'whatsapp'
 * @property {boolean}     fallback_email_if_whatsapp_fails - V2: fallback automático (sempre false em V1)
 */

/**
 * Lê a configuração de notificações a partir de integration_settings.
 * Usa service_role para leitura direta (cron não tem auth.uid()).
 *
 * Comportamento tolerante:
 *   - Env vars ausentes → retorna DEFAULT_CONFIG (enabled=false)
 *   - Linha não encontrada → retorna DEFAULT_CONFIG (enabled=false)
 *   - Erro de DB → retorna DEFAULT_CONFIG (enabled=false)
 *   - Nunca lança exceção — erros são silenciosos e seguros
 *
 * @returns {Promise<NotificationsConfig>}
 */
export async function fetchNotificationsConfig() {
  const svc = createServiceClient()
  if (!svc) {
    return { ...DEFAULT_CONFIG }
  }

  const { data, error } = await svc
    .from('integration_settings')
    .select('enabled, provider_config')
    .eq('company_id', PARENT_COMPANY_ID)
    .eq('provider', NOTIFICATIONS_PROVIDER)
    .maybeSingle()

  if (error || !data) {
    return { ...DEFAULT_CONFIG }
  }

  const providerConfig = parseProviderConfig(data.provider_config)

  return {
    enabled: Boolean(data.enabled),
    ...providerConfig,
  }
}

/**
 * Verifica se um canal específico está habilitado na configuração.
 * Combina enabled=true com presença do canal em enabled_channels.
 *
 * @param {NotificationsConfig} config  - Config retornada por fetchNotificationsConfig()
 * @param {'email'|'whatsapp'} channel  - Canal a verificar
 * @returns {boolean}
 */
export function isChannelEnabled(config, channel) {
  return config.enabled === true && config.enabled_channels.includes(channel)
}
