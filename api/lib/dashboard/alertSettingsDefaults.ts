// =====================================================
// alertSettingsDefaults
//
// Valores padrão, limites operacionais e funções de validação
// para as configurações personalizadas de alertas do dashboard.
//
// Unidade interna: MINUTOS (conversão para horas/dias ocorre na UI).
//
// Defaults globais — espelhados nos defaults da tabela dashboard_alert_settings:
//   sla:         min=240m (4h),  critical=1440m (24h), limit=10
//   stalled:     idle=20160m (14d), prob=60%,          limit=5
//   seller_risk: waiting=720m (12h), min_leads=3,      limit=3
//
// Regra: NUNCA retornar null/undefined — sempre cair no default.
// =====================================================

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface SlaSettings {
  enabled:          boolean
  min_minutes:      number
  critical_minutes: number
  limit:            number
}

export interface StalledSettings {
  enabled:         boolean
  idle_minutes:    number
  min_probability: number
  limit:           number
}

export interface SellerRiskSettings {
  enabled:         boolean
  waiting_minutes: number
  min_leads:       number
  limit:           number
}

export interface FunnelScopeSettings {
  mode:       'all' | 'custom'
  stage_ids?: string[]   // obrigatório quando mode = 'custom'; deve ser array não vazio
}

export interface AlertSettings {
  sla_settings:           SlaSettings
  stalled_settings:       StalledSettings
  seller_risk_settings:   SellerRiskSettings
  funnel_scope_settings:  FunnelScopeSettings
}

// ---------------------------------------------------------------------------
// Defaults globais
// ---------------------------------------------------------------------------

export const SLA_DEFAULTS: SlaSettings = {
  enabled:          true,
  min_minutes:      240,
  critical_minutes: 1440,
  limit:            10,
} as const

export const STALLED_DEFAULTS: StalledSettings = {
  enabled:         true,
  idle_minutes:    20160,
  min_probability: 60,
  limit:           5,
} as const

export const SELLER_RISK_DEFAULTS: SellerRiskSettings = {
  enabled:         true,
  waiting_minutes: 720,
  min_leads:       3,
  limit:           3,
} as const

export const GLOBAL_DEFAULTS: AlertSettings = {
  sla_settings:           SLA_DEFAULTS,
  stalled_settings:       STALLED_DEFAULTS,
  seller_risk_settings:   SELLER_RISK_DEFAULTS,
  funnel_scope_settings:  { mode: 'all' },
} as const

// ---------------------------------------------------------------------------
// Limites operacionais (previnem configurações absurdas ou degradação)
// ---------------------------------------------------------------------------

export const SETTINGS_LIMITS = {
  sla: {
    min_minutes:      { min: 5,    max: 43200  },   // 5m → 30 dias
    critical_minutes: { min: 6,    max: 86400  },   // 6m → 60 dias
    limit:            { min: 1,    max: 50     },
  },
  stalled: {
    idle_minutes:     { min: 1440, max: 525600 },   // 1 dia → 365 dias
    min_probability:  { min: 0,    max: 100    },
    limit:            { min: 1,    max: 50     },
  },
  seller_risk: {
    waiting_minutes:  { min: 60,   max: 10080  },   // 1h → 7 dias
    min_leads:        { min: 1,    max: 50     },
    limit:            { min: 1,    max: 50     },
  },
} as const

// ---------------------------------------------------------------------------
// Roles com permissão para gravar (POST)
// ---------------------------------------------------------------------------

export const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

// ---------------------------------------------------------------------------
// Chaves permitidas por seção (rejeita campos desconhecidos)
// ---------------------------------------------------------------------------

const SLA_KEYS          = new Set(['enabled', 'min_minutes', 'critical_minutes', 'limit'])
const STALLED_KEYS      = new Set(['enabled', 'idle_minutes', 'min_probability', 'limit'])
const SELLER_RISK_KEYS  = new Set(['enabled', 'waiting_minutes', 'min_leads', 'limit'])

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkRange(
  value: unknown,
  field: string,
  limits: { min: number; max: number },
): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `"${field}" deve ser um número`
  }
  if (!Number.isInteger(value)) {
    return `"${field}" deve ser um número inteiro`
  }
  if (value < limits.min || value > limits.max) {
    return `"${field}" deve estar entre ${limits.min} e ${limits.max}`
  }
  return null
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: Set<string>): string | null {
  const unknown = Object.keys(obj).filter(k => !allowed.has(k))
  if (unknown.length > 0) {
    return `Campos desconhecidos não permitidos: ${unknown.map(k => `"${k}"`).join(', ')}`
  }
  return null
}

// ---------------------------------------------------------------------------
// validateSlaSettings
// ---------------------------------------------------------------------------

export function validateSlaSettings(s: unknown): string | null {
  if (!isPlainObject(s)) {
    return 'sla_settings deve ser um objeto JSON'
  }

  const unknownErr = rejectUnknownKeys(s, SLA_KEYS)
  if (unknownErr) return `sla_settings: ${unknownErr}`

  if (typeof s.enabled !== 'boolean') {
    return 'sla_settings: "enabled" deve ser boolean'
  }

  const minErr = checkRange(s.min_minutes, 'min_minutes', SETTINGS_LIMITS.sla.min_minutes)
  if (minErr) return `sla_settings: ${minErr}`

  const critErr = checkRange(s.critical_minutes, 'critical_minutes', SETTINGS_LIMITS.sla.critical_minutes)
  if (critErr) return `sla_settings: ${critErr}`

  // Cross-field: critical deve ser maior que min
  if ((s.critical_minutes as number) <= (s.min_minutes as number)) {
    return 'sla_settings: "critical_minutes" deve ser maior que "min_minutes"'
  }

  const limitErr = checkRange(s.limit, 'limit', SETTINGS_LIMITS.sla.limit)
  if (limitErr) return `sla_settings: ${limitErr}`

  return null
}

// ---------------------------------------------------------------------------
// validateStalledSettings
// ---------------------------------------------------------------------------

export function validateStalledSettings(s: unknown): string | null {
  if (!isPlainObject(s)) {
    return 'stalled_settings deve ser um objeto JSON'
  }

  const unknownErr = rejectUnknownKeys(s, STALLED_KEYS)
  if (unknownErr) return `stalled_settings: ${unknownErr}`

  if (typeof s.enabled !== 'boolean') {
    return 'stalled_settings: "enabled" deve ser boolean'
  }

  const idleErr = checkRange(s.idle_minutes, 'idle_minutes', SETTINGS_LIMITS.stalled.idle_minutes)
  if (idleErr) return `stalled_settings: ${idleErr}`

  const probErr = checkRange(s.min_probability, 'min_probability', SETTINGS_LIMITS.stalled.min_probability)
  if (probErr) return `stalled_settings: ${probErr}`

  const limitErr = checkRange(s.limit, 'limit', SETTINGS_LIMITS.stalled.limit)
  if (limitErr) return `stalled_settings: ${limitErr}`

  return null
}

// ---------------------------------------------------------------------------
// validateSellerRiskSettings
// ---------------------------------------------------------------------------

export function validateSellerRiskSettings(s: unknown): string | null {
  if (!isPlainObject(s)) {
    return 'seller_risk_settings deve ser um objeto JSON'
  }

  const unknownErr = rejectUnknownKeys(s, SELLER_RISK_KEYS)
  if (unknownErr) return `seller_risk_settings: ${unknownErr}`

  if (typeof s.enabled !== 'boolean') {
    return 'seller_risk_settings: "enabled" deve ser boolean'
  }

  const waitErr = checkRange(s.waiting_minutes, 'waiting_minutes', SETTINGS_LIMITS.seller_risk.waiting_minutes)
  if (waitErr) return `seller_risk_settings: ${waitErr}`

  const leadsErr = checkRange(s.min_leads, 'min_leads', SETTINGS_LIMITS.seller_risk.min_leads)
  if (leadsErr) return `seller_risk_settings: ${leadsErr}`

  const limitErr = checkRange(s.limit, 'limit', SETTINGS_LIMITS.seller_risk.limit)
  if (limitErr) return `seller_risk_settings: ${limitErr}`

  return null
}

// ---------------------------------------------------------------------------
// validateFunnelScopeSettings
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateFunnelScopeSettings(s: unknown): string | null {
  if (!isPlainObject(s)) {
    return 'funnel_scope_settings deve ser um objeto JSON'
  }

  const mode = s.mode
  if (mode !== 'all' && mode !== 'custom') {
    return 'funnel_scope_settings: "mode" deve ser "all" ou "custom"'
  }

  if (mode === 'all') {
    return null
  }

  // mode = 'custom': stage_ids obrigatório, array não vazio de UUIDs válidos
  if (!Array.isArray(s.stage_ids)) {
    return 'funnel_scope_settings: "stage_ids" é obrigatório e deve ser um array quando mode = "custom"'
  }

  if (s.stage_ids.length === 0) {
    return 'funnel_scope_settings: "stage_ids" não pode ser vazio em mode = "custom". Selecione ao menos uma etapa ou escolha mode = "all"'
  }

  for (const id of s.stage_ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return `funnel_scope_settings: stage_ids contém um valor inválido: "${id}". Todos os itens devem ser UUIDs válidos`
    }
  }

  return null
}
