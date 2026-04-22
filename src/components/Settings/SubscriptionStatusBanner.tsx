import React, { useState } from 'react'
import {
  CheckCircle, Clock, AlertTriangle, XCircle, ExternalLink,
  Loader2, X, AlertCircle, Settings,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { PlanSubscription } from '../../hooks/usePlanSubscription'

interface Props {
  subscription: PlanSubscription
  companyId: string
  onCancelled: () => void
  onHirePlan?: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
}

// ── Modal de confirmação de cancelamento ───────────────────────────────────────

interface CancelModalProps {
  periodEnd: string | null
  onConfirm: () => void
  onClose: () => void
  loading: boolean
}

function CancelModal({ periodEnd, onConfirm, onClose, loading }: CancelModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Cancelar assinatura</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-slate-600 text-sm">
            Sua assinatura continuará ativa até o fim do período pago
            {periodEnd ? (
              <> (<strong>{fmtDate(periodEnd)}</strong>)</>
            ) : ''}.
            Após essa data, o acesso será suspenso automaticamente.
          </p>
          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Esta ação não gera reembolso proporcional pelo período restante.</span>
          </div>
        </div>

        <div className="flex gap-3 p-6 border-t border-slate-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm"
          >
            Manter assinatura
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Aguarde…
              </span>
            ) : 'Confirmar cancelamento'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Badge de status ────────────────────────────────────────────────────────────

interface StatusBadgeProps { status: string | null }

function StatusBadge({ status }: StatusBadgeProps) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    active:     { label: 'Ativa',            cls: 'bg-green-100 text-green-700 border-green-200',  icon: <CheckCircle className="w-3.5 h-3.5" /> },
    trialing:   { label: 'Período de teste', cls: 'bg-blue-100 text-blue-700 border-blue-200',    icon: <Clock className="w-3.5 h-3.5" /> },
    past_due:   { label: 'Pagamento pendente', cls: 'bg-orange-100 text-orange-700 border-orange-200', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    incomplete: { label: 'Pagamento pendente', cls: 'bg-amber-100 text-amber-700 border-amber-200',    icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    canceled:   { label: 'Encerrada',        cls: 'bg-red-100 text-red-700 border-red-200',       icon: <XCircle className="w-3.5 h-3.5" /> },
  }

  const cfg = status ? (map[status] ?? map.active) : null
  if (!cfg) return null

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

const PORTAL_STATUSES = new Set(['active', 'trialing', 'past_due'])

export const SubscriptionStatusBanner: React.FC<Props> = ({
  subscription,
  companyId,
  onCancelled,
  onHirePlan,
}) => {
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelling, setCancelling]           = useState(false)
  const [cancelError, setCancelError]         = useState<string | null>(null)

  const [openingPortal, setOpeningPortal] = useState(false)
  const [portalError, setPortalError]     = useState<string | null>(null)

  if (!subscription.has_subscription) return null

  const { status, plan_name, current_period_end, cancel_at_period_end,
          scheduled_plan_name, last_invoice_url, billing_cycle,
          is_internal_trial, days_remaining } = subscription

  // days_remaining é calculado no backend (evita drift de fuso no cliente)
  const trialDaysRemaining = days_remaining
  const isTrialUrgent      = trialDaysRemaining !== null && trialDaysRemaining <= 3

  // Trial interno oculta portal e cancelamento (não há assinatura Stripe para gerir)
  const canCancel     = !is_internal_trial && (status === 'active' || status === 'trialing') && !cancel_at_period_end
  const canOpenPortal = !is_internal_trial && !!status && PORTAL_STATUSES.has(status)

  const handleOpenPortal = async () => {
    setOpeningPortal(true)
    setPortalError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const resp = await fetch('/api/stripe/customer-portal', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      const json = await resp.json()

      if (!resp.ok) {
        setPortalError(json.error ?? 'Erro ao abrir portal de cobrança')
        return
      }

      window.open(json.portal_url, '_blank', 'noopener,noreferrer')
    } catch {
      setPortalError('Erro de conexão. Tente novamente.')
    } finally {
      setOpeningPortal(false)
    }
  }

  const handleCancel = async () => {
    setCancelling(true)
    setCancelError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const resp = await fetch('/api/stripe/plans/cancel', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!resp.ok) {
        const json = await resp.json()
        setCancelError(json.error ?? 'Erro ao cancelar assinatura')
        return
      }

      setShowCancelModal(false)
      onCancelled()
    } catch {
      setCancelError('Erro de conexão. Tente novamente.')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-semibold text-slate-900">
                  {plan_name ?? 'Plano atual'}
                </span>
                <StatusBadge status={status} />
                {billing_cycle && (
                  <span className="text-xs text-slate-400 lowercase">
                    · cobrança {billing_cycle === 'monthly' ? 'mensal' : 'anual'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Ações de billing */}
          <div className="flex items-center gap-3">
            {/* Trial interno: único CTA disponível é contratar um plano */}
            {is_internal_trial && onHirePlan && (
              <button
                onClick={onHirePlan}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Contratar plano
              </button>
            )}

            {/* Assinatura Stripe ativa: portal e cancelamento */}
            {canOpenPortal && (
              <button
                onClick={handleOpenPortal}
                disabled={openingPortal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {openingPortal ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Settings className="w-3.5 h-3.5" />
                )}
                Gerenciar assinatura
              </button>
            )}

            {canCancel && (
              <button
                onClick={() => setShowCancelModal(true)}
                className="text-xs text-slate-400 hover:text-red-600 transition-colors underline"
              >
                Cancelar assinatura
              </button>
            )}
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          {/* Próxima cobrança / data de encerramento */}
          {status === 'active' && !cancel_at_period_end && current_period_end && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>Próxima cobrança em <strong>{fmtDate(current_period_end)}</strong></span>
            </div>
          )}

          {/* Trial interno: banner com urgência e CTA secundário */}
          {is_internal_trial && current_period_end && (
            <div className={`flex items-start gap-3 text-sm rounded-lg px-3 py-3 border ${
              isTrialUrgent
                ? 'text-red-800 bg-red-50 border-red-200'
                : 'text-amber-800 bg-amber-50 border-amber-200'
            }`}>
              <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${isTrialUrgent ? 'text-red-500' : 'text-amber-500'}`} />
              <div className="flex-1">
                <p className="font-medium">Você está em período de teste</p>
                <p className="mt-0.5">
                  {trialDaysRemaining === 0
                    ? 'Seu período de teste encerra hoje.'
                    : trialDaysRemaining === 1
                    ? 'Falta 1 dia para o encerramento do período de teste.'
                    : `Faltam ${trialDaysRemaining} dias — encerra em `}
                  {trialDaysRemaining !== null && trialDaysRemaining > 1 && (
                    <strong>{fmtDate(current_period_end)}</strong>
                  )}
                  {trialDaysRemaining === 0 || trialDaysRemaining === 1 ? (
                    <> Encerra em <strong>{fmtDate(current_period_end)}</strong>.</>
                  ) : '.'}
                </p>
              </div>
              {onHirePlan && (
                <button
                  onClick={onHirePlan}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-white ${
                    isTrialUrgent ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  Contratar plano
                </button>
              )}
            </div>
          )}

          {/* Trial Stripe convencional (não internal trial) */}
          {status === 'trialing' && !is_internal_trial && current_period_end && (
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Período de teste até <strong>{fmtDate(current_period_end)}</strong>.</span>
            </div>
          )}

          {/* Pagamento pendente / past_due */}
          {(status === 'past_due' || status === 'incomplete') && !last_invoice_url && (
            <div className="flex items-center gap-2 text-sm text-orange-700 bg-orange-50 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Há um pagamento pendente. Entre em contato com o suporte se o problema persistir.</span>
            </div>
          )}

          {/* Finalizar pagamento (3DS / payment action required) */}
          {last_invoice_url && (
            <div className="flex items-start gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">Ação necessária no pagamento</p>
                <p className="mt-0.5 text-amber-700">Sua última fatura requer autenticação adicional (ex.: 3DS).</p>
              </div>
              <a
                href={last_invoice_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-xs font-medium"
              >
                Finalizar pagamento
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Cancelamento agendado */}
          {cancel_at_period_end && current_period_end && (
            <div className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Cancelamento agendado para <strong>{fmtDate(current_period_end)}</strong>.
                Seu acesso será mantido até esta data.
              </span>
            </div>
          )}

          {/* Assinatura encerrada */}
          {status === 'canceled' && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>Assinatura encerrada. Contrate um plano para reativar o acesso.</span>
            </div>
          )}

          {/* Downgrade agendado */}
          {scheduled_plan_name && (
            <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>
                Mudança para o plano <strong>{scheduled_plan_name}</strong> agendada para o próximo ciclo.
              </span>
            </div>
          )}

          {/* Erro de cancelamento */}
          {cancelError && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{cancelError}</span>
            </div>
          )}

          {/* Erro ao abrir portal */}
          {portalError && (
            <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{portalError}</span>
            </div>
          )}
        </div>
      </div>

      {showCancelModal && (
        <CancelModal
          periodEnd={current_period_end}
          onConfirm={handleCancel}
          onClose={() => { setShowCancelModal(false); setCancelError(null) }}
          loading={cancelling}
        />
      )}
    </>
  )
}
