// InstagramScopeWarning — aviso inline de escopo OAuth ausente
// Exibido na área de comentários ou DMs quando o scope necessário não foi concedido.

import React from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, RefreshCw } from 'lucide-react'
import { SCOPE_DMS, SCOPE_COMMENTS } from '../../utils/instagram/computeConnectionHealth'

interface InstagramScopeWarningProps {
  missingScopes: string[]
  onReconnect?: () => void
  loading?: boolean
  className?: string
}

const SCOPE_LABELS: Record<string, string> = {
  [SCOPE_DMS]:      'DMs (instagram_business_manage_messages)',
  [SCOPE_COMMENTS]: 'Comentários (instagram_business_manage_comments)',
}

export const InstagramScopeWarning: React.FC<InstagramScopeWarningProps> = ({
  missingScopes,
  onReconnect,
  loading = false,
  className = '',
}) => {
  const { t } = useTranslation('chat')

  if (!missingScopes || missingScopes.length === 0) return null

  const labels = missingScopes.map(s => SCOPE_LABELS[s] ?? s)

  return (
    <div
      className={`flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm ${className}`}
      role="alert"
    >
      <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-amber-800 leading-snug">
          {t('instagram.health.scopeWarning.title')}
        </p>
        <ul className="mt-1 space-y-0.5">
          {labels.map(label => (
            <li key={label} className="text-xs text-amber-700 list-disc list-inside">
              {label}
            </li>
          ))}
        </ul>
        <p className="text-xs text-amber-600 mt-1.5">
          {t('instagram.health.scopeWarning.hint')}
        </p>
      </div>

      {onReconnect && (
        <button
          onClick={onReconnect}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {t('instagram.health.reconnect')}
        </button>
      )}
    </div>
  )
}

export default InstagramScopeWarning
