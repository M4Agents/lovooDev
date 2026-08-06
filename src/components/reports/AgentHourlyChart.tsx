import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { AgentHourlyEntry } from '../../types/agent-report'
import { ReportEmptyState } from './ReportEmptyState'

interface AgentHourlyChartProps {
  data: AgentHourlyEntry[]
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}h`
}

export const AgentHourlyChart: React.FC<AgentHourlyChartProps> = ({ data }) => {
  const { t } = useTranslation('reports')

  if (data.length === 0) {
    return <ReportEmptyState description={t('agentReport.hourly.empty')} />
  }

  // Preenche todas as 24 horas para manter o eixo X consistente
  const fullDay = Array.from({ length: 24 }, (_, i) => {
    const found = data.find((d) => d.hour === i)
    return { hour: formatHour(i), session_count: found?.session_count ?? 0 }
  })

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={fullDay} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          interval={2}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          formatter={(value: number) => [value, t('agentReport.hourly.sessions')]}
          labelFormatter={(label) => `${t('agentReport.hourly.tooltipHour')}: ${label}`}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Bar dataKey="session_count" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}
