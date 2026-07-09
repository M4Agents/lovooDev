import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { getCloseReasonKey } from '../../utils/cycleLabels'
import { AttemptRow } from './AttemptRow'
import { useAuth } from '../../contexts/AuthContext'
import type { ContactCycleHistoryItem, ContactAttemptDetail } from '../../types/contact-cycles'

interface CycleCardProps {
  cycle:         ContactCycleHistoryItem
  attempts:      ContactAttemptDetail[]
  canOperate:    boolean
  opportunityId: string
  companyId:     string
  refresh:       () => void
}

export function CycleCard({
  cycle,
  attempts,
  canOperate,
  opportunityId,
  companyId,
  refresh,
}: CycleCardProps) {
  const { t } = useTranslation('funnel')
  const { companyTimezone } = useAuth()
  // Ciclo aberto: expandido por padrão; fechado: recolhido por padrão
  const [expanded, setExpanded] = useState(cycle.status === 'open')

  const isOpen = cycle.status === 'open'

  const fmtDate = (iso?: string | null): string => {
    if (!iso) return '—'
    // #region agent log
    console.log('[debug-cycles][CycleCard]', { iso, companyTimezone, parsedUTC: new Date(iso).toISOString() })
    // #endregion
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: companyTimezone,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  }

  return (
    <div className={`rounded-lg border ${isOpen ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
      {/* Header do ciclo — clicável para expandir/recolher */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* badge status */}
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
              isOpen
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {isOpen ? t('contactCycle.cycleStatus.open') : t('contactCycle.cycleStatus.closed')}
          </span>

          {/* datas */}
          <span className="text-xs text-gray-500 truncate">
            {fmtDate(cycle.opened_at)}
            {cycle.closed_at && ` → ${fmtDate(cycle.closed_at)}`}
          </span>

          {/* motivo de fechamento */}
          {cycle.close_reason && (
            <span className="text-xs text-gray-400 italic">
              {t(getCloseReasonKey(cycle.close_reason))}
            </span>
          )}

          {/* contagem de tentativas */}
          <span className="text-xs text-gray-400 flex-shrink-0">
            {t('contactCycle.totalAttempts', { count: cycle.attempt_count })}
          </span>
        </div>

        <div className="flex-shrink-0 text-gray-400 ml-2">
          {expanded
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {/* Lista de tentativas */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {attempts.length === 0 ? (
            <p className="text-xs text-gray-400 py-1">{t('contactCycle.noAttempts')}</p>
          ) : (
            attempts.map(attempt => (
              <AttemptRow
                key={attempt.attempt_id}
                attempt={attempt}
                canOperate={canOperate}
                opportunityId={opportunityId}
                companyId={companyId}
                refresh={refresh}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
