// =====================================================
// BaseComboChart — gráfico combinado barra + linha.
// Wrapper sobre ComposedChart do Recharts.
// Usa dois eixos Y: esquerdo para barras, direito para a linha.
// =====================================================

import React from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { ChartTooltip } from './ChartTooltip'

export interface ComboBarKey {
  key:   string
  name:  string
  color: string
  unit?: string
}

export interface ComboLineKey {
  key:   string
  name:  string
  color: string
  unit?: string
}

interface BaseComboChartProps {
  data:        Record<string, unknown>[]
  bar:         ComboBarKey
  line:        ComboLineKey
  xKey:        string
  height?:     number
  xFormatter?: (value: string) => string
  showLegend?: boolean
}

const DEFAULT_HEIGHT = 200

export function BaseComboChart({
  data,
  bar,
  line,
  xKey,
  height = DEFAULT_HEIGHT,
  xFormatter,
  showLegend = true,
}: BaseComboChartProps) {
  if (!data || data.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 20, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={xFormatter}
        />
        {/* Eixo Y esquerdo: barras (contagem) */}
        <YAxis
          yAxisId="left"
          orientation="left"
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        {/* Eixo Y direito: linha (tempo em minutos) */}
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}m`}
        />
        <Tooltip
          content={(props) => (
            <ChartTooltip
              active={props.active}
              payload={props.payload?.map((p) => ({
                name:  p.name  as string,
                value: p.value as number | null,
                color: p.color as string,
                unit:  p.dataKey === line.key ? (line.unit ?? 'min') : (bar.unit ?? ''),
              }))}
              label={xFormatter ? xFormatter(String(props.label)) : String(props.label)}
            />
          )}
          cursor={{ fill: 'rgba(99,102,241,0.05)' }}
        />
        {showLegend && (
          <Legend
            iconSize={8}
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: '#6b7280' }}
          />
        )}
        <Bar
          yAxisId="left"
          dataKey={bar.key}
          name={bar.name}
          fill={bar.color}
          radius={[3, 3, 0, 0]}
          maxBarSize={40}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey={line.key}
          name={line.name}
          stroke={line.color}
          strokeWidth={2}
          dot={{ r: 3, fill: line.color, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
