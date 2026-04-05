// =====================================================
// COMPONENTE: ReopenOpportunityModal
// Objetivo: Modal de confirmação ao mover oportunidade
//           de etapa won/lost de volta para active.
//           Informa ao usuário o que será preservado
//           e o que será alterado na reabertura.
// =====================================================

import { Loader2, RotateCcw, AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReopenOpportunityParams } from '../../types/sales-funnel'

interface ReopenOpportunityModalProps {
  isOpen: boolean
  opportunityTitle: string
  currentStatus: 'won' | 'lost'
  closedAt?: string
  opportunityId: string
  funnelId: string
  toStageId: string
  positionInStage: number
  companyId: string
  onConfirm: (params: ReopenOpportunityParams) => Promise<void>
  onCancel: () => void
}

export const ReopenOpportunityModal: React.FC<ReopenOpportunityModalProps> = ({
  isOpen,
  opportunityTitle,
  currentStatus,
  closedAt,
  opportunityId,
  funnelId,
  toStageId,
  positionInStage,
  companyId,
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation('funnel')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const formatClosedDate = (iso?: string): string => {
    if (!iso) return t('reopenOpportunity.dateUnknown')
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(iso))
  }

  if (!isOpen) return null

  const statusLabel = currentStatus === 'won' ? t('reopenOpportunity.statusWon') : t('reopenOpportunity.statusLost')

  const handleConfirm = async () => {
    setError(undefined)
    setLoading(true)
    try {
      await onConfirm({
        opportunity_id:    opportunityId,
        funnel_id:         funnelId,
        to_stage_id:       toStageId,
        position_in_stage: positionInStage,
        company_id:        companyId
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reopenOpportunity.errorGeneric'))
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
        <div className="flex items-center gap-3 p-5 border-b border-amber-100 bg-amber-50 rounded-t-xl">
          <div className="p-2 rounded-lg bg-amber-100">
            <RotateCcw className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-amber-900">{t('reopenOpportunity.title')}</h2>
            <p className="text-sm text-gray-500 truncate">{opportunityTitle}</p>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* Contexto atual */}
          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-gray-700 space-y-1">
              <p>
                {t('reopenOpportunity.introPrefix')}{' '}
                <span className="font-semibold">{statusLabel}</span>
                {closedAt && (
                  <span>
                    {t('reopenOpportunity.introDate', {
                      date: formatClosedDate(closedAt),
                      interpolation: { escapeValue: false },
                    })}
                  </span>
                )}.
              </p>
              <p className="text-gray-500">
                {t('reopenOpportunity.willOpen')}{' '}
                <span className="font-medium text-gray-700">{t('reopenOpportunity.statusOpen')}</span>.
              </p>
            </div>
          </div>

          {/* O que acontece */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('reopenOpportunity.changesHeading')}</p>
            <ul className="space-y-1.5 text-sm text-gray-600">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                {t('reopenOpportunity.change1')}{' '}
                <span className="font-medium text-gray-800">{t('reopenOpportunity.change1b')}</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                {t('reopenOpportunity.change2')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                {t('reopenOpportunity.change3')}
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('reopenOpportunity.preservedHeading')}</p>
            <ul className="space-y-1.5 text-sm text-gray-600">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                {t('reopenOpportunity.preserve1')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                {t('reopenOpportunity.preserve2')}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                {t('reopenOpportunity.preserve3')}
              </li>
            </ul>
          </div>

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
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('reopenOpportunity.confirmReopen')}
          </button>
        </div>

      </div>
    </div>
  )
}
