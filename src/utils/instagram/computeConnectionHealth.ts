// =============================================================================
// computeConnectionHealth — utilitário central de health da integração Instagram
//
// Função pura, sem dependências React. Calcula o "health" de uma conexão
// Instagram a partir de status + scopes, determinando:
//   - nível visual (healthy / warning / error / disconnected)
//   - capacidade de envio de DMs e gerenciamento de comentários
//   - dias restantes até expiração do token
//   - escopos críticos ausentes
//   - ação necessária pelo operador
//
// REGRAS DE NEGÓCIO:
//   - status=error → warning (degradado), NÃO bloqueia; cron fará retry automático
//   - status=limited + scopes ausentes → warning + reconnect
//   - status=limited + sem scopes ausentes → warning + wait
//   - status=reauth_required | expired → error (token definitivamente inválido)
//   - status=revoked → disconnected
//   - status=active + scope ausente → warning + reconnect
//   - status=active + todos os scopes → healthy
// =============================================================================

import type { InstagramConnection, InstagramConnectionStatus } from '../../types/instagram-chat'

// Escopos críticos que precisam estar presentes
export const SCOPE_DMS      = 'instagram_business_manage_messages'
export const SCOPE_COMMENTS = 'instagram_business_manage_comments'
export const SCOPE_BASIC    = 'instagram_business_basic'

export type HealthLevel = 'healthy' | 'warning' | 'error' | 'disconnected'

export interface ConnectionHealth {
  level:              HealthLevel
  canSendDMs:         boolean
  canManageComments:  boolean
  expiresInDays:      number | null
  missingScopes:      string[]
  actionRequired:     'reconnect' | 'wait' | null
  /** Chave i18n para a mensagem de status a ser exibida no banner/badge */
  messageKey:         string
}

export function computeConnectionHealth(conn: InstagramConnection): ConnectionHealth {
  const { status, scopes, token_expires_at, status_reason } = conn as InstagramConnection & { status_reason?: string | null }

  // ── 1. Calcular dias restantes ──────────────────────────────────────────────
  let expiresInDays: number | null = null
  if (token_expires_at) {
    const msLeft = new Date(token_expires_at).getTime() - Date.now()
    expiresInDays = Math.ceil(msLeft / (1000 * 60 * 60 * 24))
  }

  // ── 2. Detectar scopes ausentes ─────────────────────────────────────────────
  // Se scopes = null (conexão antiga pré-campo), assumir que tem o básico mas
  // pode faltar comentários. Nunca bloquear DMs por falta do campo.
  const grantedScopes = scopes ?? []
  const missingScopes: string[] = []

  if (grantedScopes.length > 0) {
    if (!grantedScopes.includes(SCOPE_DMS))      missingScopes.push(SCOPE_DMS)
    if (!grantedScopes.includes(SCOPE_COMMENTS)) missingScopes.push(SCOPE_COMMENTS)
  }

  const missingComments = grantedScopes.length > 0 && !grantedScopes.includes(SCOPE_COMMENTS)
  const missingDMs      = grantedScopes.length > 0 && !grantedScopes.includes(SCOPE_DMS)

  // ── 3. Mapear status → health ───────────────────────────────────────────────

  switch (status as InstagramConnectionStatus) {
    case 'active': {
      if (missingScopes.length > 0) {
        return {
          level:             'warning',
          canSendDMs:        !missingDMs,
          canManageComments: !missingComments,
          expiresInDays,
          missingScopes,
          actionRequired:    'reconnect',
          messageKey:        'health.scopeMissing',
        }
      }
      return {
        level:             'healthy',
        canSendDMs:        true,
        canManageComments: true,
        expiresInDays,
        missingScopes:     [],
        actionRequired:    null,
        messageKey:        'status.active',
      }
    }

    case 'limited': {
      // Se scopes indicam problema → reconnect; caso contrário pode ser rate limit → wait
      const hasRateLimit = typeof status_reason === 'string' &&
        (status_reason.toLowerCase().includes('rate') || status_reason.toLowerCase().includes('limit'))
      const action = missingScopes.length > 0 ? 'reconnect' : (hasRateLimit ? 'wait' : 'reconnect')
      return {
        level:             'warning',
        canSendDMs:        !missingDMs,
        canManageComments: !missingComments,
        expiresInDays,
        missingScopes,
        actionRequired:    action,
        messageKey:        action === 'wait' ? 'health.temporaryError' : 'health.scopeMissing',
      }
    }

    case 'error':
      // Erro temporário — NÃO bloqueia envio; cron tentará novamente
      return {
        level:             'warning',
        canSendDMs:        false,
        canManageComments: false,
        expiresInDays,
        missingScopes,
        actionRequired:    'wait',
        messageKey:        'health.temporaryError',
      }

    case 'reauth_required':
      return {
        level:             'error',
        canSendDMs:        false,
        canManageComments: false,
        expiresInDays:     null,
        missingScopes,
        actionRequired:    'reconnect',
        messageKey:        'health.reauthRequired',
      }

    case 'expired':
      return {
        level:             'error',
        canSendDMs:        false,
        canManageComments: false,
        expiresInDays:     null,
        missingScopes,
        actionRequired:    'reconnect',
        messageKey:        'health.tokenExpired',
      }

    case 'revoked':
      return {
        level:             'disconnected',
        canSendDMs:        false,
        canManageComments: false,
        expiresInDays:     null,
        missingScopes:     [],
        actionRequired:    'reconnect',
        messageKey:        'health.revoked',
      }

    default:
      return {
        level:             'warning',
        canSendDMs:        false,
        canManageComments: false,
        expiresInDays,
        missingScopes,
        actionRequired:    'reconnect',
        messageKey:        'health.unknownStatus',
      }
  }
}

/** Retorna true se a conexão precisa de atenção imediata do operador */
export function isConnectionCritical(health: ConnectionHealth): boolean {
  return health.level === 'error' || health.level === 'disconnected'
}

/** Retorna true se a conexão está operacional (pode enviar DMs ou comentários) */
export function isConnectionOperational(health: ConnectionHealth): boolean {
  return health.level === 'healthy' || health.level === 'warning'
}
