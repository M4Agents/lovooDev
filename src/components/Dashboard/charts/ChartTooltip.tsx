// =====================================================
// ChartTooltip — tooltip customizado para gráficos Recharts.
// Exibe um card com formatação consistente para
// os gráficos de tendência da dashboard.
// =====================================================

import React from 'react'

interface TooltipEntry {
  name:    string
  value:   number | string | null
  color:   string
  unit?:   string
}

interface ChartTooltipProps {
  active?:  boolean
  payload?: Array<{
    name:   string
    value:  number | null
    color:  string
    unit?:  string
  }>
  label?:   string
  formatter?: (entry: { name: string; value: number | null; color: string }) => TooltipEntry
}

export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const entries: TooltipEntry[] = payload.map((p) => {
    if (formatter) return formatter(p)
    return { name: p.name, value: p.value, color: p.color, unit: p.unit }
  })

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      {label && (
        <p className="text-gray-500 mb-1.5 font-medium">{label}</p>
      )}
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600">{entry.name}:</span>
          <span className="font-semibold text-gray-900">
            {entry.value != null ? `${entry.value}${entry.unit ? ` ${entry.unit}` : ''}` : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
