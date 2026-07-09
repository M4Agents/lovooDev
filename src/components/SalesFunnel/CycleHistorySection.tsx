import { useTranslation } from 'react-i18next'
import { CycleCard } from './CycleCard'
import type { ContactCycleHistoryItem } from '../../types/contact-cycles'
import type { AttemptsByCycle } from '../../hooks/useContactCyclePanel'

interface CycleHistorySectionProps {
  cycles:          ContactCycleHistoryItem[]
  attemptsByCycle: AttemptsByCycle
  canOperate:      boolean
  opportunityId:   string
  companyId:       string
  refresh:         () => void
}

export function CycleHistorySection({
  cycles,
  attemptsByCycle,
  canOperate,
  opportunityId,
  companyId,
  refresh,
}: CycleHistorySectionProps) {
  const { t } = useTranslation('funnel')

  if (cycles.length === 0) return null

  // Mais recente primeiro
  const sorted = [...cycles].sort(
    (a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime(),
  )

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        {t('contactCycle.historyTitle')}
      </p>
      <div className="space-y-2">
        {sorted.map(cycle => (
          <CycleCard
            key={cycle.cycle_id}
            cycle={cycle}
            attempts={attemptsByCycle[cycle.cycle_id] ?? []}
            canOperate={canOperate}
            opportunityId={opportunityId}
            companyId={companyId}
            refresh={refresh}
          />
        ))}
      </div>
    </div>
  )
}
