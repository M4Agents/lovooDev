import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { XCircle, Loader2 } from 'lucide-react'
import { contactCycleApi } from '../../services/contactCycleApi'
import { getTriggerReasonKey } from '../../utils/cycleLabels'
import { AnswersList } from './AnswersList'
import type { ContactAttemptDetail } from '../../types/contact-cycles'

interface AttemptRowProps {
  attempt:       ContactAttemptDetail
  canOperate:    boolean
  opportunityId: string
  companyId:     string
  refresh:       () => void
}

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export function AttemptRow({
  attempt,
  canOperate,
  opportunityId,
  companyId,
  refresh,
}: AttemptRowProps) {
  const { t } = useTranslation('funnel')
  const [showConfirm, setShowConfirm] = useState(false)
  const [cancelling,  setCancelling]  = useState(false)

  const isCancelled = Boolean(attempt.cancelled_at)

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await contactCycleApi.cancelAttempt(opportunityId, attempt.attempt_id, companyId)
      refresh()
    } catch {
      // erro silenciado — dados ficam visíveis até o próximo refresh
    } finally {
      setCancelling(false)
      setShowConfirm(false)
    }
  }

  return (
    <div className={`rounded-lg p-3 text-sm ${isCancelled ? 'bg-red-50 border border-red-100' : 'bg-gray-50 border border-gray-100'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* trigger_reason */}
            <span className="font-medium text-gray-800">
              {t(getTriggerReasonKey(attempt.trigger_reason))}
            </span>

            {/* reason_label — motivo comercial */}
            {attempt.reason_label && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                {attempt.reason_label}
              </span>
            )}

            {/* badge cancelada */}
            {isCancelled && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                {t('contactCycle.attemptCancelledBadge')}
              </span>
            )}
          </div>

          {/* notas */}
          {attempt.notes && (
            <p className="text-xs text-gray-500 mt-1 italic">{attempt.notes}</p>
          )}

          {/* data */}
          <p className="text-xs text-gray-400 mt-1">{fmtDate(attempt.created_at)}</p>
        </div>

        {/* ação de cancelar — somente se ativa e com permissão */}
        {canOperate && !isCancelled && (
          <div className="flex-shrink-0">
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
              >
                {t('contactCycle.cancelAttemptBtn')}
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-600">{t('contactCycle.cancelAttemptConfirm')}</span>
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex items-center gap-1 text-xs text-white bg-red-600 hover:bg-red-700 px-2 py-1 rounded disabled:opacity-50 transition-colors"
                >
                  {cancelling
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <XCircle className="w-3 h-3" />}
                  {cancelling
                    ? t('contactCycle.cancelAttemptLoading')
                    : t('contactCycle.cancelAttemptConfirmYes')}
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={cancelling}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
                >
                  {t('contactCycle.cancelAttemptCancel')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <AnswersList answers={attempt.answers} />
    </div>
  )
}
