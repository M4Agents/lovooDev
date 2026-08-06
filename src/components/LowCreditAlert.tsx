// =============================================================================
// src/components/LowCreditAlert.tsx
//
// Modal de alerta global para saldo baixo de créditos de IA.
//
// REGRAS:
//   - Visível APENAS para usuários com canPurchaseAiCredits (admin/system_admin/super_admin)
//   - Thresholds: 500 → 400 → 300 → 200 → 100 → 0
//   - Cada threshold dispara uma única vez por sessão (sessionStorage)
//   - Ao cruzar um threshold menor, o modal aparece novamente
//   - Botão "Comprar Créditos" navega para Settings → Planos e Uso → Comprar Créditos
//   - Botão "Fechar" descarta para a sessão atual naquele threshold
// =============================================================================

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, X, CreditCard, Zap } from 'lucide-react'

// ── Thresholds de alerta (decrescente) ────────────────────────────────────────

const ALERT_THRESHOLDS = [500, 400, 300, 200, 100, 0] as const
type AlertThreshold = typeof ALERT_THRESHOLDS[number]

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActiveThreshold(balance: number): AlertThreshold | null {
  for (const t of ALERT_THRESHOLDS) {
    if (balance <= t) return t
  }
  return null
}

function sessionKey(companyId: string, threshold: AlertThreshold): string {
  return `lowCredit_${companyId}_${threshold}`
}

function isDismissed(companyId: string, threshold: AlertThreshold): boolean {
  try {
    return sessionStorage.getItem(sessionKey(companyId, threshold)) === '1'
  } catch {
    return false
  }
}

function dismiss(companyId: string, threshold: AlertThreshold): void {
  try {
    sessionStorage.setItem(sessionKey(companyId, threshold), '1')
  } catch {
    // sessionStorage indisponível — ignorar silenciosamente
  }
}

// ── Configuração visual por nível ─────────────────────────────────────────────

interface LevelConfig {
  label: string
  icon: string
  borderColor: string
  headerBg: string
  headerText: string
  badgeBg: string
  badgeText: string
}

function getLevelConfig(threshold: AlertThreshold): LevelConfig {
  if (threshold === 0) {
    return {
      label: 'Créditos Esgotados',
      icon: '🔴',
      borderColor: 'border-red-300',
      headerBg: 'bg-red-50',
      headerText: 'text-red-800',
      badgeBg: 'bg-red-100',
      badgeText: 'text-red-700',
    }
  }
  if (threshold <= 100) {
    return {
      label: 'Créditos Críticos',
      icon: '🔴',
      borderColor: 'border-red-300',
      headerBg: 'bg-red-50',
      headerText: 'text-red-800',
      badgeBg: 'bg-red-100',
      badgeText: 'text-red-700',
    }
  }
  if (threshold <= 200) {
    return {
      label: 'Créditos Baixos',
      icon: '🟠',
      borderColor: 'border-orange-300',
      headerBg: 'bg-orange-50',
      headerText: 'text-orange-800',
      badgeBg: 'bg-orange-100',
      badgeText: 'text-orange-700',
    }
  }
  return {
    label: 'Atenção: Créditos Baixos',
    icon: '🟡',
    borderColor: 'border-amber-300',
    headerBg: 'bg-amber-50',
    headerText: 'text-amber-800',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  companyId: string
  totalCredits: number
  canPurchase: boolean
}

// ── Componente ────────────────────────────────────────────────────────────────

export function LowCreditAlert({ companyId, totalCredits, canPurchase }: Props) {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [activeThreshold, setActiveThreshold] = useState<AlertThreshold | null>(null)

  useEffect(() => {
    if (!canPurchase) return

    const threshold = getActiveThreshold(totalCredits)
    if (threshold === null) return
    if (isDismissed(companyId, threshold)) return

    setActiveThreshold(threshold)
    setVisible(true)
  }, [companyId, totalCredits, canPurchase])

  if (!visible || activeThreshold === null) return null

  const cfg = getLevelConfig(activeThreshold)

  function handleDismiss() {
    if (activeThreshold !== null) dismiss(companyId, activeThreshold)
    setVisible(false)
  }

  function handleBuy() {
    if (activeThreshold !== null) dismiss(companyId, activeThreshold)
    setVisible(false)
    navigate('/settings?tab=planos-uso&subtab=comprar-creditos')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={handleDismiss}
    >
      <div
        className={`bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border ${cfg.borderColor}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-4 ${cfg.headerBg} flex items-start justify-between gap-3`}>
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className={cfg.headerText} />
            <div>
              <h3 className={`text-sm font-semibold ${cfg.headerText}`}>
                {cfg.label}
              </h3>
              <p className={`text-xs mt-0.5 ${cfg.headerText} opacity-75`}>
                Saldo atual da empresa
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className={`${cfg.headerText} opacity-60 hover:opacity-100 transition-opacity flex-shrink-0`}
          >
            <X size={16} />
          </button>
        </div>

        {/* Corpo */}
        <div className="px-5 py-5 space-y-4">

          {/* Saldo atual */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-600">
              <Zap size={15} className="text-violet-500" />
              <span className="text-sm font-medium">Créditos disponíveis</span>
            </div>
            <span className={`text-lg font-bold tabular-nums ${totalCredits <= 0 ? 'text-red-600' : totalCredits <= 100 ? 'text-orange-600' : 'text-amber-600'}`}>
              {totalCredits.toLocaleString('pt-BR')}
            </span>
          </div>

          {/* Mensagem contextual */}
          <div className={`rounded-lg px-4 py-3 ${cfg.badgeBg}`}>
            {activeThreshold === 0 ? (
              <p className={`text-sm ${cfg.badgeText}`}>
                <strong>O agente de IA está sem créditos.</strong> Sem créditos disponíveis, as respostas automáticas podem ser interrompidas. Adquira créditos adicionais para manter o atendimento.
              </p>
            ) : (
              <p className={`text-sm ${cfg.badgeText}`}>
                O saldo de créditos está abaixo de <strong>{activeThreshold.toLocaleString('pt-BR')}</strong>. Para evitar interrupções no agente de IA, recomendamos adquirir créditos adicionais.
              </p>
            )}
          </div>

          {/* Botões */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleBuy}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <CreditCard size={15} />
              Comprar Créditos
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              Fechar
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
