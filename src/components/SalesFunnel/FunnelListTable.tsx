import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { CustomFieldDefinition, CustomFieldValueEntry, FunnelStage, OpportunityFunnelPosition } from '../../types/sales-funnel'
import {
  buildFunnelListColumns,
  listTableMinWidth,
  type FunnelListColumnConfig,
} from '../../utils/funnelListVisibleColumns'
import { FunnelListBodyCell } from './FunnelListCells'
import type { ListStageError } from './useFunnelListPositions'

export interface FunnelListGroup {
  stage: FunnelStage
  positions: OpportunityFunnelPosition[]
  loadedCount: number
  totalCount: number | null
  hasMore: boolean
  loading: boolean
  error: ListStageError
}

interface AssignableUser {
  user_id: string
  display_name: string
}

interface FunnelListTableProps {
  groups: FunnelListGroup[]
  canSelect: boolean
  selectedPositionIds: Set<string>
  onToggleSelect: (positionId: string, leadId: number, opportunityId: string, stageId: string) => void
  onSelectLoaded: () => void
  onSelectLoadedInStage: (stageId: string) => void
  onDeselectLoadedInStage: (stageId: string) => void
  onClearSelection: () => void
  onRowClick: (opportunityId: string) => void
  onChatClick?: (leadId: number) => void
  onLoadMoreStage: (stageId: string) => void
  onRetryStage: (stageId: string) => void
  userById: Map<string, AssignableUser>
  showCycleColumn: boolean
  visibleFields: string[]
  customFields?: CustomFieldDefinition[]
  customFieldValuesMap?: Record<number, CustomFieldValueEntry[]>
}

function resolveLead(position: OpportunityFunnelPosition) {
  return position.opportunity?.lead ?? position.lead
}

function selectablePositions(positions: OpportunityFunnelPosition[]) {
  return positions.filter((position) => {
    const lead = resolveLead(position)
    return Boolean(position.lead_id || lead?.id || position.opportunity?.lead_id)
  })
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  title,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  disabled?: boolean
  title: string
  onChange: (checked: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])

  return (
    <input
      ref={ref}
      type="checkbox"
      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      checked={checked}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

export function FunnelListTable({
  groups,
  canSelect,
  selectedPositionIds,
  onToggleSelect,
  onSelectLoaded,
  onSelectLoadedInStage,
  onDeselectLoadedInStage,
  onClearSelection,
  onRowClick,
  onChatClick,
  onLoadMoreStage,
  onRetryStage,
  userById,
  showCycleColumn,
  visibleFields,
  customFields = [],
  customFieldValuesMap = {},
}: FunnelListTableProps) {
  const { t } = useTranslation('funnel')
  const columnConfig = useMemo(
    () => buildFunnelListColumns({
      canSelect,
      showCycleColumn,
      visibleFields,
      customFields,
    }),
    [canSelect, showCycleColumn, visibleFields, customFields],
  )
  const { columns } = columnConfig
  const colSpan = columns.length
  const selectable = selectablePositions(groups.flatMap(g => g.positions))
  const allSelected = selectable.length > 0 && selectable.every(p => selectedPositionIds.has(p.id))
  const someSelected = selectable.some(p => selectedPositionIds.has(p.id))

  return (
    <div className="overflow-x-auto h-full">
      <table className="w-full" style={{ minWidth: listTableMinWidth(colSpan) }}>
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr>
            {columns.map((column) => {
              if (column.id === 'select') {
                return (
                  <th key={column.id} className="pl-4 pr-2 py-2 w-8">
                    <SelectionCheckbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      disabled={selectable.length === 0}
                      title={allSelected ? t('list.clearSelection') : t('list.selectLoaded')}
                      onChange={(checked) => {
                        if (checked) onSelectLoaded()
                        else onClearSelection()
                      }}
                    />
                  </th>
                )
              }

              const label = column.customLabel || (column.headerKey ? t(`list.${column.headerKey}`) : '')
              const stickyClass = column.sticky === 'right'
                ? ' text-right sticky right-0 bg-gray-50 z-10'
                : ' text-left'
              return (
                <th
                  key={column.id}
                  className={`px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider${stickyClass}`}
                >
                  {label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {groups.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-gray-500">
                {t('list.empty')}
              </td>
            </tr>
          ) : (
            groups.map((group) => (
              <StageGroupRows
                key={group.stage.id}
                group={group}
                colSpan={colSpan}
                columnConfig={columnConfig}
                canSelect={canSelect}
                selectedPositionIds={selectedPositionIds}
                onToggleSelect={onToggleSelect}
                onSelectLoadedInStage={onSelectLoadedInStage}
                onDeselectLoadedInStage={onDeselectLoadedInStage}
                onRowClick={onRowClick}
                onChatClick={onChatClick}
                onLoadMoreStage={onLoadMoreStage}
                onRetryStage={onRetryStage}
                userById={userById}
                customFieldValuesMap={customFieldValuesMap}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

interface StageGroupRowsProps {
  group: FunnelListGroup
  colSpan: number
  columnConfig: FunnelListColumnConfig
  canSelect: boolean
  selectedPositionIds: Set<string>
  onToggleSelect: FunnelListTableProps['onToggleSelect']
  onSelectLoadedInStage: FunnelListTableProps['onSelectLoadedInStage']
  onDeselectLoadedInStage: FunnelListTableProps['onDeselectLoadedInStage']
  onRowClick: FunnelListTableProps['onRowClick']
  onChatClick?: FunnelListTableProps['onChatClick']
  onLoadMoreStage: FunnelListTableProps['onLoadMoreStage']
  onRetryStage: FunnelListTableProps['onRetryStage']
  userById: Map<string, AssignableUser>
  customFieldValuesMap: Record<number, CustomFieldValueEntry[]>
}

function StageGroupRows({
  group,
  colSpan,
  columnConfig,
  canSelect,
  selectedPositionIds,
  onToggleSelect,
  onSelectLoadedInStage,
  onDeselectLoadedInStage,
  onRowClick,
  onChatClick,
  onLoadMoreStage,
  onRetryStage,
  userById,
  customFieldValuesMap,
}: StageGroupRowsProps) {
  const { t } = useTranslation('funnel')
  const { stage, positions, loadedCount, totalCount, hasMore, loading, error } = group
  const stageSelectable = selectablePositions(positions)
  const stageAllSelected = stageSelectable.length > 0
    && stageSelectable.every(p => selectedPositionIds.has(p.id))
  const stageSomeSelected = stageSelectable.some(p => selectedPositionIds.has(p.id))
  const stageSelectTitle = stageAllSelected
    ? t('list.deselectLoadedStage')
    : (hasMore && totalCount != null)
      ? t('list.selectLoadedStagePartial', { loaded: loadedCount, total: totalCount })
      : t('list.selectLoadedStage')
  const countLabel = totalCount != null
    ? t('list.stageLoadedOfTotal', { loaded: loadedCount, total: totalCount })
    : t('list.stageLoadedCount', { loaded: loadedCount })

  return (
    <>
      <tr className="bg-gray-50 border-t border-gray-200">
        <td colSpan={colSpan} className="px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 min-w-0">
              {canSelect && (
                <SelectionCheckbox
                  checked={stageAllSelected}
                  indeterminate={stageSomeSelected && !stageAllSelected}
                  disabled={stageSelectable.length === 0}
                  title={stageSelectTitle}
                  onChange={(checked) => {
                    if (checked) onSelectLoadedInStage(stage.id)
                    else onDeselectLoadedInStage(stage.id)
                  }}
                />
              )}
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
              <span className="text-sm font-semibold text-gray-800 truncate">{stage.name}</span>
            </span>
            <span className="text-xs text-gray-500 whitespace-nowrap">{countLabel}</span>
          </div>
        </td>
      </tr>

      {positions.map((position) => (
        <OpportunityRow
          key={position.id}
          position={position}
          stage={stage}
          columnConfig={columnConfig}
          canSelect={canSelect}
          selected={selectedPositionIds.has(position.id)}
          onToggleSelect={onToggleSelect}
          onRowClick={onRowClick}
          onChatClick={onChatClick}
          userById={userById}
          customFieldValuesMap={customFieldValuesMap}
        />
      ))}

      {error === 'initial' && (
        <tr>
          <td colSpan={colSpan} className="px-4 py-4 text-center">
            <p className="text-sm text-red-600">{t('list.stageError')}</p>
            <button
              type="button"
              onClick={() => onRetryStage(stage.id)}
              disabled={loading}
              className="mt-2 text-sm font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
            >
              {loading ? t('list.loadMoreLoading') : t('list.retry')}
            </button>
          </td>
        </tr>
      )}

      {error !== 'initial' && positions.length === 0 && loading && (
        <tr>
          <td colSpan={colSpan} className="px-4 py-4 text-center text-sm text-gray-500">
            {t('list.stageLoading')}
          </td>
        </tr>
      )}

      {error !== 'initial' && positions.length === 0 && !loading && (
        <tr>
          <td colSpan={colSpan} className="px-4 py-4 text-center text-sm text-gray-500">
            {t('list.stageEmpty')}
          </td>
        </tr>
      )}

      {error === 'loadMore' && (
        <tr>
          <td colSpan={colSpan} className="px-4 py-3 text-center">
            <p className="text-sm text-red-600">{t('list.stageLoadMoreError')}</p>
            <button
              type="button"
              onClick={() => onLoadMoreStage(stage.id)}
              disabled={loading}
              className="mt-2 text-sm font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
            >
              {loading ? t('list.loadMoreLoading') : t('list.retry')}
            </button>
          </td>
        </tr>
      )}

      {error !== 'loadMore' && hasMore && (
        <tr>
          <td colSpan={colSpan} className="px-4 py-3 text-center">
            <button
              type="button"
              onClick={() => onLoadMoreStage(stage.id)}
              disabled={loading}
              className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('list.loadMoreLoading') : t('list.loadMoreStage')}
            </button>
          </td>
        </tr>
      )}
    </>
  )
}

interface OpportunityRowProps {
  position: OpportunityFunnelPosition
  stage: FunnelStage
  columnConfig: FunnelListColumnConfig
  canSelect: boolean
  selected: boolean
  onToggleSelect: FunnelListTableProps['onToggleSelect']
  onRowClick: FunnelListTableProps['onRowClick']
  onChatClick?: FunnelListTableProps['onChatClick']
  userById: Map<string, AssignableUser>
  customFieldValuesMap: Record<number, CustomFieldValueEntry[]>
}

function OpportunityRow({
  position,
  stage,
  columnConfig,
  canSelect,
  selected,
  onToggleSelect,
  onRowClick,
  onChatClick,
  userById,
  customFieldValuesMap,
}: OpportunityRowProps) {
  const { t } = useTranslation('funnel')

  return (
    <tr
      className={`group cursor-pointer hover:bg-gray-50 ${selected ? 'bg-blue-50' : ''}`}
      onClick={() => onRowClick(position.opportunity_id)}
    >
      {columnConfig.columns.map((column) => (
        <FunnelListBodyCell
          key={column.id}
          column={column}
          t={t}
          context={{
            position,
            stage,
            canSelect,
            selected,
            onToggleSelect,
            onChatClick,
            userById,
            columnConfig,
            customFieldValuesMap,
          }}
        />
      ))}
    </tr>
  )
}
