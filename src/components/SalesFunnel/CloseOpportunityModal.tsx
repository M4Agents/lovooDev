// =====================================================
// COMPONENTE: CloseOpportunityModal
// Objetivo: Modal de confirmação ao mover oportunidade
//           para etapa com stage_type = 'won' ou 'lost'.
//           Coleta data/hora de fechamento, valor final
//           (won) e motivo de perda (lost).
// =====================================================

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Loader2, TrendingUp, TrendingDown, DollarSign, Calendar, MessageSquare } from 'lucide-react'
import type { CloseOpportunityParams } from '../../types/sales-funnel'

// Converte centavos (inteiro) para string formatada em pt-BR (ex: 150050 → "1.500,50")
const centsToBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Extrai centavos de uma string formatada (ex: "1.500,50" → 150050)
const brlToCents = (formatted: string): number =>
  parseInt(formatted.replace(/\D/g, '') || '0', 10)

interface CloseOpportunityModalProps {
  isOpen: boolean
  stageType: 'won' | 'lost'
  opportunityTitle: string
  currentValue: number
  /** ISO 4217 — exibe no rótulo; valor já está na moeda da oportunidade */
  currencyCode?: string
  opportunityId: string
  funnelId: string
  toStageId: string
  positionInStage: number
  companyId: string
  onConfirm: (params: CloseOpportunityParams) => Promise<void>
  onCancel: () => void
}

const toLocalDateTimeInput = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const CloseOpportunityModal: React.FC<CloseOpportunityModalProps> = ({
  isOpen,
  stageType,
  opportunityTitle,
  currentValue,
  currencyCode = 'BRL',
  opportunityId,
  funnelId,
  toStageId,
  positionInStage,
  companyId,
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation('funnel')
  const isWon = stageType === 'won'

  const [closeDate, setCloseDate] = useState('')
  const [displayValue, setDisplayValue] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  // Preencher valores padrão ao abrir
  useEffect(() => {
    if (isOpen) {
      setCloseDate(toLocalDateTimeInput(new Date()))
      setDisplayValue(currentValue > 0 ? centsToBRL(Math.round(currentValue * 100)) : '')
      setLossReason('')
      setError(undefined)
    }
  }, [isOpen, currentValue])

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cents = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
    setDisplayValue(cents === 0 ? '' : centsToBRL(cents))
  }

  if (!isOpen) return null

  const handleConfirm = async () => {
    setError(undefined)
    setLoading(true)

    try {
      const closedAtISO = closeDate
        ? new Date(closeDate).toISOString()
        : new Date().toISOString()

      await onConfirm({
        opportunity_id:    opportunityId,
        funnel_id:         funnelId,
        to_stage_id:       toStageId,
        position_in_stage: positionInStage,
        to_status:         stageType,
        value:             brlToCents(displayValue) / 100 || currentValue,
        loss_reason:       lossReason.trim() || undefined,
        closed_at:         closedAtISO,
        company_id:        companyId
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('closeOpportunity.errorGeneric'))
    } finally {
      setLoading(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !loading) onCancel()
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onMouseDown={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`flex items-center gap-3 p-5 border-b rounded-t-xl ${isWon ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
          <div className={`p-2 rounded-lg ${isWon ? 'bg-emerald-100' : 'bg-red-100'}`}>
            {isWon
              ? <TrendingUp className="w-5 h-5 text-emerald-600" />
              : <TrendingDown className="w-5 h-5 text-red-600" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h2 className={`text-base font-semibold ${isWon ? 'text-emerald-900' : 'text-red-900'}`}>
              {isWon ? t('closeOpportunity.confirmWon') : t('closeOpportunity.confirmLost')}
            </h2>
            <p className="text-sm text-gray-500 truncate">{opportunityTitle}</p>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            className="p-1.5 hover:bg-white rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* Data/hora de fechamento */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
              <Calendar className="w-4 h-4 text-gray-400" />
              {t('closeOpportunity.closeDateTime')}
            </label>
            <input
              type="datetime-local"
              value={closeDate}
              onChange={e => setCloseDate(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>

          {/* Valor final — apenas para won */}
          {isWon && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                <DollarSign className="w-4 h-4 text-gray-400" />
                {t('closeOpportunity.saleValue', { code: currencyCode })}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={displayValue}
                onChange={handleValueChange}
                disabled={loading}
                placeholder={t('createOpportunity.fields.valuePlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-400 mt-1">
                {t('closeOpportunity.saleValueHint')}
              </p>
            </div>
          )}

          {/* Motivo da perda — apenas para lost */}
          {!isWon && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                <MessageSquare className="w-4 h-4 text-gray-400" />
                {t('closeOpportunity.lossReason')}
                <span className="text-gray-400 font-normal">{t('closeOpportunity.optional')}</span>
              </label>
              <textarea
                value={lossReason}
                onChange={e => setLossReason(e.target.value)}
                disabled={loading}
                rows={3}
                placeholder={t('closeOpportunity.lossReasonPlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 resize-none"
              />
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-red-600 text-sm">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 pt-0">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {t('form.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
              isWon
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isWon ? t('closeOpportunity.confirmWonBtn') : t('closeOpportunity.confirmLostBtn')}
          </button>
        </div>

      </div>
    </div>
  )
}
