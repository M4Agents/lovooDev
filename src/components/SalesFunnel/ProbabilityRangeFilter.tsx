import { useTranslation } from 'react-i18next'
import {
  PROBABILITY_PRESETS,
  type ProbabilityRange,
} from '../../utils/funnelProbabilityFilter'

interface ProbabilityRangeFilterProps {
  minText: string
  maxText: string
  error: string | null
  applied: ProbabilityRange
  onMinChange: (value: string) => void
  onMaxChange: (value: string) => void
  onApply: () => void
  onPreset: (range: ProbabilityRange) => void
}

export function ProbabilityRangeFilter({
  minText,
  maxText,
  error,
  applied,
  onMinChange,
  onMaxChange,
  onApply,
  onPreset,
}: ProbabilityRangeFilterProps) {
  const { t } = useTranslation('funnel')

  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {t('filters.probabilityLabel')}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={minText}
          onChange={(e) => onMinChange(e.target.value)}
          placeholder={t('filters.probabilityFrom')}
          className="min-w-[4.5rem] flex-1 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          aria-label={t('filters.probabilityFrom')}
        />
        <span className="text-xs text-gray-400">–</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={maxText}
          onChange={(e) => onMaxChange(e.target.value)}
          placeholder={t('filters.probabilityTo')}
          className="min-w-[4.5rem] flex-1 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          aria-label={t('filters.probabilityTo')}
        />
        <button
          type="button"
          onClick={onApply}
          className="shrink-0 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
        >
          {t('filters.probabilityApply')}
        </button>
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {PROBABILITY_PRESETS.map((preset) => {
          const active = applied.min === preset.min && applied.max === preset.max
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPreset({ min: preset.min, max: preset.max })}
              className={`px-2 py-0.5 text-xs rounded-full border ${
                active
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t(`filters.probabilityPreset_${preset.id}`)}
            </button>
          )
        })}
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
