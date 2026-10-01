import { useTranslation } from 'react-i18next'

interface FunnelListBulkBarProps {
  opportunityCount: number
  leadCount: number
  canMoveToFunnel: boolean
  canBulkAssign: boolean
  canBulkTag: boolean
  onMoveToFunnel: () => void
  onAssign: () => void
  onTag: () => void
  onClear: () => void
}

export function FunnelListBulkBar({
  opportunityCount,
  leadCount,
  canMoveToFunnel,
  canBulkAssign,
  canBulkTag,
  onMoveToFunnel,
  onAssign,
  onTag,
  onClear,
}: FunnelListBulkBarProps) {
  const { t } = useTranslation('funnel')
  const showLeadActions = canBulkAssign || canBulkTag

  if (opportunityCount === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      <div className="flex items-center gap-3 px-5 py-3 bg-gray-900 text-white rounded-full shadow-xl">
        <span className="text-sm font-medium">
          {t('list.selectedSummary', {
            opportunities: opportunityCount,
            leads: leadCount,
          })}
        </span>
        <div className="w-px h-4 bg-white/30" />
        <button
          type="button"
          onClick={canMoveToFunnel ? onMoveToFunnel : undefined}
          disabled={!canMoveToFunnel}
          title={!canMoveToFunnel ? t('list.moveToFunnelDisabledTitle') : undefined}
          className={`text-sm font-medium transition-colors ${
            canMoveToFunnel
              ? 'text-purple-300 hover:text-purple-200'
              : 'text-gray-500 cursor-not-allowed'
          }`}
        >
          {t('list.moveToFunnel')}
        </button>
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
      {showLeadActions && (
        <p className="text-xs text-white/80 bg-gray-900/90 px-3 py-1 rounded-full">
          {t('list.leadChangeWarning')}
        </p>
      )}
    </div>
  )
}
