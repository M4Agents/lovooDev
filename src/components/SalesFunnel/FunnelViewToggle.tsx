import { LayoutGrid, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FunnelViewMode } from '../../types/sales-funnel'

interface FunnelViewToggleProps {
  viewMode: FunnelViewMode
  onChange: (mode: FunnelViewMode) => void
}

export function FunnelViewToggle({ viewMode, onChange }: FunnelViewToggleProps) {
  const { t } = useTranslation('funnel')

  return (
    <div
      className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5"
      role="group"
      aria-label={t('view.toggleLabel')}
    >
      <button
        type="button"
        onClick={() => onChange('kanban')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          viewMode === 'kanban'
            ? 'bg-blue-600 text-white'
            : 'text-gray-600 hover:bg-gray-50'
        }`}
        aria-pressed={viewMode === 'kanban'}
      >
        <LayoutGrid className="w-4 h-4" />
        <span>{t('view.kanban')}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          viewMode === 'list'
            ? 'bg-blue-600 text-white'
            : 'text-gray-600 hover:bg-gray-50'
        }`}
        aria-pressed={viewMode === 'list'}
      >
        <List className="w-4 h-4" />
        <span>{t('view.list')}</span>
      </button>
    </div>
  )
}
