import { useTranslation } from 'react-i18next'

interface FunnelListBulkBarProps {
  opportunityCount: number
  leadCount: number
  canBulkAssign: boolean
  canBulkTag: boolean
  onAssign: () => void
  onTag: () => void
  onClear: () => void
}

export function FunnelListBulkBar({
  opportunityCount,
  leadCount,
  canBulkAssign,
  canBulkTag,
  onAssign,
  onTag,
  onClear,
}: FunnelListBulkBarProps) {
  const { t } = useTranslation('funnel')

  if (opportunityCount === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      <p className="text-xs text-white/80 bg-gray-900/90 px-3 py-1 rounded-full">
        {t('list.leadChangeWarning')}
      </p>
      <div className="flex items-center gap-3 px-5 py-3 bg-gray-900 text-white rounded-full shadow-xl">
        <span className="text-sm font-medium">
          {t('list.selectedSummary', {
            opportunities: opportunityCount,
            leads: leadCount,
          })}
        </span>
        {canBulkAssign && (
          <>
            <div className="w-px h-4 bg-white/30" />
            <button
              type="button"
              onClick={onAssign}
              className="text-sm font-medium text-blue-300 hover:text-blue-200 transition-colors"
            >
              {t('list.assignLeadResponsible')}
            </button>
          </>
        )}
        {canBulkTag && (
          <>
            <div className="w-px h-4 bg-white/30" />
            <button
              type="button"
              onClick={onTag}
              className="text-sm font-medium text-emerald-300 hover:text-emerald-200 transition-colors"
            >
              {t('list.assignTags')}
            </button>
          </>
        )}
        <div className="w-px h-4 bg-white/30" />
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
        >
          {t('list.clearSelection')}
        </button>
      </div>
    </div>
  )
}
