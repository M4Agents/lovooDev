// =============================================================================
// src/components/Settings/CreditPackagesPanel.tsx
//
// Painel de compra de créditos avulsos de IA para empresas filhas.
// Acessível em: Configurações → Planos e Uso → Comprar Créditos
//
// BLOCOS:
//   1. Banner de sucesso pós-checkout Stripe (?credits=success — visual apenas)
//   2. Cards de pacotes disponíveis (is_active + is_available_for_sale)
//   3. Modal de confirmação → redireciona ao Stripe Checkout
//   4. Histórico de pedidos da empresa
//
// SEGURANÇA:
//   - company_id NUNCA enviado no body — resolvido via JWT no backend
//   - package_id validado no backend antes de qualquer operação
//   - Valores financeiros nunca vêm do frontend
//   - ?credits=success é APENAS feedback visual — créditos são liberados pelo webhook
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { ShoppingCart, Zap, MessageSquare, CheckCircle2, Clock, XCircle, AlertCircle, Loader2, X, Package, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Constantes ────────────────────────────────────────────────────────────────

const CREDITS_PER_CONVERSATION = 50

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface CreditPackage {
  id:                      string
  name:                    string
  credits:                 number
  price:                   number
  estimated_conversations: number
}

interface CreditOrder {
  id:           string
  package_name: string
  credits:      number
  price:        number
  status:       'pending_payment' | 'checkout_created' | 'paid' | 'failed' | 'cancelled' | 'expired'
  paid_at:      string | null
  created_at:   string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')
  return {
    Authorization:  `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatCredits(n: number): string {
  return n.toLocaleString('pt-BR')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<CreditOrder['status'], string> = {
  pending_payment:  'Aguardando pagamento',
  checkout_created: 'Checkout iniciado',
  paid:             'Pago',
  failed:           'Falha',
  cancelled:        'Cancelado',
  expired:          'Expirado',
}

const STATUS_COLORS: Record<CreditOrder['status'], string> = {
  pending_payment:  'bg-amber-50 text-amber-700 border border-amber-200',
  checkout_created: 'bg-blue-50 text-blue-700 border border-blue-200',
  paid:             'bg-green-50 text-green-700 border border-green-200',
  failed:           'bg-red-50 text-red-700 border border-red-200',
  cancelled:        'bg-slate-50 text-slate-600 border border-slate-200',
  expired:          'bg-slate-50 text-slate-500 border border-slate-200',
}

function StatusIcon({ status }: { status: CreditOrder['status'] }) {
  switch (status) {
    case 'paid':             return <CheckCircle2 size={12} className="text-green-600" />
    case 'pending_payment':
    case 'checkout_created': return <Clock size={12} className="text-amber-600" />
    case 'failed':           return <XCircle size={12} className="text-red-600" />
    default:                 return <AlertCircle size={12} className="text-slate-500" />
  }
}

// ── Modal de confirmação → Stripe ─────────────────────────────────────────────

function ConfirmModal({
  pkg,
  loading,
  onConfirm,
  onClose,
}: {
  pkg:       CreditPackage
  loading:   boolean
  onConfirm: () => void
  onClose:   () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Confirmar compra</h3>
            <p className="text-xs text-slate-400 mt-0.5">Você será redirecionado ao Stripe para pagamento</p>
          </div>
          <button onClick={onClose} disabled={loading}
            className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-violet-600" />
              <span className="font-semibold text-violet-900">{pkg.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-violet-500 mb-0.5">Créditos</p>
                <p className="font-semibold text-violet-800 tabular-nums">{formatCredits(pkg.credits)}</p>
              </div>
              <div>
                <p className="text-xs text-violet-500 mb-0.5">Conversas est.</p>
                <p className="font-semibold text-violet-800 tabular-nums">≈ {formatCredits(pkg.estimated_conversations)}</p>
              </div>
            </div>
            <div className="border-t border-violet-200 pt-3 flex items-center justify-between">
              <span className="text-sm text-violet-700">Valor total</span>
              <span className="text-lg font-bold text-violet-900">{formatPrice(pkg.price)}</span>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Os créditos serão creditados automaticamente após a confirmação do pagamento pelo Stripe.
            Créditos extras acumulam entre meses e não expiram.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Aguarde...' : 'Ir para pagamento'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Card de pacote ────────────────────────────────────────────────────────────

function PackageCard({ pkg, onBuy }: { pkg: CreditPackage; onBuy: (pkg: CreditPackage) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4 hover:border-violet-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900">{pkg.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">Créditos extras permanentes</p>
        </div>
        <div className="flex-shrink-0 w-9 h-9 bg-violet-100 rounded-lg flex items-center justify-center">
          <Zap size={16} className="text-violet-600" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-slate-900 tabular-nums">{formatCredits(pkg.credits)}</span>
          <span className="text-sm text-slate-500">créditos</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MessageSquare size={12} />
          <span>≈ {formatCredits(pkg.estimated_conversations)} conversas</span>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
        <span className="text-xl font-bold text-slate-900">{formatPrice(pkg.price)}</span>
        <button
          onClick={() => onBuy(pkg)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors font-medium"
        >
          <ShoppingCart size={14} />
          Comprar
        </button>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  companyId: string
}

export function CreditPackagesPanel({ companyId }: Props) {
  // ── Estado: pacotes ───────────────────────────────────────────────────────
  const [packages,     setPackages]     = useState<CreditPackage[]>([])
  const [loadingPkgs,  setLoadingPkgs]  = useState(true)
  const [errorPkgs,    setErrorPkgs]    = useState<string | null>(null)

  // ── Estado: pedidos ───────────────────────────────────────────────────────
  const [orders,       setOrders]       = useState<CreditOrder[]>([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [errorOrders,  setErrorOrders]  = useState<string | null>(null)
  const [totalOrders,  setTotalOrders]  = useState(0)

  // ── Estado: compra ────────────────────────────────────────────────────────
  const [selectedPkg,  setSelectedPkg]  = useState<CreditPackage | null>(null)
  const [buying,       setBuying]       = useState(false)
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null)
  const [errorBuy,     setErrorBuy]     = useState<string | null>(null)

  // ── Detectar retorno do Stripe (?credits=success) ─────────────────────────
  // Apenas feedback visual — créditos são liberados pelo webhook, não por este param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('credits') === 'success') {
      setSuccessMsg('Pagamento recebido! Seus créditos serão liberados em instantes pelo sistema.')
      // Limpar o param da URL sem recarregar a página
      params.delete('credits')
      params.delete('session_id')
      const newSearch = params.toString()
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '')
      window.history.replaceState({}, '', newUrl)
      // Atualizar histórico de pedidos após retorno
      void loadOrders()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Carregar pacotes ──────────────────────────────────────────────────────

  const loadPackages = useCallback(async () => {
    setLoadingPkgs(true)
    setErrorPkgs(null)
    try {
      const headers = await getAuthHeaders()
      const res     = await fetch(`/api/credit-orders/packages?company_id=${encodeURIComponent(companyId)}`, { headers })
      const json    = await res.json().catch(() => ({})) as Record<string, unknown>

      if (!res.ok || !json.ok) {
        throw new Error((json.error as string) || `Erro ${res.status}`)
      }

      setPackages((json.data as CreditPackage[]) ?? [])
    } catch (err) {
      setErrorPkgs(err instanceof Error ? err.message : 'Erro ao carregar pacotes')
    } finally {
      setLoadingPkgs(false)
    }
  }, [companyId])

  // ── Carregar histórico de pedidos ─────────────────────────────────────────

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    setErrorOrders(null)
    try {
      const headers = await getAuthHeaders()
      const res     = await fetch(`/api/credit-orders?company_id=${encodeURIComponent(companyId)}&limit=10&offset=0`, { headers })
      const json    = await res.json().catch(() => ({})) as Record<string, unknown>

      if (!res.ok || !json.ok) {
        throw new Error((json.error as string) || `Erro ${res.status}`)
      }

      setOrders((json.data as CreditOrder[]) ?? [])
      setTotalOrders((json.total as number) ?? 0)
    } catch (err) {
      setErrorOrders(err instanceof Error ? err.message : 'Erro ao carregar histórico')
    } finally {
      setLoadingOrders(false)
    }
  }, [companyId])

  useEffect(() => {
    void loadPackages()
    void loadOrders()
  }, [loadPackages, loadOrders])

  // ── Iniciar checkout Stripe ───────────────────────────────────────────────

  async function handleConfirmBuy() {
    if (!selectedPkg) return
    setBuying(true)
    setErrorBuy(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`/api/credit-orders/checkout?company_id=${encodeURIComponent(companyId)}`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ package_id: selectedPkg.id }),
      })
      const json = await res.json().catch(() => ({})) as Record<string, unknown>

      if (!res.ok || !json.ok) {
        throw new Error((json.error as string) || `Erro ${res.status}`)
      }

      const checkoutUrl = json.checkout_url as string | undefined
      if (!checkoutUrl) {
        throw new Error('URL de checkout não recebida. Tente novamente.')
      }

      // Redirecionar ao Stripe — página sairá, selectedPkg não precisa ser limpo
      window.location.href = checkoutUrl

    } catch (err) {
      setErrorBuy(err instanceof Error ? err.message : 'Erro ao iniciar checkout')
      setBuying(false)
    }
    // Nota: setBuying(false) não é chamado no sucesso pois a página redireciona
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* ── Mensagens globais ─────────────────────────────────────────────── */}
      {successMsg && (
        <div className="px-4 py-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg flex items-start gap-2">
          <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5 text-green-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorBuy && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-start gap-2">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-red-600" />
          <span>{errorBuy}</span>
          <button onClick={() => setErrorBuy(null)} className="ml-auto flex-shrink-0 text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Pacotes disponíveis ───────────────────────────────────────────── */}
      <div>
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Pacotes disponíveis</h3>
          <p className="text-sm text-slate-500 mt-0.5">Créditos extras acumulativos, sem expiração.</p>
        </div>

        {loadingPkgs ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 animate-pulse">
                <div className="flex justify-between">
                  <div className="space-y-2">
                    <div className="h-4 w-24 bg-slate-100 rounded" />
                    <div className="h-3 w-32 bg-slate-100 rounded" />
                  </div>
                  <div className="w-9 h-9 bg-slate-100 rounded-lg" />
                </div>
                <div className="h-8 w-20 bg-slate-100 rounded" />
                <div className="h-9 bg-slate-100 rounded-lg" />
              </div>
            ))}
          </div>
        ) : errorPkgs ? (
          <div className="text-center py-10 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
            {errorPkgs}
          </div>
        ) : packages.length === 0 ? (
          <div className="text-center py-10 text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg">
            Nenhum pacote disponível para compra no momento.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {packages.map(pkg => (
              <PackageCard key={pkg.id} pkg={pkg} onBuy={setSelectedPkg} />
            ))}
          </div>
        )}
      </div>

      {/* ── Histórico de pedidos ──────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Histórico de pedidos</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {totalOrders > 0 ? `${totalOrders} pedido${totalOrders !== 1 ? 's' : ''} encontrado${totalOrders !== 1 ? 's' : ''}` : 'Nenhum pedido registrado'}
            </p>
          </div>
          <button
            onClick={() => { void loadOrders() }}
            disabled={loadingOrders}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loadingOrders ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {loadingOrders ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-4 py-4 flex items-center gap-4 animate-pulse">
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 bg-slate-100 rounded" />
                    <div className="h-3 w-48 bg-slate-100 rounded" />
                  </div>
                  <div className="h-6 w-20 bg-slate-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : errorOrders ? (
            <div className="px-4 py-8 text-center text-sm text-red-600">
              {errorOrders}
            </div>
          ) : orders.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              Nenhum pedido registrado ainda.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Pacote</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500">Créditos</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500">Valor</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-slate-500">Status</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">{order.package_name}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {formatCredits(order.credits)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {formatPrice(order.price)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status]}`}>
                          <StatusIcon status={order.status} />
                          {STATUS_LABELS[order.status]}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">
                      {formatDate(order.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Modal de confirmação ──────────────────────────────────────────── */}
      {selectedPkg && (
        <ConfirmModal
          pkg={selectedPkg}
          loading={buying}
          onConfirm={handleConfirmBuy}
          onClose={() => { if (!buying) setSelectedPkg(null) }}
        />
      )}
    </div>
  )
}

export default CreditPackagesPanel
