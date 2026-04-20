import React, { useState } from 'react'
import {
  Crown, TrendingUp, Users, GitBranch, Zap, HardDrive, CheckCircle,
  ArrowUpCircle, ArrowDownCircle, Clock, AlertTriangle, Info, ChevronDown,
  ChevronUp, Loader2, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { usePlanAvailable, PlanCard } from '../../hooks/usePlanAvailable'
import { usePlanLeadStats } from '../../hooks/usePlanLeadStats'

interface Props {
  companyId: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number | null): string {
  if (value === null) return '∞'
  return value.toLocaleString('pt-BR')
}

function pctColor(pct: number | null): string {
  if (pct === null) return 'bg-blue-500'
  if (pct >= 100) return 'bg-red-500'
  if (pct >= 90)  return 'bg-orange-500'
  if (pct >= 80)  return 'bg-yellow-500'
  return 'bg-green-500'
}

function slugColor(slug: string): string {
  switch (slug) {
    case 'starter': return 'bg-slate-100 text-slate-700 border-slate-200'
    case 'growth':  return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'pro':     return 'bg-violet-50 text-violet-700 border-violet-200'
    case 'elite':   return 'bg-amber-50 text-amber-700 border-amber-200'
    default:        return 'bg-slate-50 text-slate-600 border-slate-200'
  }
}

function blockedLabel(key: string): string {
  const map: Record<string, string> = {
    max_leads:            'leads ativos',
    max_users:            'usuários ativos',
    max_funnels:          'funis ativos',
    max_automation_flows: 'automações ativas',
    storage_mb:           'armazenamento usado',
  }
  return map[key] ?? key
}

// ── Barra de uso ─────────────────────────────────────────────────────────────

interface UsageBarProps {
  icon: React.ReactNode
  label: string
  current: number | null
  max: number | null
  pct: number | null
  unit?: string
}

function UsageBar({ icon, label, current, max, pct }: UsageBarProps) {
  const isUnlimited = max === null
  const barPct = isUnlimited ? 0 : Math.min(pct ?? 0, 100)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-slate-600">
          {icon}
          <span>{label}</span>
        </div>
        <span className="font-medium text-slate-700">
          {current !== null ? current.toLocaleString('pt-BR') : '—'} / {fmt(max)}
          {!isUnlimited && pct !== null && (
            <span className="ml-1 text-xs text-slate-400">({pct}%)</span>
          )}
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        {isUnlimited ? (
          <div className="h-full w-full bg-blue-200 rounded-full" />
        ) : (
          <div
            className={`h-full rounded-full transition-all ${pctColor(pct)}`}
            style={{ width: `${barPct}%` }}
          />
        )}
      </div>
    </div>
  )
}

// ── Card de plano ─────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: PlanCard
  onRequest: (plan: PlanCard) => void
  requesting: boolean
}

function PlanCardItem({ plan, onRequest, requesting }: PlanCardProps) {
  const [expanded, setExpanded] = useState(false)

  const directionIcon = plan.direction === 'upgrade'
    ? <ArrowUpCircle className="w-4 h-4 text-green-500" />
    : plan.direction === 'downgrade'
    ? <ArrowDownCircle className="w-4 h-4 text-orange-400" />
    : plan.is_current
    ? <CheckCircle className="w-4 h-4 text-blue-500" />
    : null

  const ctaLabel = plan.direction === 'upgrade'
    ? 'Solicitar upgrade'
    : plan.direction === 'downgrade'
    ? 'Solicitar downgrade'
    : null

  return (
    <div className={`relative rounded-xl border-2 p-5 transition-all ${
      plan.is_current
        ? 'border-blue-400 bg-blue-50'
        : plan.is_accessible
        ? 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm'
        : 'border-slate-200 bg-slate-50 opacity-70'
    }`}>
      {/* Badge popular */}
      {plan.is_popular && !plan.is_current && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-0.5 bg-amber-400 text-amber-900 text-xs font-semibold rounded-full shadow-sm">
            Recomendado
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${slugColor(plan.slug)}`}>
              {plan.name}
            </span>
            {directionIcon}
            {plan.is_current && (
              <span className="text-xs text-blue-600 font-medium">Plano atual</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          aria-label={expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Limites principais sempre visíveis */}
      <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-600 mb-4">
        <div className="flex items-center gap-1">
          <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
          <span>{fmt(plan.max_leads)} leads</span>
        </div>
        <div className="flex items-center gap-1">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          <span>{fmt(plan.max_users)} usuários</span>
        </div>
        <div className="flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-slate-400" />
          <span>{fmt(plan.max_automation_flows)} automações</span>
        </div>
        <div className="flex items-center gap-1">
          <HardDrive className="w-3.5 h-3.5 text-slate-400" />
          <span>{plan.storage_mb === null ? '∞' : `${plan.storage_mb / 1024 >= 1 ? `${plan.storage_mb / 1024}GB` : `${plan.storage_mb}MB`}`} armazenamento</span>
        </div>
      </div>

      {/* Detalhes expandidos */}
      {expanded && (
        <div className="border-t border-slate-200 pt-3 mb-4 space-y-1 text-xs text-slate-500">
          <div className="flex justify-between">
            <span>Funis</span>
            <span className="font-medium">{fmt(plan.max_funnels)}</span>
          </div>
          <div className="flex justify-between">
            <span>Etapas por funil</span>
            <span className="font-medium">{fmt(plan.max_funnel_stages)}</span>
          </div>
          <div className="flex justify-between">
            <span>Execuções/mês</span>
            <span className="font-medium">{fmt(plan.max_automation_executions_monthly)}</span>
          </div>
          <div className="flex justify-between">
            <span>Produtos</span>
            <span className="font-medium">{fmt(plan.max_products)}</span>
          </div>
          <div className="flex justify-between">
            <span>Instâncias WhatsApp</span>
            <span className="font-medium">{fmt(plan.max_whatsapp_instances)}</span>
          </div>
        </div>
      )}

      {/* Aviso de bloqueio */}
      {!plan.is_current && !plan.is_accessible && (
        <div className="mb-3 flex items-start gap-1.5 text-xs text-orange-700 bg-orange-50 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Reduza seu uso antes: {plan.blocked_by.map(blockedLabel).join(', ')}.
          </span>
        </div>
      )}

      {/* CTA */}
      {!plan.is_current && ctaLabel && (
        <button
          onClick={() => plan.is_accessible && onRequest(plan)}
          disabled={!plan.is_accessible || requesting}
          className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
            plan.is_accessible && !requesting
              ? plan.direction === 'upgrade'
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {requesting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Aguarde…
            </span>
          ) : ctaLabel}
        </button>
      )}
    </div>
  )
}

// ── Modal de confirmação ──────────────────────────────────────────────────────

interface ConfirmModalProps {
  plan: PlanCard
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}

function ConfirmModal({ plan, onConfirm, onCancel, loading }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Confirmar solicitação</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-slate-600 text-sm">
            Você está solicitando a mudança para o plano{' '}
            <strong className="text-slate-900">{plan.name}</strong>.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3 text-sm text-blue-800">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Sua solicitação será analisada e você será notificado quando o plano for atualizado.
              Não há cobrança automática neste momento.
            </span>
          </div>
        </div>
        <div className="flex gap-3 p-6 border-t border-slate-200">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Enviando…
              </span>
            ) : 'Confirmar solicitação'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export const PlanUsagePanel: React.FC<Props> = ({ companyId }) => {
  const { data, loading, error, refetch } = usePlanAvailable(companyId)
  const { leadStats } = usePlanLeadStats(companyId)

  const [selectedPlan, setSelectedPlan]   = useState<PlanCard | null>(null)
  const [requesting, setRequesting]       = useState(false)
  const [requestError, setRequestError]   = useState<string | null>(null)
  const [requestSuccess, setRequestSuccess] = useState(false)
  const [cancelling, setCancelling]       = useState(false)

  const handleRequest = async () => {
    if (!selectedPlan) return
    setRequesting(true)
    setRequestError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const resp = await fetch('/api/plans/change-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to_plan_id: selectedPlan.id }),
      })

      const json = await resp.json()

      if (!resp.ok) {
        const msgs: Record<string, string> = {
          plan_not_available:        'Este plano não está disponível.',
          already_has_pending_request: 'Você já tem uma solicitação pendente.',
          already_on_this_plan:      'Você já está neste plano.',
          downgrade_blocked:         'Reduza seu uso antes de solicitar este plano.',
        }
        setRequestError(msgs[json.error] ?? 'Erro ao enviar solicitação. Tente novamente.')
        setSelectedPlan(null)
        return
      }

      setSelectedPlan(null)
      setRequestSuccess(true)
      refetch()
    } catch {
      setRequestError('Erro de conexão. Tente novamente.')
      setSelectedPlan(null)
    } finally {
      setRequesting(false)
    }
  }

  const handleCancel = async () => {
    setCancelling(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      await fetch('/api/plans/change-request', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      setRequestSuccess(false)
      refetch()
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  if (!data) return null

  const currentPlan = data.plans.find(p => p.is_current)
  const usage = data.usage

  return (
    <div className="space-y-8">
      {/* ── Banner de pedido pendente ── */}
      {data.pending_request && (
        <div className="flex items-start justify-between gap-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Solicitação em análise</p>
              <p className="mt-0.5">
                Você solicitou a mudança para o plano <strong>{data.pending_request.to_plan_name}</strong>.
                Nossa equipe irá processar em breve.
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="shrink-0 text-xs text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
          >
            {cancelling ? 'Cancelando…' : 'Cancelar pedido'}
          </button>
        </div>
      )}

      {/* ── Banner de sucesso ── */}
      {requestSuccess && !data.pending_request && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
          <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-sm text-green-800">
            Solicitação enviada com sucesso! Nossa equipe irá analisá-la em breve.
          </p>
        </div>
      )}

      {/* ── Banner de erro ── */}
      {requestError && (
        <div className="flex items-center justify-between gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">{requestError}</p>
          </div>
          <button onClick={() => setRequestError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Seção 1: Plano atual ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-semibold text-slate-900">Plano atual</h2>
          </div>
          {currentPlan && (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${slugColor(currentPlan.slug)}`}>
              {currentPlan.name}
            </span>
          )}
        </div>

        <div className="p-6 space-y-4">
          {/* Leads */}
          <UsageBar
            icon={<TrendingUp className="w-4 h-4" />}
            label="Leads"
            current={leadStats?.current ?? usage.leads}
            max={leadStats?.max ?? null}
            pct={leadStats?.proximity_pct ?? null}
          />

          {/* Usuários */}
          <UsageBar
            icon={<Users className="w-4 h-4" />}
            label="Usuários ativos"
            current={usage.users}
            max={currentPlan?.max_users ?? null}
            pct={
              currentPlan?.max_users
                ? Math.round((usage.users / currentPlan.max_users) * 100 * 10) / 10
                : null
            }
          />

          {/* Funis */}
          <UsageBar
            icon={<GitBranch className="w-4 h-4" />}
            label="Funis ativos"
            current={usage.funnels}
            max={currentPlan?.max_funnels ?? null}
            pct={
              currentPlan?.max_funnels
                ? Math.round((usage.funnels / currentPlan.max_funnels) * 100 * 10) / 10
                : null
            }
          />

          {/* Automações */}
          <UsageBar
            icon={<Zap className="w-4 h-4" />}
            label="Automações ativas"
            current={usage.auto_flows}
            max={currentPlan?.max_automation_flows ?? null}
            pct={
              currentPlan?.max_automation_flows
                ? Math.round((usage.auto_flows / currentPlan.max_automation_flows) * 100 * 10) / 10
                : null
            }
          />

          {/* Storage */}
          <UsageBar
            icon={<HardDrive className="w-4 h-4" />}
            label="Armazenamento"
            current={usage.storage_mb}
            max={currentPlan?.storage_mb ?? null}
            pct={
              currentPlan?.storage_mb
                ? Math.round((usage.storage_mb / currentPlan.storage_mb) * 100 * 10) / 10
                : null
            }
            unit="MB"
          />
        </div>
      </div>

      {/* ── Seção 2: Planos disponíveis ── */}
      <div>
        <h2 className="text-base font-semibold text-slate-900 mb-4">Planos disponíveis</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.plans.map(plan => (
            <PlanCardItem
              key={plan.id}
              plan={plan}
              onRequest={setSelectedPlan}
              requesting={requesting && selectedPlan?.id === plan.id}
            />
          ))}
        </div>
      </div>

      {/* ── Modal de confirmação ── */}
      {selectedPlan && (
        <ConfirmModal
          plan={selectedPlan}
          onConfirm={handleRequest}
          onCancel={() => setSelectedPlan(null)}
          loading={requesting}
        />
      )}
    </div>
  )
}
