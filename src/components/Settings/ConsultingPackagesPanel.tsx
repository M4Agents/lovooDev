// =============================================================================
// src/components/Settings/ConsultingPackagesPanel.tsx
//
// Página comercial de Pacotes de Consultoria.
//
// BLOCOS (em ordem):
//   1. Banner de sucesso pós-checkout (?consulting=success — visual apenas)
//   2. Hero comercial com promessa e subtítulo
//   3. Seção "Como funciona" — 4 passos pós-compra
//   4. Cards de oferta — com campos comerciais e fallbacks
//   5. Saldo consultivo atual (horas disponíveis)
//   6. Histórico de pedidos
//
// FALLBACKS OBRIGATÓRIOS:
//   - sem headline    → usa name
//   - sem subheadline → usa description
//   - sem features    → usa description como parágrafo
//   - sem cta_text    → "Comprar pacote"
//   - sem badge_text  → sem badge
//
// SEGURANÇA:
//   - company_id NUNCA enviado no body — resolvido via JWT no backend
//   - ?consulting=success é APENAS feedback visual
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import {
  Clock, CheckCircle2, XCircle, AlertCircle, Loader2,
  RefreshCw, Star, Rocket, ShieldCheck, CalendarCheck,
  Zap, ChevronDown, ChevronUp,
} from 'lucide-react'
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

const packageTypeColor: Record<string, string> = {
  implementation: 'text-blue-700 bg-blue-100 border-blue-200',
  training:       'text-emerald-700 bg-emerald-100 border-emerald-200',
  consulting:     'text-violet-700 bg-violet-100 border-violet-200',
}

const statusConfig: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  pending_payment:  { label: 'Aguardando',   icon: <AlertCircle size={14} />,  cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  checkout_created: { label: 'Em andamento', icon: <Loader2 size={14} className="animate-spin" />, cls: 'text-blue-600 bg-blue-50 border-blue-200' },
  paid:             { label: 'Pago',         icon: <CheckCircle2 size={14} />, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  failed:           { label: 'Falhou',       icon: <XCircle size={14} />,      cls: 'text-red-600 bg-red-50 border-red-200' },
  cancelled:        { label: 'Cancelado',    icon: <XCircle size={14} />,      cls: 'text-slate-500 bg-slate-50 border-slate-200' },
  expired:          { label: 'Expirado',     icon: <XCircle size={14} />,      cls: 'text-slate-500 bg-slate-50 border-slate-200' },
}

const MAX_FEATURES_SHOWN = 5

// ── Badge de status ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { label: status, icon: null, cls: 'text-slate-600 bg-slate-50 border-slate-200' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

// ── Card de oferta ────────────────────────────────────────────────────────────

interface OfferCardProps {
  pkg:      ConsultingPackage
  onSelect: (pkg: ConsultingPackage) => void
}

function OfferCard({ pkg, onSelect }: OfferCardProps) {
  const [expanded, setExpanded] = useState(false)

  const headline   = pkg.headline   || pkg.name
  const subtitle   = pkg.subheadline || pkg.description
  const ctaText    = pkg.cta_text   || 'Comprar pacote'
  const features   = pkg.features
  const bonusCredits = pkg.bonus_credit?.credits

  const visibleFeatures = features
    ? (expanded ? features : features.slice(0, MAX_FEATURES_SHOWN))
    : null
  const hiddenCount = features ? Math.max(0, features.length - MAX_FEATURES_SHOWN) : 0

  const typeColor = packageTypeColor[pkg.package_type] ?? 'text-slate-600 bg-slate-50 border-slate-200'

  return (
    <div
      className={`
        relative flex flex-col rounded-2xl border transition-all duration-200
        ${pkg.is_highlighted
          ? 'border-blue-400 shadow-xl shadow-blue-100 bg-gradient-to-b from-white to-blue-50/40 ring-2 ring-blue-300/40'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
        }
      `}
    >
      {/* Badge de recomendação */}
      {pkg.badge_text && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md whitespace-nowrap">
            {pkg.badge_text}
          </span>
        </div>
      )}

      <div className="p-6 flex flex-col flex-1 gap-4">

        {/* Tipo + horas */}
        <div className="flex items-center justify-between">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${typeColor}`}>
            {packageTypeLabel[pkg.package_type] ?? pkg.package_type}
          </span>
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <Clock size={14} className="text-slate-400" />
            {formatHours(pkg.hours)}
          </span>
        </div>

        {/* Headline */}
        <div>
          <h3 className="text-lg font-bold text-slate-900 leading-snug">{headline}</h3>
          {subtitle && (
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{subtitle}</p>
          )}
        </div>

        {/* Lista de benefícios */}
        {visibleFeatures && visibleFeatures.length > 0 ? (
          <ul className="space-y-2">
            {visibleFeatures.map((feat, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                <span>{feat}</span>
              </li>
            ))}
          </ul>
        ) : subtitle && !features ? (
          // Sem features e sem subheadline — description já exibido acima
          null
        ) : null}

        {/* Mostrar mais/menos benefícios */}
        {hiddenCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition self-start"
          >
            {expanded
              ? <><ChevronUp size={13} />Mostrar menos</>
              : <><ChevronDown size={13} />+{hiddenCount} benefício{hiddenCount > 1 ? 's' : ''}</>
            }
          </button>
        )}

        {/* Bônus IA */}
        {bonusCredits && (
          <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5">
            <Star size={15} className="text-violet-500 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-violet-800">
                +{bonusCredits.toLocaleString('pt-BR')} créditos de IA inclusos
              </p>
              <p className="text-xs text-violet-500 mt-0.5">
                Creditados automaticamente após o pagamento
              </p>
            </div>
          </div>
        )}

        {/* Preço + CTA */}
        <div className="mt-auto pt-4 border-t border-slate-100">
          <p className="text-2xl font-extrabold text-slate-900 mb-3">{formatPrice(pkg.price)}</p>
          <button
            onClick={() => onSelect(pkg)}
            className={`
              w-full py-2.5 px-4 rounded-xl font-semibold text-sm transition-all duration-200
              ${pkg.is_highlighted
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-blue-200'
                : 'bg-slate-900 hover:bg-slate-700 text-white'
              }
            `}
          >
            {ctaText}
          </button>
        </div>

      </div>
    </div>
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
  const ctaText      = pkg.cta_text || 'Comprar pacote'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Confirmar compra</h3>
          <p className="text-sm text-slate-500 mt-1">Você será redirecionado ao Stripe para pagamento seguro</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 space-y-2.5 border border-slate-200">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${packageTypeColor[pkg.package_type] ?? 'text-slate-600 bg-slate-50 border-slate-200'}`}>
              {packageTypeLabel[pkg.package_type] ?? pkg.package_type}
            </span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Clock size={12} />{formatHours(pkg.hours)}
            </span>
          </div>
          <p className="font-semibold text-slate-800">{pkg.name}</p>
          {bonusCredits && (
            <p className="text-xs text-violet-600 flex items-center gap-1.5">
              <Star size={12} />
              +{bonusCredits.toLocaleString('pt-BR')} créditos de IA inclusos
            </p>
          )}
          <p className="text-xl font-extrabold text-slate-900 pt-1">{formatPrice(pkg.price)}</p>
        </div>

        <div className="flex items-start gap-2.5 text-xs text-slate-500 bg-slate-50 rounded-xl p-3 border border-slate-100">
          <ShieldCheck size={14} className="text-emerald-500 mt-0.5 shrink-0" />
          <p>
            Horas e bônus são creditados automaticamente após a confirmação do Stripe.
            Créditos extras acumulam e não expiram.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 flex items-center gap-1.5">
            <AlertCircle size={14} />{error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 text-slate-700 font-medium text-sm hover:bg-slate-50 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Aguarde...' : ctaText}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Seção "Como funciona" ─────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  {
    icon: <Rocket size={20} className="text-blue-600" />,
    title: 'Escolha o pacote',
    desc:  'Selecione o pacote ideal para sua etapa: implantação, treinamento ou consultoria.',
  },
  {
    icon: <ShieldCheck size={20} className="text-emerald-600" />,
    title: 'Pagamento seguro',
    desc:  'Realize o pagamento com segurança pelo Stripe. Cartão ou Pix aceitos.',
  },
  {
    icon: <CalendarCheck size={20} className="text-violet-600" />,
    title: 'Agendamos a sessão',
    desc:  'Nossa equipe entra em contato para agendar a primeira sessão.',
  },
  {
    icon: <Zap size={20} className="text-amber-500" />,
    title: 'Horas no seu saldo',
    desc:  'As horas ficam disponíveis imediatamente após a confirmação do pagamento.',
  },
]

// ── Painel principal ──────────────────────────────────────────────────────────

interface Props {
  companyId: string
}

export function ConsultingPackagesPanel({ companyId }: Props) {
  const [packages, setPackages]         = useState<ConsultingPackage[]>([])
  const [orders, setOrders]             = useState<ConsultingOrder[]>([])
  const [balance, setBalance]           = useState<ConsultingBalance | null>(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [selectedPkg, setSelectedPkg]   = useState<ConsultingPackage | null>(null)
  const [buying, setBuying]             = useState(false)
  const [buyError, setBuyError]         = useState<string | null>(null)
  const [showSuccess, setShowSuccess]   = useState(false)
  const [showOrders, setShowOrders]     = useState(false)

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
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-blue-400" />
      </div>
    )
  }

  const hasPaidOrders = orders.some((o) => o.status === 'paid')
  const hasBalance    = balance && balance.total_credited_minutes > 0

  return (
    <div className="space-y-10">

      {/* 1. Banner de sucesso pós-checkout */}
      {showSuccess && (
        <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3.5">
          <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Pagamento processado com sucesso!</p>
            <p className="text-xs text-emerald-600 mt-0.5">As horas serão creditadas após a confirmação pelo Stripe. Isso costuma levar alguns instantes.</p>
          </div>
          <button onClick={() => setShowSuccess(false)} className="ml-auto text-emerald-400 hover:text-emerald-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* 2. Hero comercial */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-8 text-white">
        {/* Decorativo */}
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/5 rounded-full" />
        <div className="absolute -right-4 -bottom-8 w-32 h-32 bg-white/5 rounded-full" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 text-white/90 text-xs font-medium px-3 py-1 rounded-full mb-4">
            <Rocket size={12} />Implementação & Consultoria
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold leading-tight mb-3">
            Implantamos o CRM para você —<br className="hidden sm:block" /> sem complicação
          </h2>
          <p className="text-blue-100 text-sm sm:text-base max-w-xl leading-relaxed">
            Escolha o pacote ideal para configurar, treinar sua equipe e acelerar seus resultados com o Lovoo CRM. Nossa equipe especializada cuida de tudo.
          </p>
        </div>
      </div>

      {/* 3. Como funciona */}
      <div>
        <h3 className="text-base font-semibold text-slate-700 mb-4">Como funciona</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {HOW_IT_WORKS.map((step, i) => (
            <div key={i} className="bg-slate-50 border border-slate-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs font-bold text-slate-400">{i + 1}</span>
                <div className="p-1.5 bg-white rounded-lg border border-slate-100 shadow-sm">
                  {step.icon}
                </div>
              </div>
              <p className="text-sm font-semibold text-slate-800 mb-1">{step.title}</p>
              <p className="text-xs text-slate-500 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Cards de oferta */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-semibold text-slate-800">Escolha seu pacote</h3>
          <button onClick={loadAll} className="text-slate-400 hover:text-slate-600 transition" title="Atualizar">
            <RefreshCw size={15} />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
            <AlertCircle size={16} />{error}
          </div>
        )}

        {packages.length === 0 ? (
          <div className="text-center py-12 text-slate-400 bg-slate-50 rounded-2xl border border-slate-100">
            <Rocket size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Nenhum pacote disponível no momento.</p>
            <p className="text-xs mt-1">Entre em contato com o suporte para mais informações.</p>
          </div>
        ) : (
          <div className={`grid gap-6 ${
            packages.length === 1
              ? 'grid-cols-1 max-w-sm'
              : packages.length === 2
              ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          }`}>
            {packages.map((pkg) => (
              <OfferCard
                key={pkg.id}
                pkg={pkg}
                onSelect={(p) => { setSelectedPkg(p); setBuyError(null) }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 5. Saldo consultivo — só exibe se houver horas contratadas */}
      {hasBalance && (
        <div className="bg-gradient-to-br from-slate-50 to-blue-50/50 border border-slate-200 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Clock size={16} className="text-blue-500" />Seu saldo de horas consultivas
          </h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-white rounded-xl border border-blue-100 shadow-sm py-4 px-2">
              <p className="text-2xl font-extrabold text-blue-700">{formatHours(balance.available_hours)}</p>
              <p className="text-xs text-slate-500 mt-1">Disponíveis</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm py-4 px-2">
              <p className="text-2xl font-extrabold text-slate-700">{formatHours(balance.total_credited_hours)}</p>
              <p className="text-xs text-slate-500 mt-1">Contratadas</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm py-4 px-2">
              <p className="text-2xl font-extrabold text-slate-600">{formatHours(balance.used_hours)}</p>
              <p className="text-xs text-slate-500 mt-1">Utilizadas</p>
            </div>
          </div>
        </div>
      )}

      {/* 6. Histórico de pedidos — colapsável */}
      {orders.length > 0 && (
        <div>
          <button
            onClick={() => setShowOrders((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition mb-3"
          >
            {showOrders ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Histórico de pedidos
            <span className="text-xs font-normal text-slate-400 ml-1">({orders.length} pedido{orders.length > 1 ? 's' : ''})</span>
          </button>

          {showOrders && (
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
                          ? <span className="text-violet-600">+{o.bonus_credits_snapshot.toLocaleString('pt-BR')} créditos</span>
                          : '—'}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDateTime(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Atalho para expandir histórico se o cliente tiver pedidos pagos mas histórico fechado */}
          {!showOrders && hasPaidOrders && (
            <p className="text-xs text-slate-400">Clique para ver seus {orders.length} pedido{orders.length > 1 ? 's' : ''}.</p>
          )}
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
