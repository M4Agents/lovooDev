// InstagramHealthBadge — badge compacto de status da conexão Instagram
// Usado no InstagramConnectionPanel (Settings) e futuramente na sidebar.

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionHealth, HealthLevel } from '../../utils/instagram/computeConnectionHealth'

interface InstagramHealthBadgeProps {
  health: ConnectionHealth
  size?: 'sm' | 'md'
  className?: string
}

const LEVEL_STYLES: Record<HealthLevel, { dot: string; badge: string }> = {
  healthy:      { dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700 border border-green-200' },
  warning:      { dot: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-700 border border-amber-200' },
  error:        { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700 border border-red-200' },
  disconnected: { dot: 'bg-slate-400',  badge: 'bg-slate-100 text-slate-600 border border-slate-200' },
}

const LEVEL_I18N_KEY: Record<HealthLevel, string> = {
  healthy:      'integrations.instagram.status.active',
  warning:      'integrations.instagram.status.warning',
  error:        'integrations.instagram.status.error',
  disconnected: 'integrations.instagram.status.revoked',
}

export const InstagramHealthBadge: React.FC<InstagramHealthBadgeProps> = ({
  health,
  size = 'sm',
  className = '',
}) => {
  const { t } = useTranslation('settings.app')
  const styles = LEVEL_STYLES[health.level]
  const textSz = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-medium ${textSz} ${styles.badge} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${styles.dot}`} />
      {t(LEVEL_I18N_KEY[health.level])}
    </span>
  )
}

export default InstagramHealthBadge
