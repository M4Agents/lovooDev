import { comparisonWindowTitle, type ComparisonMode } from '../../../lib/snapshotPeriods'

interface Props {
  mode: ComparisonMode
  timeZone?: string | null
  onChange: (mode: ComparisonMode) => void
}

const OPTIONS: Array<{ mode: ComparisonMode; label: string }> = [
  { mode: 'wow', label: 'Semana' },
  { mode: 'mom', label: 'Mês' },
]

export function ComparisonModeToggle({ mode, timeZone, onChange }: Props) {
  return (
    <div className="flex items-center rounded-lg border border-gray-200 bg-white text-xs overflow-hidden">
      {OPTIONS.map(option => {
        const selected = mode === option.mode
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => onChange(option.mode)}
            className={`px-3 py-1.5 font-medium transition-colors ${
              selected
                ? 'bg-indigo-600 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title={comparisonWindowTitle(option.mode, timeZone)}
            aria-pressed={selected}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
