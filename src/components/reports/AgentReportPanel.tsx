import React from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, MessageSquare, Zap, RefreshCw, HandshakeIcon } from 'lucide-react'
import { KpiCard } from './KpiCard'
import { KpiSkeleton } from './MetricSkeleton'
import { ReportEmptyState } from './ReportEmptyState'
import { AgentHourlyChart } from './AgentHourlyChart'
import { AgentDailyChart } from './AgentDailyChart'
import { AgentAssignmentTable } from './AgentAssignmentTable'
import { useAgentReport } from '../../hooks/useAgentReport'
import type { ReportFilters } from '../../types/reports'

interface AgentReportPanelProps {
  companyId: string
  filters: ReportFilters
}

function LoadingKpis() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
    </div>
  )
}

export const AgentReportPanel: React.FC<AgentReportPanelProps> = ({ companyId, filters }) => {
  const { t } = useTranslation('reports')
  const { data, loading, error, refetch } = useAgentReport({
    companyId,
    dateFrom: filters.dateFrom,
    dateTo:   filters.dateTo,
  })

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center justify-between gap-3">
        <span>{t('agentReport.messages.loadError', { error })}</span>
        <button
          type="button"
          onClick={refetch}
          className="flex items-center gap-1 text-red-700 hover:text-red-900 font-medium"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('agentReport.messages.retry')}
        </button>
      </div>
    )
  }

  const kpis = data?.kpis

  return (
    <div className="space-y-6">
      {/* KPIs */}
      {loading ? (
        <LoadingKpis />
      ) : kpis ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            label={t('agentReport.kpi.totalSessions')}
            value={kpis.total_sessions}
            icon={Bot}
            iconColor="text-indigo-500"
          />
          <KpiCard
            label={t('agentReport.kpi.completionRate')}
            value={`${Number(kpis.completion_rate).toFixed(1)}%`}
            icon={Zap}
            highlight={kpis.completion_rate >= 70}
            iconColor="text-emerald-500"
          />
          <KpiCard
            label={t('agentReport.kpi.avgMessages')}
            value={Number(kpis.avg_messages_sent).toFixed(1)}
            icon={MessageSquare}
            iconColor="text-blue-500"
          />
          <KpiCard
            label={t('agentReport.kpi.totalFollowups')}
            value={kpis.total_followups_sent}
            icon={RefreshCw}
            iconColor="text-violet-500"
          />
          <KpiCard
            label={t('agentReport.kpi.humanHandoffs')}
            value={kpis.human_handoffs}
            icon={HandshakeIcon}
            alert={kpis.human_handoff_rate > 30}
            iconColor="text-amber-500"
            subLabel={`${Number(kpis.human_handoff_rate).toFixed(1)}% ${t('agentReport.kpi.ofSessions')}`}
          />
        </div>
      ) : (
        <ReportEmptyState description={t('agentReport.messages.noData')} />
      )}

      {/* Distribuição horária */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {t('agentReport.hourly.title')}
        </h3>
        {loading ? (
          <div className="h-[220px] bg-gray-50 animate-pulse rounded" />
        ) : (
          <AgentHourlyChart data={data?.hourly_distribution ?? []} />
        )}
      </div>

      {/* Tendência diária */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {t('agentReport.daily.title')}
        </h3>
        {loading ? (
          <div className="h-[240px] bg-gray-50 animate-pulse rounded" />
        ) : (
          <AgentDailyChart data={data?.daily_trend ?? []} />
        )}
      </div>

      {/* Breakdown por assignment */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-700">
            {t('agentReport.assignmentTable.title')}
          </h3>
        </div>
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 h-32 animate-pulse" />
        ) : (
          <AgentAssignmentTable data={data?.assignment_breakdown ?? []} />
        )}
      </div>
    </div>
  )
}
