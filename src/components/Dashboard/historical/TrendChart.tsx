// =====================================================
// TrendChart — Gráfico de tendência histórica expandido.
//
// Usado na trendline de SLA (colapsável no rodapé do SlaAlertsPanel).
// Recharts AreaChart / LineChart — compacto, sem overengineering.
// =====================================================

import React from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { SnapshotTrendPoint } from '../../../types/dashboard'

export interface TrendChartProps {
  /** Série de pontos do snapshot-trends */
  series:          SnapshotTrendPoint[]
  /** Qual coluna do TrendPoint usar como valor Y */
  metricKey:       string
  /** Se diminuir é bom (ex: SLA breached) */
  lowerIsBetter?:  boolean
  /** Rótulo da métrica */
  label?:          string
  height?:         number
}

function fmtDate(s: string): string {
  const [, m, d] = s.split('-')
  return `${d}/${m}`
}

// Tooltip personalizado e compacto
function CustomTooltip({ active, payload, label: date, metricLabel }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded px-2 py-1 shadow-sm text-[10px]">
      <p className="text-gray-500">{fmtDate(date)}</p>
      <p className="font-semibold text-gray-800">
        {metricLabel}: <span>{Number(payload[0].value).toLocaleString('pt-BR')}</span>
      </p>
    </div>
  )
}

export const TrendChart: React.FC<TrendChartProps> = ({
  series,
  metricKey,
  lowerIsBetter = false,
  label = 'Valor',
  height = 80,
}) => {
  if (!series || series.length < 2) return null

  const data = series.map(p => ({
    date:  p.period_start,
    value: Number(p[metricKey] ?? 0),
  }))

  // Cor: lowerIsBetter → menos = verde; higherIsBetter → mais = verde
  const first = data[0].value
  const last  = data[data.length - 1].value
  const isGood = lowerIsBetter ? last <= first : last >= first
  const color = isGood ? '#10b981' : '#f43f5e'

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`tg-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.15} />
            <stop offset="95%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="date"
          tickFormatter={fmtDate}
          tick={{ fontSize: 9, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />

        <Tooltip
          content={<CustomTooltip metricLabel={label} />}
          cursor={{ stroke: '#e5e7eb', strokeWidth: 1 }}
        />

        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#tg-${metricKey})`}
          dot={false}
          activeDot={{ r: 3, fill: color }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
