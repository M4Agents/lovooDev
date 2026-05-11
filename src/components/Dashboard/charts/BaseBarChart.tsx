// =====================================================
// BaseBarChart — gráfico de barras reutilizável.
// Wrapper sobre BarChart do Recharts com defaults visuais
// da dashboard (cores, grid, eixos, tooltip).
// =====================================================

import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { ChartTooltip } from './ChartTooltip'

export interface BarDataKey {
  key:   string
  name:  string
  color: string
  unit?: string
}

interface BaseBarChartProps {
  data:      Record<string, unknown>[]
  bars:      BarDataKey[]
  xKey:      string
  height?:   number
  /** Formata o label do eixo X */
  xFormatter?: (value: string) => string
  /** Formata o label do eixo Y */
  yFormatter?: (value: number) => string
  /** Destaca a barra mais alta com tonalidade mais forte */
  highlightMax?: boolean
}

const DEFAULT_HEIGHT = 200

export function BaseBarChart({
  data,
  bars,
  xKey,
  height = DEFAULT_HEIGHT,
  xFormatter,
  yFormatter,
  highlightMax = false,
}: BaseBarChartProps) {
  if (!data || data.length === 0) return null

  // Calcula o valor máximo para destaque opcional
  const maxVal = highlightMax && bars.length === 1
    ? Math.max(...data.map((d) => Number(d[bars[0].key] ?? 0)))
    : null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={xFormatter}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={yFormatter}
          allowDecimals={false}
        />
        <Tooltip
          content={(props) => (
            <ChartTooltip
              active={props.active}
              payload={props.payload?.map((p) => ({
                name:  p.name  as string,
                value: p.value as number | null,
                color: p.color as string,
                unit:  bars.find((b) => b.key === p.dataKey)?.unit,
              }))}
              label={xFormatter ? xFormatter(String(props.label)) : String(props.label)}
            />
          )}
          cursor={{ fill: 'rgba(99,102,241,0.05)' }}
        />
        {bars.map((bar) => (
          <Bar key={bar.key} dataKey={bar.key} name={bar.name} fill={bar.color} radius={[3, 3, 0, 0]}>
            {highlightMax && maxVal != null
              ? data.map((d, i) => (
                  <Cell
                    key={i}
                    fill={Number(d[bar.key] ?? 0) === maxVal ? bar.color : `${bar.color}88`}
                  />
                ))
              : null}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
