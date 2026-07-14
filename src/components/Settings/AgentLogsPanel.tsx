import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, X, TrendingUp, ChevronDown, ChevronUp, MessageSquare, BarChart2, DollarSign } from 'lucide-react'
import {
  listLogs,
  getSummary,
  type AgentExecutionLog,
  type LogsFilters,
  type LogsSummaryResponse,
} from '../../services/agentLogsApi'
import { AGENT_FUNCTIONAL_USES } from '../../types/lovoo-agents'
import { api } from '../../services/api'
import { PARENT_COMPANY_ID } from '../../config/parentCompanyId'

// ── Constantes do modelo de cobrança (SaaS Governance) ───────────────────────

const CREDIT_RATE        = 1.6    // créditos por 1.000 tokens (base)
const WPP_MULTIPLIER     = 1      // multiplicador WhatsApp
const INS_MULTIPLIER     = 6      // multiplicador Insights
const PRICE_PER_CREDIT   = 0.0347 // R$ por crédito (pacote padrão: R$347/10k)
const USD_TO_BRL         = 5.80   // taxa de câmbio de referência
const CREDITS_PER_PKG    = 10000  // créditos por pacote padrão
const PKG_PRICE_BRL      = 347    // R$ por pacote padrão

// ── Painel de Governança de Lucratividade (SaaS) ──────────────────────────────

function SaasGovernancePanel({ summary }: { summary: LogsSummaryResponse | null }) {
  const [open, setOpen] = useState(true)

  // Cálculos com base no resumo atual (assumindo mix ~100% WhatsApp para estimativa)
  const totalTokens       = summary?.total_tokens ?? 0
  const costUsd           = summary?.estimated_cost_usd ?? 0
  const costBrl           = costUsd * USD_TO_BRL
  const estCredits        = Math.ceil((totalTokens / 1000) * CREDIT_RATE * WPP_MULTIPLIER)
  const estRevenueBrl     = estCredits * PRICE_PER_CREDIT
  const grossProfitBrl    = estRevenueBrl - costBrl
  const markup            = costBrl > 0 ? Math.round(estRevenueBrl / costBrl) : 0
  const margin            = estRevenueBrl > 0 ? ((grossProfitBrl / estRevenueBrl) * 100).toFixed(1) : '—'

  // Custo OpenAI para esgotar 1 pacote de 10k créditos
  // 10k cr ÷ 1.6 = 6.250 unidades × 1.000 tokens = 6.250.000 tokens
  const tokensPerPkg      = (CREDITS_PER_PKG / CREDIT_RATE) * 1000
  const costPerPkgUsd     = (tokensPerPkg / 1_000_000) * 0.40   // gpt-4.1-mini input rate
  const costPerPkgBrl     = costPerPkgUsd * USD_TO_BRL
  const profitPerPkgBrl   = PKG_PRICE_BRL - costPerPkgBrl
  const marginPerPkg      = ((profitPerPkgBrl / PKG_PRICE_BRL) * 100).toFixed(1)
  const conversationsPerPkg = Math.floor(CREDITS_PER_PKG / (10 * 5)) // 10 cr/msg × 5 msg/conv

  function fmt(n: number, decimals = 2): string {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }

  return (
    <div className="bg-white border border-violet-200 rounded-lg overflow-hidden">
      {/* Header clicável */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-violet-100 hover:bg-violet-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-violet-800">Governança de Lucratividade — SaaS</h3>
          <span className="text-xs bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-medium">Restrito</span>
        </div>
        {open ? <ChevronUp size={16} className="text-violet-400" /> : <ChevronDown size={16} className="text-violet-400" />}
      </button>

      {open && (
        <div className="p-5 space-y-5">

          {/* ── Seção 1: Fórmula e multiplicadores ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Fórmula de Cobrança Atual</p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 font-mono text-sm text-slate-700">
                créditos = ⌈(tokens ÷ 1.000) × {CREDIT_RATE} × multiplicador⌉
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Multiplicadores por Canal</p>
              <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-left text-slate-500 font-medium">Canal</th>
                      <th className="px-3 py-2 text-center text-slate-500 font-medium">Mult.</th>
                      <th className="px-3 py-2 text-right text-slate-500 font-medium">cr / 1k tokens</th>
                      <th className="px-3 py-2 text-right text-slate-500 font-medium">R$ / 1k tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-3 py-2 flex items-center gap-1.5">
                        <MessageSquare size={11} className="text-green-500" />
                        <span className="font-medium text-slate-700">WhatsApp</span>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-500">{WPP_MULTIPLIER}×</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">{fmt(CREDIT_RATE * WPP_MULTIPLIER, 1)} cr</td>
                      <td className="px-3 py-2 text-right font-mono text-green-700">
                        R$ {fmt(CREDIT_RATE * WPP_MULTIPLIER * PRICE_PER_CREDIT, 4)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 flex items-center gap-1.5">
                        <BarChart2 size={11} className="text-blue-500" />
                        <span className="font-medium text-slate-700">Insights</span>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-500">{INS_MULTIPLIER}×</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">{fmt(CREDIT_RATE * INS_MULTIPLIER, 1)} cr</td>
                      <td className="px-3 py-2 text-right font-mono text-blue-700">
                        R$ {fmt(CREDIT_RATE * INS_MULTIPLIER * PRICE_PER_CREDIT, 4)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Seção 2: Referência de precificação ── */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Referência de Precificação (Pacote Padrão)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Pacote padrão', value: `${CREDITS_PER_PKG.toLocaleString('pt-BR')} cr`, sub: `R$ ${PKG_PRICE_BRL}` },
                { label: 'Preço por crédito', value: `R$ ${fmt(PRICE_PER_CREDIT, 4)}`, sub: 'por crédito' },
                { label: 'Custo OpenAI / pacote', value: `R$ ${fmt(costPerPkgBrl)}`, sub: `$${fmt(costPerPkgUsd, 4)} USD` },
                { label: 'Conversas / pacote', value: `~${conversationsPerPkg.toLocaleString('pt-BR')}`, sub: '5 msg cada' },
              ].map(({ label, value, sub }) => (
                <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-0.5">
                  <p className="text-xs text-slate-500 font-medium">{label}</p>
                  <p className="text-base font-bold text-slate-800">{value}</p>
                  <p className="text-xs text-slate-400">{sub}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Seção 3: Lucro por pacote ── */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lucratividade por Pacote (R$ {PKG_PRICE_BRL})</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-0.5">
                <p className="text-xs text-green-600 font-medium">Receita</p>
                <p className="text-xl font-bold text-green-700">R$ {fmt(PKG_PRICE_BRL, 2)}</p>
                <p className="text-xs text-green-500">por pacote vendido</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-0.5">
                <p className="text-xs text-red-500 font-medium">Custo OpenAI</p>
                <p className="text-xl font-bold text-red-600">R$ {fmt(costPerPkgBrl)}</p>
                <p className="text-xs text-red-400">para 10k créditos consumidos</p>
              </div>
              <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-0.5">
                <p className="text-xs text-violet-600 font-medium">Lucro Bruto</p>
                <p className="text-xl font-bold text-violet-700">R$ {fmt(profitPerPkgBrl)}</p>
                <p className="text-xs text-violet-500">{marginPerPkg}% de margem</p>
              </div>
            </div>
          </div>

          {/* ── Seção 4: Análise dinâmica do período atual ── */}
          {summary && totalTokens > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <DollarSign size={13} className="text-emerald-600" />
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Análise do Período Atual (estimativa WhatsApp)
                </p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-emerald-100">
                    <tr>
                      <td className="px-4 py-2.5 text-xs text-slate-600">Total de tokens processados</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono font-semibold text-slate-700">
                        {totalTokens.toLocaleString('pt-BR')}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 text-xs text-slate-600">Custo pago à OpenAI</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono font-semibold text-red-600">
                        R$ {fmt(costBrl)} <span className="text-slate-400">(${fmt(costUsd, 6)} USD)</span>
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 text-xs text-slate-600">Créditos cobrados dos clientes</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono font-semibold text-slate-700">
                        ~{estCredits.toLocaleString('pt-BR')} cr
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 text-xs text-slate-600">Receita estimada dos clientes</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono font-semibold text-green-600">
                        R$ {fmt(estRevenueBrl)}
                      </td>
                    </tr>
                    <tr className="bg-emerald-100/60">
                      <td className="px-4 py-2.5 text-xs font-semibold text-emerald-800">Lucro bruto estimado</td>
                      <td className="px-4 py-2.5 text-right text-sm font-bold text-emerald-700">
                        R$ {fmt(grossProfitBrl)}
                        <span className="text-xs font-normal text-emerald-500 ml-2">
                          ({margin}% margem · {markup}× markup)
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="px-4 py-2 text-xs text-emerald-600 bg-emerald-50 border-t border-emerald-100">
                  * Estimativa baseada em 100% WhatsApp. Insights têm markup {Math.round((CREDIT_RATE * INS_MULTIPLIER * PRICE_PER_CREDIT) / (0.40 / 1000))}× maior.
                  Câmbio de referência: R$ {USD_TO_BRL}/USD. Pacote padrão: R$ {PKG_PRICE_BRL}/10k cr.
                </p>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

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

  // Lista de empresas clientes para o filtro
  const [companies, setCompanies]             = useState<{ id: string; name: string }[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(false)

  // Carrega empresas clientes uma única vez ao montar o painel
  useEffect(() => {
    setLoadingCompanies(true)
    api.getClientCompanies(PARENT_COMPANY_ID)
      .then(data => setCompanies((data ?? []).map(c => ({ id: c.id, name: c.name }))))
      .catch(() => setCompanies([]))
      .finally(() => setLoadingCompanies(false))
  }, [])

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

      {/* ── Painel de Governança de Lucratividade (SaaS) ── */}
      <SaasGovernancePanel summary={summary} />

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

          {/* Empresa consumidora */}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-xs text-slate-500">{t('logs.filters.consumerCompany')}</label>
            <select
              value={filters.consumer_company_id ?? ''}
              onChange={e => setFilters(f => ({
                ...f,
                consumer_company_id: e.target.value || undefined,
              }))}
              disabled={loadingCompanies}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">{t('logs.filters.allCompanies')}</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
