// =============================================================================
// src/components/Settings/ConsultingPackagesPanel.tsx
//
// Painel de compra de pacotes consultivos e visualização de histórico.
// Acessível em: Configurações → Planos e Uso → Consultoria
//
// BLOCOS:
//   1. Banner de sucesso pós-checkout (?consulting=success — visual apenas)
//   2. Saldo consultivo atual (horas disponíveis)
//   3. Cards de pacotes disponíveis para compra
//   4. Modal de confirmação → redireciona ao Stripe Checkout
//   5. Histórico de pedidos
//
// SEGURANÇA:
//   - company_id NUNCA enviado no body — resolvido via JWT no backend
//   - ?consulting=success é APENAS feedback visual — horas são creditadas pelo webhook
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { Clock, CheckCircle2, XCircle, AlertCircle, Loader2, Package, RefreshCw, ShoppingCart, Star } from 'lucide-react'
import {
  fetchConsultingPackages,
  fetchConsultingBalance,
  fetchConsultingOrders,
  startConsultingCheckout,
  type ConsultingPackage,
  type ConsultingOrder,
  type ConsultingBalance,
} from '../../services/consultingApi'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatHours(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const packageTypeLabel: Record<string, string> = {
  implementation: 'Implementação',
  training:       'Treinamento',
  consulting:     'Consultoria',
}

const statusConfig: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  pending_payment:  { label: 'Aguardando',   icon: <AlertCircle size={14} />,  cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  checkout_created: { label: 'Em andamento', icon: <Loader2 size={14} className="animate-spin" />, cls: 'text-blue-600 bg-blue-50 border-blue-200' },
  paid:             { label: 'Pago',         icon: <CheckCircle2 size={14} />, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  failed:           { label: 'Falhou',       icon: <XCircle size={14} />,      cls: 'text-red-600 bg-red-50 border-red-200' },
  cancelled:        { label: 'Cancelado',    icon: <XCircle size={14} />,      cls: 'text-slate-500 bg-slate-50 border-slate-200' },
  expired:          { label: 'Expirado',     icon: <XCircle size={14} />,      cls: 'text-slate-500 bg-slate-50 border-slate-200' },
}

// ── Componente badge de status ────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { label: status, icon: null, cls: 'text-slate-600 bg-slate-50 border-slate-200' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

// ── Modal de confirmação ──────────────────────────────────────────────────────

interface ConfirmModalProps {
  pkg:       ConsultingPackage
  loading:   boolean
  error:     string | null
  onConfirm: () => void
  onCancel:  () => void
}

function ConfirmModal({ pkg, loading, error, onConfirm, onCancel }: ConfirmModalProps) {
  const bonusCredits = pkg.bonus_credit?.credits
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Confirmar compra</h3>
          <p className="text-sm text-slate-500 mt-1">Você será redirecionado ao Stripe para pagamento</p>
        </div>

        <div className="bg-slate-50 rounded-lg p-4 space-y-2 border border-slate-200">
          <p className="font-medium text-slate-800">{pkg.name}</p>
          <p className="text-sm text-slate-500">{packageTypeLabel[pkg.package_type] ?? pkg.package_type} · {formatHours(pkg.hours)}</p>
          {bonusCredits && (
            <p className="text-xs text-violet-600 flex items-center gap-1">
              <Star size={12} />
              + {bonusCredits.toLocaleString('pt-BR')} créditos de IA como bônus
            </p>
          )}
          <p className="text-lg font-bold text-slate-900 mt-2">{formatPrice(pkg.price)}</p>
        </div>

        <p className="text-xs text-slate-500">
          As horas serão creditadas automaticamente após a confirmação do pagamento pelo Stripe.
          Créditos de bônus (se houver) também são liberados automaticamente.
        </p>

        {error && (
          <p className="text-sm text-red-600 flex items-center gap-1">
            <AlertCircle size={14} />{error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 px-4 rounded-lg border border-slate-300 text-slate-700 font-medium text-sm hover:bg-slate-50 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Aguarde...' : 'Ir para pagamento'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Painel principal ──────────────────────────────────────────────────────────

interface Props {
  companyId: string
}

export function ConsultingPackagesPanel({ companyId }: Props) {
  const [packages, setPackages]   = useState<ConsultingPackage[]>([])
  const [orders, setOrders]       = useState<ConsultingOrder[]>([])
  const [balance, setBalance]     = useState<ConsultingBalance | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [selectedPkg, setSelectedPkg] = useState<ConsultingPackage | null>(null)
  const [buying, setBuying]       = useState(false)
  const [buyError, setBuyError]   = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pkgs, bal, ords] = await Promise.all([
        fetchConsultingPackages(companyId),
        fetchConsultingBalance(companyId),
        fetchConsultingOrders(companyId),
      ])
      setPackages(pkgs)
      setBalance(bal)
      setOrders(ords.orders)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { void loadAll() }, [loadAll])

  // Detectar retorno do Stripe (?consulting=success)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('consulting') === 'success') {
      setShowSuccess(true)
      params.delete('consulting')
      params.delete('session_id')
      const newSearch = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`)
      void loadAll()
    }
  }, [loadAll])

  async function handleConfirmBuy() {
    if (!selectedPkg) return
    setBuying(true)
    setBuyError(null)
    try {
      const checkoutUrl = await startConsultingCheckout(companyId, selectedPkg.id)
      window.location.href = checkoutUrl
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : 'Erro ao iniciar checkout')
      setBuying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Banner de sucesso */}
      {showSuccess && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-800">Pagamento processado!</p>
            <p className="text-xs text-emerald-600">As horas serão creditadas após confirmação do Stripe.</p>
          </div>
          <button onClick={() => setShowSuccess(false)} className="ml-auto text-emerald-500 hover:text-emerald-700">×</button>
        </div>
      )}

      {/* Saldo atual */}
      {balance && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-5">
          <h3 className="text-sm font-medium text-blue-700 mb-3 flex items-center gap-2">
            <Clock size={16} />Saldo Consultivo
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-800">{formatHours(balance.available_hours)}</p>
              <p className="text-xs text-blue-500 mt-1">Disponíveis</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-700">{formatHours(balance.total_credited_hours)}</p>
              <p className="text-xs text-slate-500 mt-1">Contratadas</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-700">{formatHours(balance.used_hours)}</p>
              <p className="text-xs text-slate-500 mt-1">Utilizadas</p>
            </div>
          </div>
        </div>
      )}

      {/* Catálogo de pacotes */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Package size={18} />Pacotes disponíveis
          </h3>
          <button onClick={loadAll} className="text-slate-400 hover:text-slate-600 transition" title="Atualizar">
            <RefreshCw size={16} />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle size={16} />{error}
          </div>
        )}

        {packages.length === 0 ? (
          <p className="text-slate-500 text-sm">Nenhum pacote consultivo disponível no momento.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {packages.map((pkg) => (
              <div
                key={pkg.id}
                className="bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
                onClick={() => { setSelectedPkg(pkg); setBuyError(null) }}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                    {packageTypeLabel[pkg.package_type] ?? pkg.package_type}
                  </span>
                </div>
                <h4 className="font-semibold text-slate-800 text-sm mb-1">{pkg.name}</h4>
                {pkg.description && (
                  <p className="text-xs text-slate-500 mb-3 leading-relaxed">{pkg.description}</p>
                )}
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} className="text-slate-400" />
                  <span className="text-sm text-slate-600">{formatHours(pkg.hours)}</span>
                </div>
                {pkg.bonus_credit && (
                  <div className="flex items-center gap-2 mb-3">
                    <Star size={14} className="text-violet-400" />
                    <span className="text-xs text-violet-600">+{pkg.bonus_credit.credits.toLocaleString('pt-BR')} créditos de IA</span>
                  </div>
                )}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                  <p className="text-lg font-bold text-slate-900">{formatPrice(pkg.price)}</p>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition group-hover:shadow-sm">
                    <ShoppingCart size={12} />Comprar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Histórico de pedidos */}
      {orders.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-slate-800 mb-4">Histórico de pedidos</h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Pacote</th>
                  <th className="text-left px-4 py-3 font-medium">Horas</th>
                  <th className="text-left px-4 py-3 font-medium">Valor</th>
                  <th className="text-left px-4 py-3 font-medium">Bônus IA</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-800 font-medium">{o.package_name_snapshot}</td>
                    <td className="px-4 py-3 text-slate-600">{formatHours(Number(o.hours_snapshot))}</td>
                    <td className="px-4 py-3 text-slate-800">{formatPrice(Number(o.price_snapshot))}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {o.bonus_credits_snapshot
                        ? `+${o.bonus_credits_snapshot.toLocaleString('pt-BR')} créditos`
                        : '—'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDateTime(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de confirmação */}
      {selectedPkg && (
        <ConfirmModal
          pkg={selectedPkg}
          loading={buying}
          error={buyError}
          onConfirm={handleConfirmBuy}
          onCancel={() => { setSelectedPkg(null); setBuyError(null) }}
        />
      )}
    </div>
  )
}
