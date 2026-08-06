import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import type { AgentDailyEntry } from '../../types/agent-report'
import { ReportEmptyState } from './ReportEmptyState'

interface AgentDailyChartProps {
  data: AgentDailyEntry[]
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export const AgentDailyChart: React.FC<AgentDailyChartProps> = ({ data }) => {
  const { t } = useTranslation('reports')

  if (data.length === 0) {
    return <ReportEmptyState description={t('agentReport.daily.empty')} />
  }

  const chartData = data.map((d) => ({
    ...d,
    dateLabel: formatDate(d.date),
  }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis
          dataKey="dateLabel"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          yAxisId="left"
          dataKey="sessions"
          name={t('agentReport.daily.sessions')}
          fill="#6366f1"
          radius={[3, 3, 0, 0]}
          maxBarSize={32}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="human_handoffs"
          name={t('agentReport.daily.handoffs')}
          stroke="#f59e0b"
          dot={false}
          strokeWidth={2}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
