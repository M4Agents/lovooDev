import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentAssignmentEntry } from '../../types/agent-report'
import { ReportEmptyState } from './ReportEmptyState'

interface AgentAssignmentTableProps {
  data: AgentAssignmentEntry[]
}

export const AgentAssignmentTable: React.FC<AgentAssignmentTableProps> = ({ data }) => {
  const { t } = useTranslation('reports')
  const [search, setSearch] = useState('')

  if (data.length === 0) {
    return <ReportEmptyState description={t('agentReport.assignmentTable.empty')} />
  }

  const filtered = data.filter((row) =>
    row.display_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('agentReport.assignmentTable.searchPlaceholder')}
          className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                {t('agentReport.assignmentTable.columnName')}
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                {t('agentReport.assignmentTable.columnSessions')}
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">
                {t('agentReport.assignmentTable.columnCompleted')}
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">
                {t('agentReport.assignmentTable.columnCompletionRate')}
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden sm:table-cell">
                {t('agentReport.assignmentTable.columnAvgMessages')}
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden md:table-cell">
                {t('agentReport.assignmentTable.columnCredits')}
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                {t('agentReport.assignmentTable.columnHandoffs')}
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 hidden sm:table-cell">
                {t('agentReport.assignmentTable.columnHandoffRate')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.assignment_id}
                className="border-b border-gray-50 hover:bg-gray-50 last:border-0"
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-800">{row.display_name}</span>
                  {!row.is_active && (
                    <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      {t('agentReport.assignmentTable.inactive')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-700 font-semibold">
                  {row.session_count}
                </td>
                <td className="px-4 py-3 text-right text-emerald-600 font-semibold hidden md:table-cell">
                  {row.completed_sessions}
                </td>
                <td className="px-4 py-3 text-right hidden md:table-cell">
                  <span className={Number(row.completion_rate) > 0 ? 'text-emerald-600 font-medium' : 'text-gray-400'}>
                    {Number(row.completion_rate).toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-500 hidden sm:table-cell">
                  {Number(row.avg_messages).toFixed(1)}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">
                  {row.total_credits}
                </td>
                <td className="px-4 py-3 text-right text-amber-600">
                  {row.human_handoffs}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 hidden sm:table-cell">
                  {Number(row.human_handoff_rate).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
