import React from 'react'
import type { StageTimeMetric } from '../../types/reports'
import { ReportEmptyState } from './ReportEmptyState'

interface FunnelBarChartProps {
  data: StageTimeMetric[]
}

export const FunnelBarChart: React.FC<FunnelBarChartProps> = ({ data }) => {
  if (data.length === 0) return <ReportEmptyState />

  const maxCount = Math.max(...data.map((d) => Number(d.current_open_count)), 1)

  // Agrupa por funil
  const byFunnel = data.reduce<Record<string, StageTimeMetric[]>>((acc, m) => {
    const key = m.funnel_name
    if (!acc[key]) acc[key] = []
    acc[key].push(m)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {Object.entries(byFunnel).map(([funnelName, stages]) => (
        <div key={funnelName}>
          {Object.keys(byFunnel).length > 1 && (
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {funnelName}
            </p>
          )}
          <div className="space-y-2">
            {stages.map((stage) => {
              const count = Number(stage.current_open_count)
              const pct = maxCount > 0 ? (count / maxCount) * 100 : 0
              const color = stage.stage_color || '#6366f1'
              return (
                <div key={stage.stage_id} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 w-32 truncate shrink-0">
                    {stage.stage_name}
                  </span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: color,
                          opacity: 0.85,
                          minWidth: count > 0 ? '4px' : '0',
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 w-6 text-right">
                      {count}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
