import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { CycleStateSummary } from './CycleStateSummary'
import { ContactCycleTimeline } from './ContactCycleTimeline'
import type { ContactCycleState, ContactCycleHistoryItem } from '../../types/contact-cycles'
import type { AttemptsByCycle } from '../../hooks/useContactCyclePanel'

interface ContactCyclePanelProps {
  state:           ContactCycleState | null
  cycles:          ContactCycleHistoryItem[]
  attemptsByCycle: AttemptsByCycle
  loading:         boolean
  error:           string | null
  refresh:         () => void
  opportunityId:   string
  companyId:       string
  canOperate:      boolean
}

export function ContactCyclePanel({
  state,
  cycles,
  attemptsByCycle,
  loading,
  error,
  refresh,
  opportunityId,
  companyId,
  canOperate,
}: ContactCyclePanelProps) {
  const { t } = useTranslation('funnel')

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-7 h-7 rounded-full bg-gray-200 flex-shrink-0" />
            <div className="flex-1 space-y-1.5 pb-4">
              <div className="h-3 bg-gray-200 rounded w-3/4" />
              <div className="h-2 bg-gray-100 rounded w-1/2" />
              <div className="h-2 bg-gray-100 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 opacity-70" />
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('form.tryAgain', 'Tentar novamente')}
        </button>
      </div>
    )
  }

  if (!state && cycles.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-gray-400">
        <RefreshCw className="w-8 h-8 opacity-30" />
        <p className="text-sm">{t('contactCycle.empty')}</p>
      </div>
    )
  }

  const lastCloseReason =
    cycles.find(c => c.status === 'closed')?.close_reason ?? null

  return (
    <div className="space-y-4">
      {/* Resumo do estado atual */}
      {state && (
        <CycleStateSummary
          state={state}
          lastCloseReason={lastCloseReason}
          canOperate={canOperate}
          opportunityId={opportunityId}
          companyId={companyId}
          refresh={refresh}
        />
      )}

      {/* Timeline visual de ciclos */}
      <ContactCycleTimeline
        cycles={cycles}
        attemptsByCycle={attemptsByCycle}
        canOperate={canOperate}
        opportunityId={opportunityId}
        companyId={companyId}
        refresh={refresh}
      />
    </div>
  )
}
