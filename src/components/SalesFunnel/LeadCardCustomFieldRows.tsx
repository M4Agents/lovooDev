// =====================================================
// COMPONENTE: LeadCardCustomFieldRows
// Renderiza as linhas de campos personalizados no LeadCard.
// Extraído para manter LeadCard.tsx dentro do limite de linhas.
// =====================================================

import type { CustomFieldValueEntry } from '../../types/sales-funnel'
import { formatCustomFieldValue, isCustomFieldKey, fromCustomFieldKey } from '../../utils/customFieldUtils'

interface LeadCardCustomFieldRowsProps {
  /** Lista ordenada de chaves visíveis (ex: ["cf_uuid1", "cf_uuid2"]). */
  visibleCustomKeys: string[]
  /** Mapa de valores indexado por lead_id. */
  customFieldValuesMap: Record<number, CustomFieldValueEntry[]>
  leadId: number
}

export const LeadCardCustomFieldRows: React.FC<LeadCardCustomFieldRowsProps> = ({
  visibleCustomKeys,
  customFieldValuesMap,
  leadId,
}) => {
  const leadValues = customFieldValuesMap[leadId] ?? []

  const rows = visibleCustomKeys
    .filter(isCustomFieldKey)
    .map((key) => {
      const fieldId = fromCustomFieldKey(key)
      const entry = leadValues.find(v => v.field_id === fieldId)
      if (!entry) return null

      const formatted = formatCustomFieldValue(entry.value, entry.field_type)
      if (!formatted) return null

      return { label: entry.field_label, value: formatted, key }
    })
    .filter((row): row is { label: string; value: string; key: string } => row !== null)

  if (rows.length === 0) return null

  return (
    <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
      {rows.map(({ label, value, key }) => (
        <div key={key} className="flex items-baseline gap-1 text-xs text-gray-600">
          <span className="font-medium text-gray-500 shrink-0">{label}:</span>
          <span className="truncate">{value}</span>
        </div>
      ))}
    </div>
  )
}
