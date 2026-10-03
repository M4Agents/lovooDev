import { FUNNEL_CONSTANTS } from '../types/sales-funnel'
import type { CustomFieldDefinition } from '../types/sales-funnel'
import { fromCustomFieldKey, isCustomFieldKey } from './customFieldUtils'

/** Colunas da lista que o default do card não inclui, mas a tabela já mostrava. */
const LIST_DEFAULT_KEEP = ['deal_value', 'responsible', 'opportunity_number'] as const

export type FunnelListColumnId =
  | 'select'
  | 'opportunity'
  | 'lead'
  | 'stage'
  | 'deal_value'
  | 'responsible'
  | 'owner'
  | 'email'
  | 'phone'
  | 'company'
  | 'origin'
  | 'status'
  | 'created_at'
  | 'last_contact_at'
  | 'probability'
  | 'tags'
  | 'days_in_stage'
  | 'cycle'
  | 'actions'
  | string

export interface FunnelListColumn {
  id: FunnelListColumnId
  headerKey?: string
  customLabel?: string
  sticky?: 'right'
}

export interface FunnelListColumnConfig {
  columns: FunnelListColumn[]
  showOpportunityNumber: boolean
  showLeadPhoto: boolean
}

function isDefaultVisibleFields(visibleFields: string[]): boolean {
  const defaults = FUNNEL_CONSTANTS.DEFAULT_VISIBLE_FIELDS
  if (visibleFields.length !== defaults.length) return false
  const selected = new Set(visibleFields)
  return defaults.every(field => selected.has(field))
}

export function resolveListVisibleFieldSet(visibleFields: string[]): Set<string> {
  const fields = new Set(visibleFields)
  if (isDefaultVisibleFields(visibleFields)) {
    for (const key of LIST_DEFAULT_KEEP) fields.add(key)
  }
  return fields
}

export function buildFunnelListColumns(options: {
  canSelect: boolean
  showCycleColumn: boolean
  visibleFields: string[]
  customFields?: CustomFieldDefinition[]
}): FunnelListColumnConfig {
  const fields = resolveListVisibleFieldSet(options.visibleFields)
  const columns: FunnelListColumn[] = []

  if (options.canSelect) columns.push({ id: 'select' })
  columns.push({ id: 'opportunity', headerKey: 'opportunity' })
  if (fields.has('name')) columns.push({ id: 'lead', headerKey: 'lead' })
  columns.push({ id: 'stage', headerKey: 'stage' })
  if (fields.has('deal_value')) columns.push({ id: 'deal_value', headerKey: 'value' })
  if (fields.has('responsible')) columns.push({ id: 'responsible', headerKey: 'leadResponsible' })
  columns.push({ id: 'owner', headerKey: 'opportunityOwner' })
  if (fields.has('email')) columns.push({ id: 'email', headerKey: 'email' })
  if (fields.has('phone')) columns.push({ id: 'phone', headerKey: 'phone' })
  if (fields.has('company')) columns.push({ id: 'company', headerKey: 'company' })
  if (fields.has('origin')) columns.push({ id: 'origin', headerKey: 'origin' })
  if (fields.has('status')) columns.push({ id: 'status', headerKey: 'status' })
  if (fields.has('created_at')) columns.push({ id: 'created_at', headerKey: 'createdAt' })
  if (fields.has('last_contact_at')) columns.push({ id: 'last_contact_at', headerKey: 'lastContact' })
  if (fields.has('probability')) columns.push({ id: 'probability', headerKey: 'probability' })
  if (fields.has('tags')) columns.push({ id: 'tags', headerKey: 'tags' })
  columns.push({ id: 'days_in_stage', headerKey: 'daysInStage' })
  if (options.showCycleColumn) columns.push({ id: 'cycle', headerKey: 'cycle' })

  const customById = new Map((options.customFields ?? []).map(field => [field.id, field]))
  for (const key of options.visibleFields) {
    if (!isCustomFieldKey(key)) continue
    const definition = customById.get(fromCustomFieldKey(key))
    columns.push({
      id: key,
      customLabel: definition?.field_label || undefined,
    })
  }

  columns.push({ id: 'actions', headerKey: 'actions', sticky: 'right' })

  return {
    columns,
    showOpportunityNumber: fields.has('opportunity_number'),
    showLeadPhoto: fields.has('photo') && fields.has('name'),
  }
}

export function listTableMinWidth(columnCount: number): number {
  return Math.max(1100, columnCount * 130)
}
