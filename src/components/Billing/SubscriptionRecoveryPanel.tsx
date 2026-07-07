// Painel de recuperação exibido dentro do TrialExpiredGate.
// Responsável por carregar planos disponíveis e iniciar o checkout Stripe,
// permitindo que a empresa bloqueada contrate um plano sem acessar /settings.

import React, { useState } from 'react'
import { AlertTriangle, Info, Loader2, RefreshCw, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { usePlanAvailable } from '../../hooks/usePlanAvailable'
import type { PlanCard as PlanCardType } from '../../hooks/usePlanAvailable'
import { PlanCard } from './PlanCard'

interface Props {
  companyId: string
}

// Mensagens de erro amigáveis para respostas HTTP do checkout.
// Replicado de PlanUsagePanel.tsx para manter consistência visual.
const CHECKOUT_ERROR_MSGS: Record<string, string> = {
  plan_not_available:           'Este plano não está disponível.',
  plan_not_stripe_purchasable:  'Este plano requer contato com nossa equipe.',
  already_on_this_plan:         'Você já está neste plano.',
  active_subscription_exists:   'Use a opção de alterar plano no painel de configurações.',
  downgrade_blocked:            'Reduza seu uso antes de contratar este plano.',
  already_has_pending_request:  'Há uma solicitação em andamento. Aguarde alguns instantes e tente novamente.',
}

export const SubscriptionRecoveryPanel: React.FC<Props> = ({ companyId }) => {
  const { data, loading, error, refetch } = usePlanAvailable(companyId)

  const [selectedPlan, setSelectedPlan]   = useState<PlanCardType | null>(null)
  const [requesting, setRequesting]       = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const handleConfirm = async () => {
    if (!selectedPlan || requesting) return
    setRequesting(true)
    setCheckoutError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setCheckoutError('Sessão inválida. Faça logout e entre novamente.')
        setSelectedPlan(null)
        return
      }

      // Padrão idêntico ao de PlanUsagePanel.tsx:
      // POST /api/stripe/plans/checkout?company_id=...  body: { to_plan_id }
      const resp = await fetch(
        `/api/stripe/plans/checkout?company_id=${encodeURIComponent(companyId)}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ to_plan_id: selectedPlan.id }),
        },
      )

      const json = await resp.json()

      if (!resp.ok) {
        setCheckoutError(CHECKOUT_ERROR_MSGS[json.error] ?? 'Erro ao iniciar checkout. Tente novamente.')
        setSelectedPlan(null)
        return
      }

      // Atualização direta por admin da plataforma — sem redirecionamento Stripe.
      // O gate desaparecerá quando AuthContext re-fetchar subscription (visibilitychange).
      if (json.direct_update) {
        setSelectedPlan(null)
        return
      }

      // Redirecionar para o Stripe Checkout
      if (json.checkout_url) {
        window.location.assign(json.checkout_url)
      }

    } catch {
      setCheckoutError('Erro de conexão. Verifique sua internet e tente novamente.')
      setSelectedPlan(null)
    } finally {
      setRequesting(false)
    }
  }

  // ── Estados de carregamento e erro ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-1.5 shrink-0 text-red-600 hover:text-red-800 font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Tentar novamente
        </button>
      </div>
    )
  }

  if (!data) return null

  // Exibe apenas planos disponíveis para contratar (não o plano atual)
  const purchasablePlans = data.plans.filter(p => !p.is_current)

  // ── Renderização principal ───────────────────────────────────────────────────

  return (
    <>
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Planos disponíveis</h2>
        <p className="text-xs text-slate-500 mb-4">
          Escolha um plano para reativar seu acesso.
        </p>

        {/* Erro de checkout */}
        {checkoutError && (
          <div className="flex items-center justify-between gap-3 p-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{checkoutError}</span>
            </div>
            <button
              onClick={() => setCheckoutError(null)}
              className="text-red-400 hover:text-red-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Grid de cards — compact=true oculta expand/collapse */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {purchasablePlans.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              hasSubscription
              isInternalTrial
              compact
              onSelect={setSelectedPlan}
              requesting={requesting && selectedPlan?.id === plan.id}
            />
          ))}
        </div>
      </div>

      {/* Modal de confirmação de checkout */}
      {selectedPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Contratar plano</h2>
              <button
                onClick={() => { setSelectedPlan(null); setCheckoutError(null) }}
                disabled={requesting}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-slate-600 text-sm">
                Você será redirecionado para o checkout seguro do Stripe para contratar o plano{' '}
                <strong className="text-slate-900">{selectedPlan.name}</strong>.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3 text-sm text-blue-800">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Após a confirmação do pagamento, sua conta será reativada automaticamente.
                </span>
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-slate-200">
              <button
                onClick={() => { setSelectedPlan(null); setCheckoutError(null) }}
                disabled={requesting}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={requesting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {requesting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Redirecionando…
                  </span>
                ) : 'Ir para checkout'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
