import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { CycleStateSummary } from './CycleStateSummary'
import { CycleHistorySection } from './CycleHistorySection'
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

  // estado: carregando
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('contactCycle.loading')}
      </div>
    )
  }

  // estado: erro
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

  // estado: sem dados (módulo desabilitado ou oportunidade sem histórico)
  if (!state && cycles.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-gray-400">
        <RefreshCw className="w-8 h-8 opacity-30" />
        <p className="text-sm">{t('contactCycle.empty')}</p>
      </div>
    )
  }

  // motivo do último fechamento — do ciclo mais recente fechado
  const lastCloseReason =
    cycles.find(c => c.status === 'closed')?.close_reason ?? null

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        {t('contactCycle.tabTitle')}
      </p>

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

      {/* Histórico de ciclos */}
      <CycleHistorySection
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
