// =============================================================================
// src/components/Settings/AiCreditsPanel.tsx
//
// Dashboard de consumo de IA para empresas filhas (client).
// Acessível em: Configurações → Agentes → Consumo de IA
//
// BLOCOS:
//   1. Resumo de Créditos  — saldo plan_credits + extra_credits
//   2. Consumo do Período  — GET /api/agents/logs/summary?mode=billing
//   3. Histórico de Transações — credit_transactions via Supabase
//
// MULTI-TENANT:
//   Nunca permite selecionar outra empresa.
//   company_id sempre vem via props (de Settings.tsx → company.id).
//   Supabase RLS já isola por company, mas filtramos explicitamente.
//   Billing endpoint força company_id da sessão (server-side).
//
// DADOS:
//   - Tokens e custo OpenAI: NUNCA exibidos
//   - Créditos do plano: não acumulam (renovam no ciclo)
//   - Créditos extras: acumulativos, sem expiração (v1)
//   - Consumo: plano → extra (transparente ao usuário)
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { Loader2, CreditCard, Zap, MessageSquare, BarChart2, Receipt } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface CompanyCreditsData {
  plan_credits:       number
  extra_credits:      number
  plan_credits_total: number
  last_renewed_at:    string | null
}

interface BillingUsage {
  total_credits_used: number
  by_feature: {
    whatsapp: number
    insights: number
  }
  period_days: number
}

interface CreditTx {
  id:                  string
  type:                'plan_renewal' | 'purchase' | 'usage' | 'adjustment'
  credits:             number
  balance_after:       number
  plan_balance_after:  number | null
  extra_balance_after: number | null
  feature_type:        'whatsapp' | 'insights' | null
  created_at:          string
}

type Period = 7 | 30 | 60 | 90

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')
  return { Authorization: `Bearer ${session.access_token}` }
}

async function fetchBillingUsage(period: number): Promise<BillingUsage> {
  const headers = await getAuthHeaders()
  const res  = await fetch(`/api/agents/logs/summary?mode=billing&period=${period}`, { headers })
  const json = await res.json().catch(() => ({})) as Record<string, unknown>

  if (!res.ok || !json.ok) {
    throw new Error((json.error as string) || `Erro ${res.status}`)
  }

  const data = (json.data ?? {}) as Record<string, unknown>
  const byFeature = (data.by_feature ?? {}) as Record<string, number>

  return {
    total_credits_used: (data.total_credits_used as number) ?? 0,
    by_feature: {
      whatsapp: byFeature.whatsapp ?? 0,
      insights: byFeature.insights ?? 0,
    },
    period_days: (data.period_days as number) ?? period,
  }
}

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

function formatCredits(n: number): string {
  return n.toLocaleString('pt-BR')
}

// ── Constantes de labels ──────────────────────────────────────────────────────

const TX_TYPE_LABELS: Record<string, string> = {
  plan_renewal: 'Renovação do plano',
  purchase:     'Compra de créditos',
  usage:        'Consumo',
  adjustment:   'Ajuste',
}

const TX_TYPE_CLASSES: Record<string, string> = {
  plan_renewal: 'bg-blue-100 text-blue-800',
  purchase:     'bg-green-100 text-green-800',
  usage:        'bg-slate-100 text-slate-700',
  adjustment:   'bg-amber-100 text-amber-800',
}

const FEATURE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  insights: 'Insights',
}

const PERIOD_OPTIONS: Period[] = [7, 30, 60, 90]

// ── Subcomponentes ────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  right,
}: {
  icon: React.ReactNode
  title: string
  right?: React.ReactNode
}) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-violet-600">{icon}</span>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      {right}
    </div>
  )
}

function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-5 py-3">
          <div className="h-4 bg-slate-100 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
      {message}
    </p>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  companyId: string
}

export function AiCreditsPanel({ companyId }: Props) {
  const [period, setPeriod] = useState<Period>(30)

  const [creditsData,     setCreditsData]     = useState<CompanyCreditsData | null>(null)
  const [usage,           setUsage]           = useState<BillingUsage | null>(null)
  const [transactions,    setTransactions]    = useState<CreditTx[]>([])

  const [loadingCredits,  setLoadingCredits]  = useState(true)
  const [loadingUsage,    setLoadingUsage]    = useState(true)
  const [loadingTx,       setLoadingTx]       = useState(true)

  const [errorCredits,    setErrorCredits]    = useState<string | null>(null)
  const [errorUsage,      setErrorUsage]      = useState<string | null>(null)
  const [errorTx,         setErrorTx]         = useState<string | null>(null)

  // ── Carregamento: saldo ───────────────────────────────────────────────────

  const loadCredits = useCallback(async () => {
    setLoadingCredits(true)
    setErrorCredits(null)
    try {
      const { data, error } = await supabase
        .from('company_credits')
        .select('plan_credits, extra_credits, plan_credits_total, last_renewed_at')
        .eq('company_id', companyId)
        .single()
      if (error) throw error
      setCreditsData(data as CompanyCreditsData)
    } catch (err) {
      setErrorCredits(err instanceof Error ? err.message : 'Erro ao carregar saldo de créditos')
    } finally {
      setLoadingCredits(false)
    }
  }, [companyId])

  // ── Carregamento: consumo do período ─────────────────────────────────────

  const loadUsage = useCallback(async (p: number) => {
    setLoadingUsage(true)
    setErrorUsage(null)
    try {
      const data = await fetchBillingUsage(p)
      setUsage(data)
    } catch (err) {
      setErrorUsage(err instanceof Error ? err.message : 'Erro ao carregar consumo do período')
    } finally {
      setLoadingUsage(false)
    }
  }, [])

  // ── Carregamento: histórico de transações ─────────────────────────────────

  const loadTransactions = useCallback(async () => {
    setLoadingTx(true)
    setErrorTx(null)
    try {
      const { data, error } = await supabase
        .from('credit_transactions')
        .select('id, type, credits, balance_after, plan_balance_after, extra_balance_after, feature_type, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      setTransactions((data ?? []) as CreditTx[])
    } catch (err) {
      setErrorTx(err instanceof Error ? err.message : 'Erro ao carregar histórico de transações')
    } finally {
      setLoadingTx(false)
    }
  }, [companyId])

  useEffect(() => {
    void loadCredits()
    void loadTransactions()
  }, [loadCredits, loadTransactions])

  useEffect(() => {
    void loadUsage(period)
  }, [period, loadUsage])

  // ── Valores calculados ───────────────────────────────────────────────────

  const planCredits  = creditsData?.plan_credits       ?? 0
  const extraCredits = creditsData?.extra_credits      ?? 0
  const planTotal    = creditsData?.plan_credits_total ?? 0
  const planUsed     = Math.max(0, planTotal - planCredits)
  const planPercent  = planTotal > 0 ? Math.min(100, Math.round((planUsed / planTotal) * 100)) : 0
  const totalAvailable = planCredits + extraCredits

  const wppCredits     = usage?.by_feature.whatsapp ?? 0
  const insCredits     = usage?.by_feature.insights ?? 0
  const featureTotal   = wppCredits + insCredits
  const wppPercent     = featureTotal > 0 ? Math.round((wppCredits / featureTotal) * 100) : 0
  const insPercent     = featureTotal > 0 ? Math.round((insCredits / featureTotal) * 100) : 0

  const planBarColor =
    planPercent >= 90 ? 'bg-red-500' :
    planPercent >= 70 ? 'bg-amber-500' :
    'bg-violet-500'

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── 1. Resumo de créditos ──────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <SectionHeader
          icon={<CreditCard size={16} />}
          title="Resumo de Créditos"
        />

        {loadingCredits ? (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="space-y-3">
                <div className="h-3 bg-slate-100 rounded animate-pulse w-2/3" />
                <div className="h-8 bg-slate-100 rounded animate-pulse w-1/2" />
                <div className="h-2 bg-slate-100 rounded animate-pulse" />
                <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
              </div>
            ))}
          </div>
        ) : errorCredits ? (
          <div className="p-5">
            <ErrorBanner message={errorCredits} />
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-6">

            {/* Créditos do plano */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Créditos do Plano
                </span>
                <span className="text-xs text-slate-400 tabular-nums">{planPercent}%</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-slate-800 tabular-nums">
                  {formatCredits(planUsed)}
                </span>
                <span className="text-sm text-slate-400">
                  / {formatCredits(planTotal)}
                </span>
              </div>
              <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${planBarColor}`}
                  style={{ width: `${planPercent}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">Renovam a cada ciclo de cobrança</p>
            </div>

            {/* Créditos extras */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Créditos Extras
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-slate-800 tabular-nums">
                  {formatCredits(extraCredits)}
                </span>
                <span className="text-sm text-slate-400">disponíveis</span>
              </div>
              {/* Linha de separação visual com o bar do plano */}
              <div className="h-2" />
              <p className="text-xs text-slate-400">Acumulativos — não expiram</p>
            </div>

            {/* Total disponível */}
            <div className="space-y-2 sm:border-l sm:border-slate-100 sm:pl-6">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Total Disponível
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold tabular-nums ${totalAvailable === 0 ? 'text-red-600' : 'text-slate-800'}`}>
                  {formatCredits(totalAvailable)}
                </span>
              </div>
              <div className="h-2" />
              <p className="text-xs text-slate-400">Plano + Extras combinados</p>
            </div>

          </div>
        )}
      </div>

      {/* ── 2. Consumo do período ──────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <SectionHeader
          icon={<Zap size={16} />}
          title="Consumo do Período"
          right={
            <div className="flex gap-1">
              {PERIOD_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setPeriod(d)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    period === d
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          }
        />

        {loadingUsage ? (
          <div className="p-5 space-y-4">
            <div className="h-8 bg-slate-100 rounded animate-pulse w-1/4" />
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 bg-slate-100 rounded animate-pulse w-1/5" />
                  <div className="h-3 bg-slate-100 rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ) : errorUsage ? (
          <div className="p-5">
            <ErrorBanner message={errorUsage} />
          </div>
        ) : (
          <div className="p-5 space-y-5">

            {/* Total do período */}
            <div>
              <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">
                Total nos últimos {usage?.period_days ?? period} dias
              </span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-slate-800 tabular-nums">
                  {formatCredits(usage?.total_credits_used ?? 0)}
                </span>
                <span className="text-sm text-slate-400">créditos</span>
              </div>
            </div>

            {/* Barras por feature — sempre exibe ambas, mesmo com valor 0 */}
            <div className="space-y-3">

              {/* WhatsApp */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare size={12} className="text-slate-400" />
                    <span className="font-medium text-slate-600">WhatsApp</span>
                  </div>
                  <span className="text-slate-500 tabular-nums">
                    {formatCredits(wppCredits)} cr · {wppPercent}%
                  </span>
                </div>
                <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-green-500 rounded-full transition-all duration-500"
                    style={{ width: `${wppPercent}%` }}
                  />
                </div>
              </div>

              {/* Insights */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <BarChart2 size={12} className="text-slate-400" />
                    <span className="font-medium text-slate-600">Insights</span>
                  </div>
                  <span className="text-slate-500 tabular-nums">
                    {formatCredits(insCredits)} cr · {insPercent}%
                  </span>
                </div>
                <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${insPercent}%` }}
                  />
                </div>
              </div>

            </div>

            {featureTotal === 0 && (
              <p className="text-sm text-slate-400 text-center py-2">
                Nenhum consumo registrado neste período
              </p>
            )}

          </div>
        )}
      </div>

      {/* ── 3. Histórico de transações ─────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <SectionHeader
          icon={<Receipt size={16} />}
          title="Histórico de Transações"
          right={<span className="text-xs text-slate-400">Últimas 30</span>}
        />

        {loadingTx ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow key={i} cols={5} />
                ))}
              </tbody>
            </table>
          </div>
        ) : errorTx ? (
          <div className="p-5">
            <ErrorBanner message={errorTx} />
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-10 text-center">
            <Loader2 size={24} className="mx-auto mb-2 text-slate-200" />
            <p className="text-sm text-slate-400">Nenhuma transação registrada</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    Data
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    Tipo
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    Feature
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    Créditos
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    Saldo após
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap font-mono">
                      {formatDate(tx.created_at)}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TX_TYPE_CLASSES[tx.type] ?? 'bg-slate-100 text-slate-700'}`}>
                        {TX_TYPE_LABELS[tx.type] ?? tx.type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {tx.feature_type ? (FEATURE_LABELS[tx.feature_type] ?? tx.feature_type) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`text-xs font-mono font-semibold tabular-nums ${tx.credits >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.credits >= 0 ? '+' : ''}{formatCredits(tx.credits)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-slate-600 tabular-nums font-mono">
                      {formatCredits(tx.balance_after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
