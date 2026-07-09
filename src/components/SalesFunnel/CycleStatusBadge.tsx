import { useTranslation } from 'react-i18next'
import type { ContactAttemptsState } from '../../types/contact-cycles'

interface CycleStatusBadgeProps {
  state:         ContactAttemptsState | null | undefined
  attemptCount?: number | null
}

const BADGE_STYLE: Record<string, string> = {
  cycle_open: 'bg-indigo-100 text-indigo-700',
  waiting:    'bg-amber-100 text-amber-700',
  eligible:   'bg-emerald-100 text-emerald-700',
}

export function CycleStatusBadge({ state, attemptCount }: CycleStatusBadgeProps) {
  const { t } = useTranslation('funnel')

  if (!state || state === 'none') return null

  const style = BADGE_STYLE[state]
  if (!style) return null

  const label   = t(`contactCycle.attemptsState.${state}`)
  const tooltip = t(`contactCycle.attemptsStateTooltip.${state}`)

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${style}`}
      title={tooltip}
    >
      {label}
      {typeof attemptCount === 'number' && attemptCount > 0 && (
        <span className="font-bold">{attemptCount}</span>
      )}
    </span>
  )
}
