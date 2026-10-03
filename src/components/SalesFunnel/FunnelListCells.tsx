import { MessageCircle } from 'lucide-react'
import type { TFunction } from 'i18next'
import { Avatar } from '../Avatar'
import { CycleStatusBadge } from './CycleStatusBadge'
import { formatCurrency, formatDaysInStage } from '../../types/sales-funnel'
import type { CustomFieldValueEntry, FunnelStage, OpportunityFunnelPosition } from '../../types/sales-funnel'
import { formatCustomFieldValue, fromCustomFieldKey, isCustomFieldKey } from '../../utils/customFieldUtils'
import { resolvePhotoUrl } from '../../utils/imageUtils'
import type { FunnelListColumn, FunnelListColumnConfig } from '../../utils/funnelListVisibleColumns'

interface AssignableUser {
  user_id: string
  display_name: string
}

export interface FunnelListRowContext {
  position: OpportunityFunnelPosition
  stage: FunnelStage
  canSelect: boolean
  selected: boolean
  onToggleSelect: (positionId: string, leadId: number, opportunityId: string, stageId: string) => void
  onChatClick?: (leadId: number) => void
  userById: Map<string, AssignableUser>
  columnConfig: FunnelListColumnConfig
  customFieldValuesMap: Record<number, CustomFieldValueEntry[]>
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

function formatListDate(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR')
}

function formatListDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatOrigin(origin: string | undefined): string {
  if (!origin) return '—'
  if (origin === 'webhook_ultra_simples') return 'Webhook'
  if (origin === 'landing_page') return 'Landing Page'
  if (origin === 'whatsapp') return 'WhatsApp'
  if (origin === 'import') return 'Importação'
  return origin
}

function cellClass(column: FunnelListColumn, selected: boolean): string {
  if (column.id === 'select') return 'pl-4 pr-2 py-2 w-8 align-middle'
  if (column.sticky === 'right') {
    return `px-4 py-2 text-right sticky right-0 ${
      selected ? 'bg-blue-50 group-hover:bg-blue-100' : 'bg-white group-hover:bg-gray-50'
    }`
  }
  return 'px-4 py-2 text-sm text-gray-700'
}

export function FunnelListBodyCell({
  column,
  context,
  t,
}: {
  column: FunnelListColumn
  context: FunnelListRowContext
  t: TFunction<'funnel'>
}) {
  const {
    position,
    stage,
    canSelect,
    selected,
    onToggleSelect,
    onChatClick,
    userById,
    columnConfig,
    customFieldValuesMap,
  } = context
  const opportunity = position.opportunity
  const lead = resolveLead(position)
  const leadId = position.lead_id || lead?.id || opportunity?.lead_id
  const overPlan = Boolean(lead?.is_over_plan)

  if (column.id === 'select') {
    return (
      <td className={cellClass(column, selected)} onClick={e => e.stopPropagation()}>
        {canSelect && (
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
        )}
      </td>
    )
  }

  if (column.id === 'opportunity') {
    return (
      <td className={`${cellClass(column, selected)} text-gray-900`}>
        <div className="font-medium truncate max-w-[220px]">
          {opportunity?.title || '—'}
        </div>
        {columnConfig.showOpportunityNumber && opportunity?.opportunity_number != null && (
          <div className="text-xs text-gray-400">#{opportunity.opportunity_number}</div>
        )}
      </td>
    )
  }

  if (column.id === 'lead') {
    return (
      <td className={cellClass(column, selected)}>
        <div className="flex items-center gap-2 min-w-0 max-w-[220px]">
          {columnConfig.showLeadPhoto && (
            <Avatar
              src={resolvePhotoUrl(lead?.profile_picture_url)}
              alt={lead?.name || ''}
              size="xs"
              className="shrink-0"
            />
          )}
          <div className="min-w-0">
            <div className="truncate">{lead?.name || '—'}</div>
            {overPlan && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600">
                {t('list.restricted')}
              </span>
            )}
          </div>
        </div>
      </td>
    )
  }

  if (column.id === 'stage') {
    return (
      <td className={cellClass(column, selected)}>
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium"
          style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
          {stage.name}
        </span>
      </td>
    )
  }

  if (column.id === 'deal_value') {
    return (
      <td className={`${cellClass(column, selected)} whitespace-nowrap`}>
        {opportunity && opportunity.value > 0
          ? formatCurrency(opportunity.value, opportunity.currency)
          : '—'}
      </td>
    )
  }

  if (column.id === 'responsible') {
    return (
      <td className={`${cellClass(column, selected)} truncate max-w-[160px]`}>
        {resolveUserName(lead?.responsible_user_id, userById)}
      </td>
    )
  }

  if (column.id === 'owner') {
    return (
      <td className={`${cellClass(column, selected)} text-gray-500 truncate max-w-[160px]`}>
        {resolveUserName(opportunity?.owner_user_id, userById)}
      </td>
    )
  }

  if (column.id === 'email') {
    return (
      <td className={`${cellClass(column, selected)} truncate max-w-[200px]`}>
        {overPlan ? t('list.restricted') : (lead?.email || '—')}
      </td>
    )
  }

  if (column.id === 'phone') {
    return (
      <td className={`${cellClass(column, selected)} whitespace-nowrap`}>
        {overPlan ? t('list.restrictedPhone') : (lead?.phone || '—')}
      </td>
    )
  }

  if (column.id === 'company') {
    return (
      <td className={`${cellClass(column, selected)} truncate max-w-[180px]`}>
        {lead?.company_name || '—'}
      </td>
    )
  }

  if (column.id === 'origin') {
    return (
      <td className={cellClass(column, selected)}>
        {formatOrigin(lead?.origin)}
      </td>
    )
  }

  if (column.id === 'status') {
    return (
      <td className={`${cellClass(column, selected)} truncate max-w-[140px]`}>
        {lead?.status || '—'}
      </td>
    )
  }

  if (column.id === 'created_at') {
    return (
      <td className={`${cellClass(column, selected)} whitespace-nowrap text-gray-500`}>
        {formatListDate(lead?.created_at)}
      </td>
    )
  }

  if (column.id === 'last_contact_at') {
    return (
      <td className={`${cellClass(column, selected)} whitespace-nowrap text-gray-500`}>
        {formatListDateTime(lead?.last_contact_at)}
      </td>
    )
  }

  if (column.id === 'probability') {
    return (
      <td className={`${cellClass(column, selected)} whitespace-nowrap`}>
        {opportunity?.probability != null ? `${opportunity.probability}%` : '—'}
      </td>
    )
  }

  if (column.id === 'tags') {
    const tags = lead?.tags ?? []
    return (
      <td className={cellClass(column, selected)}>
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
    )
  }

  if (column.id === 'days_in_stage') {
    return (
      <td className={`${cellClass(column, selected)} whitespace-nowrap text-gray-500`}>
        {formatDaysInStage(position.days_in_stage ?? 0)}
      </td>
    )
  }

  if (column.id === 'cycle') {
    return (
      <td className={cellClass(column, selected)}>
        <CycleStatusBadge
          state={position.contact_attempts_state}
          attemptCount={position.total_contact_attempts}
        />
      </td>
    )
  }

  if (column.id === 'actions') {
    return (
      <td className={cellClass(column, selected)} onClick={e => e.stopPropagation()}>
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
    )
  }

  if (isCustomFieldKey(column.id) && leadId) {
    const fieldId = fromCustomFieldKey(column.id)
    const entry = (customFieldValuesMap[leadId] ?? []).find(item => item.field_id === fieldId)
    const formatted = entry ? formatCustomFieldValue(entry.value, entry.field_type) : ''
    return (
      <td className={`${cellClass(column, selected)} truncate max-w-[180px]`}>
        {formatted || '—'}
      </td>
    )
  }

  return (
    <td className={cellClass(column, selected)}>—</td>
  )
}
