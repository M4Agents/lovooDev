import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, X } from 'lucide-react'
import {
  listLogs,
  getSummary,
  type AgentExecutionLog,
  type LogsFilters,
  type LogsSummaryResponse,
} from '../../services/agentLogsApi'
import { AGENT_FUNCTIONAL_USES } from '../../types/lovoo-agents'

// ── Constantes ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

const ALL_STATUSES = [
  'success',
  'fallback_no_agent',
  'fallback_openai_unavailable',
  'fallback_openai_failed',
  'error_missing_context',
  'error_openai',
  'error_db',
] as const

// ── Helpers de formatação ─────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatCost(value: number | null): string {
  if (value === null || value === 0) return '—'
  return `$${value.toFixed(6)}`
}

function formatTokens(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR')
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function statusBadgeClass(status: string): string {
  if (status === 'success')          return 'bg-green-100 text-green-800'
  if (status.startsWith('fallback')) return 'bg-yellow-100 text-yellow-800'
  if (status.startsWith('error'))    return 'bg-red-100 text-red-800'
  return 'bg-slate-100 text-slate-700'
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'red' | 'yellow'
}) {
  const valueClass =
    accent === 'red'    ? 'text-red-600' :
    accent === 'yellow' ? 'text-yellow-600' :
    'text-slate-900'

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${valueClass}`}>{value}</span>
    </div>
  )
}

function DetailModal({
  log,
  onClose,
}: {
  log: AgentExecutionLog
  onClose: () => void
}) {
  const { t } = useTranslation('agents')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">{t('logs.detail.title')}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <DetailRow label={t('logs.detail.agentId')}       value={log.agent_id         ?? '—'} />
          <DetailRow label={t('logs.detail.knowledgeMode')} value={log.knowledge_mode    ?? '—'} />
          <DetailRow label={t('logs.detail.inputTokens')}   value={formatTokens(log.input_tokens)} />
          <DetailRow label={t('logs.detail.outputTokens')}  value={formatTokens(log.output_tokens)} />
          <DetailRow label={t('logs.detail.pricingVersion')} value={log.pricing_version  ?? '—'} />
          <DetailRow
            label={t('logs.detail.isFallback')}
            value={log.is_fallback ? t('logs.detail.yes') : t('logs.detail.no')}
          />
          <DetailRow label={t('logs.detail.errorCode')}     value={log.error_code        ?? '—'} />
          <DetailRow label={t('logs.detail.channel')}       value={log.channel           ?? '—'} />
          <DetailRow label={t('logs.detail.userId')}        value={log.user_id           ?? '—'} />
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
          >
            {t('logs.detail.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-sm text-slate-500 w-40 shrink-0">{label}</span>
      <span className="text-sm text-slate-900 font-mono break-all">{value}</span>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AgentLogsPanel() {
  const { t } = useTranslation('agents')

  // Filtros compartilhados — idênticos para list e summary
  const [filters, setFilters] = useState<LogsFilters>({})
  const [activeFilters, setActiveFilters] = useState<LogsFilters>({})

  // Paginação (offset/limit — MVP; futuro: cursor-based)
  const [page, setPage] = useState(0)

  // Dados
  const [logs,        setLogs]        = useState<AgentExecutionLog[]>([])
  const [total,       setTotal]       = useState(0)
  const [summary,     setSummary]     = useState<LogsSummaryResponse | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingSum,  setLoadingSum]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  // Modal
  const [selectedLog, setSelectedLog] = useState<AgentExecutionLog | null>(null)

  // ── Carregamento ────────────────────────────────────────────────────────────

  const loadData = useCallback(async (f: LogsFilters, p: number) => {
    setLoadingList(true)
    setLoadingSum(true)
    setError(null)

    // Promise.all garante que list e summary usam exatamente os mesmos filtros
    const [listResult, summaryResult] = await Promise.allSettled([
      listLogs({ ...f, page: p, pageSize: PAGE_SIZE }),
      getSummary(f),
    ])

    if (listResult.status === 'fulfilled') {
      setLogs(listResult.value.data)
      setTotal(listResult.value.total)
    } else {
      setError(listResult.reason?.message ?? t('logs.errors.load'))
    }

    if (summaryResult.status === 'fulfilled') {
      setSummary(summaryResult.value)
    }

    setLoadingList(false)
    setLoadingSum(false)
  }, [t])

  useEffect(() => {
    void loadData(activeFilters, page)
  }, [activeFilters, page, loadData])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleApplyFilters() {
    setPage(0)
    setActiveFilters({ ...filters })
  }

  function handleClearFilters() {
    setFilters({})
    setPage(0)
    setActiveFilters({})
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const fromRow    = total === 0 ? 0 : page * PAGE_SIZE + 1
  const toRow      = Math.min((page + 1) * PAGE_SIZE, total)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Banner de disclaimer global (fixo, não fechável) ── */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800">{t('logs.disclaimer')}</p>
      </div>

      {/* ── Filtros ── */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-slate-700">{t('logs.filters.title')}</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Período: de */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">{t('logs.filters.from')}</label>
            <input
              type="date"
              value={filters.from ? filters.from.slice(0, 10) : ''}
              onChange={e => setFilters(f => ({
                ...f,
                from: e.target.value ? `${e.target.value}T00:00:00Z` : undefined,
              }))}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Período: até */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">{t('logs.filters.to')}</label>
            <input
              type="date"
              value={filters.to ? filters.to.slice(0, 10) : ''}
              onChange={e => setFilters(f => ({
                ...f,
                to: e.target.value ? `${e.target.value}T23:59:59Z` : undefined,
              }))}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">{t('logs.filters.status')}</label>
            <select
              value={filters.status ?? ''}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value || undefined }))}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('logs.filters.all')}</option>
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Uso funcional */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">{t('logs.filters.useId')}</label>
            <select
              value={filters.use_id ?? ''}
              onChange={e => setFilters(f => ({ ...f, use_id: e.target.value || undefined }))}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t('logs.filters.all')}</option>
              {AGENT_FUNCTIONAL_USES.map(u => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
          </div>

          {/* Empresa consumidora (MVP: input manual de UUID) */}
          {/* Futuro: substituir por selector amigável com nome/logo da empresa */}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-xs text-slate-500">{t('logs.filters.consumerCompany')}</label>
            <input
              type="text"
              placeholder={t('logs.filters.consumerCompanyPlaceholder')}
              value={filters.consumer_company_id ?? ''}
              onChange={e => setFilters(f => ({
                ...f,
                consumer_company_id: e.target.value.trim() || undefined,
              }))}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleApplyFilters}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            {t('logs.filters.apply')}
          </button>
          <button
            onClick={handleClearFilters}
            className="px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
          >
            {t('logs.filters.clear')}
          </button>
        </div>
      </div>

      {/* ── Cards de resumo ── */}
      {loadingSum ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-slate-100 rounded-lg h-20 animate-pulse" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard
            label={t('logs.cards.totalExecutions')}
            value={summary.total_executions.toLocaleString('pt-BR')}
          />
          <SummaryCard
            label={t('logs.cards.totalTokens')}
            value={formatTokens(summary.total_tokens)}
          />
          <SummaryCard
            label={t('logs.cards.estimatedCost')}
            value={formatCost(summary.estimated_cost_usd)}
          />
          <SummaryCard
            label={t('logs.cards.errorRate')}
            value={formatPercent(summary.error_rate)}
            accent={summary.error_rate > 0.05 ? 'red' : undefined}
          />
          <SummaryCard
            label={t('logs.cards.fallbackRate')}
            value={formatPercent(summary.fallback_rate)}
            accent={summary.fallback_rate > 0.15 ? 'yellow' : undefined}
          />
        </div>
      ) : null}

      {/* ── Erro de carregamento ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ── Tabela de execuções ── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.createdAt')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.useId')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.consumerCompany')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.model')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.totalTokens')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.estimatedCost')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.durationMs')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                  {t('logs.table.errorCode')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingList ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400 text-sm">
                    {t('logs.table.empty')}
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap font-mono text-xs">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-mono text-xs max-w-[180px] truncate">
                      {log.use_id}
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs max-w-[140px] truncate">
                      {log.consumer_company_id ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(log.status)}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {log.model ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 text-xs tabular-nums">
                      {formatTokens(log.total_tokens)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 text-xs tabular-nums font-mono">
                      {formatCost(log.estimated_cost_usd)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 text-xs tabular-nums">
                      {formatDuration(log.duration_ms)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                      {log.error_code ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {!loadingList && total > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
            <span>
              {t('logs.pagination.showing', { from: fromRow, to: toRow, total })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors text-xs"
              >
                {t('logs.pagination.previous')}
              </button>
              <span className="px-3 py-1.5 text-xs text-slate-500">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors text-xs"
              >
                {t('logs.pagination.next')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal de detalhe ── */}
      {selectedLog && (
        <DetailModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  )
}
