import type { ContactAttemptsState } from '../../types/contact-cycles'

interface CycleStatusBadgeProps {
  state: ContactAttemptsState | null | undefined
}

const BADGE_CONFIG = {
  cycle_open: {
    label: 'Em ciclo',
    className: 'bg-indigo-100 text-indigo-700',
  },
  waiting: {
    label: 'Aguardando',
    className: 'bg-amber-100 text-amber-700',
  },
  eligible: {
    label: 'Elegível',
    className: 'bg-emerald-100 text-emerald-700',
  },
} as const

export function CycleStatusBadge({ state }: CycleStatusBadgeProps) {
  if (!state || state === 'none') return null

  const config = BADGE_CONFIG[state]
  if (!config) return null

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${config.className}`}
    >
      {config.label}
    </span>
  )
}
