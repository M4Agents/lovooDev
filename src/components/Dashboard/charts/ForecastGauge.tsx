import React from 'react'

interface ForecastGaugeProps {
  label:        string
  value:        number
  total:        number
  color:        string
  formatValue?: (v: number) => string
}

/**
 * Barra horizontal de proporção para o forecast.
 * Exibe valor / total como uma barra de progresso estilizada.
 */
export function ForecastGauge({
  label,
  value,
  total,
  color,
  formatValue = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }),
}: ForecastGaugeProps) {
  const pct = total > 0 ? Math.min((value / total) * 100, 100) : 0

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span className="font-semibold text-gray-800 dark:text-gray-100">
          {formatValue(value)}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}
