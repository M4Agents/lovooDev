// Componente extraído de src/components/Settings/PlanUsagePanel.tsx.
// Centraliza a exibição de um card de plano para uso em PlanUsagePanel e SubscriptionRecoveryPanel.

import React, { useState } from 'react'
import {
  TrendingUp, Users, Zap, HardDrive,
  ArrowUpCircle, ArrowDownCircle, CheckCircle,
  ChevronDown, ChevronUp, Loader2, AlertTriangle,
  Clock, MessageCircle,
} from 'lucide-react'
import type { PlanCard as PlanCardType } from '../../hooks/usePlanAvailable'

export interface PlanCardProps {
  plan: PlanCardType
  // Indica se a empresa já possui assinatura Stripe ativa (influencia label do CTA)
  hasSubscription?: boolean
  // Indica trial interno sem Stripe — força CTA "Contratar plano" nos planos comprável
  isInternalTrial?: boolean
  onSelect?: (plan: PlanCardType) => void
  // true enquanto o checkout/change está em andamento para este card específico
  requesting?: boolean
  // Oculta o botão expand/collapse e os detalhes extras do plano
  compact?: boolean
}

// ── Helpers locais ─────────────────────────────────────────────────────────────

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

function fmt(value: number | null): string {
  if (value === null) return '∞'
  return value.toLocaleString('pt-BR')
}

// ── Componente ─────────────────────────────────────────────────────────────────

export function PlanCard({
  plan,
  hasSubscription = false,
  isInternalTrial = false,
  onSelect,
  requesting = false,
  compact = false,
}: PlanCardProps) {
  const [expanded, setExpanded] = useState(false)

  const directionIcon = plan.direction === 'upgrade'
    ? <ArrowUpCircle className="w-4 h-4 text-green-500" />
    : plan.direction === 'downgrade'
    ? <ArrowDownCircle className="w-4 h-4 text-orange-400" />
    : plan.is_current
    ? <CheckCircle className="w-4 h-4 text-blue-500" />
    : null

  const isContactPlan = !plan.is_stripe_purchasable && !plan.is_current

  const ctaLabel = plan.is_current ? null
    : isContactPlan ? 'Fale com a equipe'
    : isInternalTrial && plan.is_stripe_purchasable ? 'Contratar plano'
    : plan.direction === 'upgrade' ? 'Fazer upgrade'
    : plan.direction === 'downgrade' ? 'Fazer downgrade'
    : null

  const ctaStyle = plan.is_current ? ''
    : isContactPlan
      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
      : isInternalTrial && plan.is_stripe_purchasable
      ? 'bg-blue-600 hover:bg-blue-700 text-white'
      : plan.direction === 'upgrade'
      ? 'bg-blue-600 hover:bg-blue-700 text-white'
      : 'bg-slate-200 hover:bg-slate-300 text-slate-700'

  const handleCtaClick = () => {
    if (isContactPlan) {
      window.open('mailto:comercial@lovoocrm.com?subject=Interesse em plano personalizado', '_blank')
      return
    }
    if (plan.is_accessible && onSelect) onSelect(plan)
  }

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
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${slugColor(plan.slug)}`}>
            {plan.name}
          </span>
          {directionIcon}
          {plan.is_current && (
            <span className="text-xs text-blue-600 font-medium">Plano atual</span>
          )}
        </div>
        {/* Expand/collapse oculto em modo compact */}
        {!compact && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-slate-400 hover:text-slate-600 transition-colors ml-2"
            aria-label={expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Limites principais */}
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
          <span>
            {plan.storage_mb === null
              ? '∞'
              : plan.storage_mb >= 1024
              ? `${plan.storage_mb / 1024}GB`
              : `${plan.storage_mb}MB`
            } armazenamento
          </span>
        </div>
      </div>

      {/* Detalhes expandidos — ocultos em modo compact */}
      {!compact && expanded && (
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

      {/* Aviso de bloqueio por uso acima do limite (downgrade bloqueado) */}
      {!plan.is_current && !plan.is_accessible && !isContactPlan && (
        <div className="mb-3 flex items-start gap-1.5 text-xs text-orange-700 bg-orange-50 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Reduza seu uso antes: {plan.blocked_by.map(blockedLabel).join(', ')}.</span>
        </div>
      )}

      {/* Aviso de downgrade Stripe: aplicado no próximo ciclo (apenas assinatura ativa, não trial) */}
      {!plan.is_current && plan.direction === 'downgrade' && plan.is_stripe_purchasable
        && plan.is_accessible && hasSubscription && !isInternalTrial && (
        <div className="mb-3 flex items-start gap-1.5 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Será aplicado no próximo ciclo de cobrança.</span>
        </div>
      )}

      {/* CTA */}
      {!plan.is_current && ctaLabel && (
        <button
          onClick={handleCtaClick}
          disabled={plan.is_stripe_purchasable && (!plan.is_accessible || requesting)}
          className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            isContactPlan
              ? ctaStyle
              : plan.is_accessible && !requesting
              ? ctaStyle
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          {requesting ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Aguarde…</>
          ) : isContactPlan ? (
            <><MessageCircle className="w-4 h-4" />{ctaLabel}</>
          ) : ctaLabel}
        </button>
      )}
    </div>
  )
}
