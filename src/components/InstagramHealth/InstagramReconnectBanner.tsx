// InstagramReconnectBanner — banner de alerta de reconexão da conta Instagram
// Exibido no Chat (aba de Comentários/DMs) e nas Configurações quando a
// conexão não está saudável.

import React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, AlertCircle, RefreshCw, X, Clock } from 'lucide-react'
import type { ConnectionHealth, HealthLevel } from '../../utils/instagram/computeConnectionHealth'

interface InstagramReconnectBannerProps {
  health: ConnectionHealth
  username: string
  onReconnect?: () => void
  onDismiss?: () => void
  loading?: boolean
  /** Se true, exibe versão compacta (sem descrição longa) */
  compact?: boolean
  className?: string
}

const BANNER_STYLES: Record<HealthLevel, { wrapper: string; icon: string }> = {
  healthy:      { wrapper: '', icon: '' },
  warning:      { wrapper: 'bg-amber-50 border border-amber-200', icon: 'text-amber-500' },
  error:        { wrapper: 'bg-red-50 border border-red-200',     icon: 'text-red-500' },
  disconnected: { wrapper: 'bg-slate-50 border border-slate-200', icon: 'text-slate-500' },
}

const ICON_MAP: Record<HealthLevel, React.ReactNode> = {
  healthy:      null,
  warning:      <AlertTriangle className="w-4 h-4 shrink-0" />,
  error:        <AlertCircle   className="w-4 h-4 shrink-0" />,
  disconnected: <AlertCircle   className="w-4 h-4 shrink-0" />,
}

export const InstagramReconnectBanner: React.FC<InstagramReconnectBannerProps> = ({
  health,
  username,
  onReconnect,
  onDismiss,
  loading = false,
  compact = false,
  className = '',
}) => {
  const { t } = useTranslation('chat')

  if (health.level === 'healthy') return null

  const styles = BANNER_STYLES[health.level]

  const titleKey = `instagram.health.banner.${health.messageKey?.split('.').pop() ?? 'unknownStatus'}.title`
  const descKey  = `instagram.health.banner.${health.messageKey?.split('.').pop() ?? 'unknownStatus'}.desc`

  const fallbackTitle = t('instagram.health.bannerFallbackTitle', { account: username })

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${styles.wrapper} ${className}`} role="alert">
      <span className={styles.icon}>{ICON_MAP[health.level]}</span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 leading-snug">
          {t(titleKey, { account: username, defaultValue: fallbackTitle })}
        </p>
        {!compact && (
          <p className="text-xs text-slate-600 mt-0.5 leading-snug">
            {t(descKey, { account: username, defaultValue: '' })}
          </p>
        )}

        {health.expiresInDays !== null && health.expiresInDays <= 7 && health.expiresInDays > 0 && (
          <p className="flex items-center gap-1 text-xs text-amber-700 mt-1">
            <Clock className="w-3 h-3" />
            {t('instagram.health.expiresIn', { days: health.expiresInDays })}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {health.actionRequired === 'reconnect' && onReconnect && (
          <button
            onClick={onReconnect}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-purple-400 hover:text-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {t('instagram.health.reconnect')}
          </button>
        )}

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1 text-slate-400 hover:text-slate-600 transition-colors rounded"
            title={t('instagram.health.dismiss')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

export default InstagramReconnectBanner
