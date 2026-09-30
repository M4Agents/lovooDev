import { MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CycleStatusBadge } from './CycleStatusBadge'
import { formatCurrency, formatDaysInStage } from '../../types/sales-funnel'
import type { FunnelStage, OpportunityFunnelPosition } from '../../types/sales-funnel'

export interface FunnelListRow {
  position: OpportunityFunnelPosition
  stage: FunnelStage
}

interface AssignableUser {
  user_id: string
  display_name: string
}

interface FunnelListTableProps {
  rows: FunnelListRow[]
  canSelect: boolean
  selectedPositionIds: Set<string>
  onToggleSelect: (positionId: string, leadId: number, opportunityId: string, stageId: string) => void
  onSelectLoaded: () => void
  onClearSelection: () => void
  onRowClick: (opportunityId: string) => void
  onChatClick?: (leadId: number) => void
  userById: Map<string, AssignableUser>
  showCycleColumn: boolean
}

function resolveLead(position: OpportunityFunnelPosition) {
  return position.opportunity?.lead ?? position.lead
}

function resolveUserName(
  userId: string | undefined,
  userById: Map<string, AssignableUser>,
): string {
  if (!userId) return '—'
  return userById.get(userId)?.display_name || '—'
}

export function FunnelListTable({
  rows,
  canSelect,
  selectedPositionIds,
  onToggleSelect,
  onSelectLoaded,
  onClearSelection,
  onRowClick,
  onChatClick,
  userById,
  showCycleColumn,
}: FunnelListTableProps) {
  const { t } = useTranslation('funnel')
  const allSelected = rows.length > 0 && rows.every(r => selectedPositionIds.has(r.position.id))

  return (
    <div className="overflow-x-auto h-full">
      <table className="w-full min-w-[1100px]">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr>
            {canSelect && (
              <th className="pl-4 pr-2 py-2 w-8">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  checked={allSelected}
                  onChange={(e) => {
                    if (e.target.checked) onSelectLoaded()
                    else onClearSelection()
                  }}
                  title={allSelected ? t('list.clearSelection') : t('list.selectLoaded')}
                />
              </th>
            )}
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('list.opportunity')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('list.lead')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('list.stage')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('list.value')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('list.leadResponsible')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('list.opportunityOwner')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('list.tags')}
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {t('list.daysInStage')}
            </th>
            {showCycleColumn && (
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                {t('list.cycle')}
              </th>
            )}
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider sticky right-0 bg-gray-50 z-10">
              {t('list.actions')}
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-100">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={canSelect ? (showCycleColumn ? 11 : 10) : (showCycleColumn ? 10 : 9)}
                className="px-4 py-10 text-center text-sm text-gray-500"
              >
                {t('list.empty')}
              </td>
            </tr>
          ) : (
            rows.map(({ position, stage }) => {
              const opportunity = position.opportunity
              const lead = resolveLead(position)
              const leadId = position.lead_id || lead?.id || opportunity?.lead_id
              const selected = selectedPositionIds.has(position.id)
              const tags = lead?.tags ?? []

              return (
                <tr
                  key={position.id}
                  className={`group cursor-pointer hover:bg-gray-50 ${selected ? 'bg-blue-50' : ''}`}
                  onClick={() => onRowClick(position.opportunity_id)}
                >
                  {canSelect && (
                    <td className="pl-4 pr-2 py-2 w-8 align-middle" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        checked={selected}
                        disabled={!leadId}
                        onChange={() => {
                          if (!leadId) return
                          onToggleSelect(position.id, leadId, position.opportunity_id, position.stage_id)
                        }}
                      />
                    </td>
                  )}
                  <td className="px-4 py-2 text-sm text-gray-900">
                    <div className="font-medium truncate max-w-[220px]">
                      {opportunity?.title || '—'}
                    </div>
                    {opportunity?.opportunity_number != null && (
                      <div className="text-xs text-gray-400">#{opportunity.opportunity_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[180px]">
                    {lead?.name || '—'}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: `${stage.color}20`,
                        color: stage.color,
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                      {stage.name}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700 whitespace-nowrap">
                    {opportunity && opportunity.value > 0
                      ? formatCurrency(opportunity.value, opportunity.currency)
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-[160px]">
                    {resolveUserName(lead?.responsible_user_id, userById)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500 truncate max-w-[160px]">
                    {resolveUserName(opportunity?.owner_user_id, userById)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {tags.length === 0 ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        tags.slice(0, 3).map(tag => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs truncate max-w-[90px]"
                          >
                            {tag}
                          </span>
                        ))
                      )}
                      {tags.length > 3 && (
                        <span className="text-xs text-gray-400">+{tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500 whitespace-nowrap">
                    {formatDaysInStage(position.days_in_stage ?? 0)}
                  </td>
                  {showCycleColumn && (
                    <td className="px-4 py-2">
                      <CycleStatusBadge
                        state={position.contact_attempts_state}
                        attemptCount={position.total_contact_attempts}
                      />
                    </td>
                  )}
                  <td
                    className={`px-4 py-2 text-right sticky right-0 ${selected ? 'bg-blue-50 group-hover:bg-blue-100' : 'bg-white group-hover:bg-gray-50'}`}
                    onClick={e => e.stopPropagation()}
                  >
                    {onChatClick && leadId ? (
                      <button
                        type="button"
                        onClick={() => onChatClick(leadId)}
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                        title={t('list.chat')}
                      >
                        <MessageCircle className="w-4 h-4" />
                        {t('list.chat')}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
