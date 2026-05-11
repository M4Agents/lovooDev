// =====================================================
// LeadOriginChart — barras horizontais por canal de origem.
// Usa layout="horizontal" do Recharts com YAxis categórico.
// Ajuste obrigatório: horizontal (não pizza).
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
import type { LeadOriginItem } from '../../../types/dashboard'

interface Props {
  data:      LeadOriginItem[]
  dataKey?:  'lead_count' | 'opps_generated' | 'total_won_value'
  height?:   number
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
  '#f97316', '#a855f7',
]

const LABEL_MAP: Record<string, string> = {
  lead_count:      'Leads',
  opps_generated:  'Oportunidades',
  total_won_value: 'Receita (R$)',
}

function formatTick(value: string, maxLen = 18): string {
  return value.length > maxLen ? value.slice(0, maxLen) + '…' : value
}

function formatValue(value: number, key: string): string {
  if (key === 'total_won_value') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
  }
  return String(value)
}

export function LeadOriginChart({ data, dataKey = 'lead_count', height = 260 }: Props) {
  if (data.length === 0) return null

  const label = LABEL_MAP[dataKey] ?? dataKey

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="horizontal"
        data={data}
        margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="origin"
          width={130}
          tick={{ fontSize: 11, fill: '#374151' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => formatTick(v)}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,.04)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const item = payload[0]
            return (
              <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-3 text-xs">
                <p className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1 capitalize">
                  {item.payload?.origin}
                </p>
                <p className="text-zinc-500">
                  {label}: <span className="font-bold text-zinc-800 dark:text-zinc-100">
                    {formatValue(Number(item.value), dataKey)}
                  </span>
                </p>
              </div>
            )
          }}
        />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} barSize={18}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
