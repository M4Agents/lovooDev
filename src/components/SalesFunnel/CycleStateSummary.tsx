import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, XCircle, Phone, Timer } from 'lucide-react'
import { contactCycleApi } from '../../services/contactCycleApi'
import { CycleStatusBadge } from './CycleStatusBadge'
import { getCloseReasonKey, CLOSE_REASON_OPTIONS } from '../../utils/cycleLabels'
import { useAuth } from '../../contexts/AuthContext'
import { ContactAttemptModal } from '../WhatsAppChat/ContactAttemptModal'
import type { ContactAttemptModalState } from '../../hooks/useContactCycleState'
import type { ContactCycleState } from '../../types/contact-cycles'

interface CycleStateSummaryProps {
  state:           ContactCycleState
  lastCloseReason: string | null
  canOperate:      boolean
  opportunityId:   string
  companyId:       string
  refresh:         () => void
}

function secondsSince(iso: string | null): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
}

function formatDuration(seconds: number): string {
  if (seconds < 60)  return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60)        return `${m}min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 24)        return rm > 0 ? `${h}h ${rm}min` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}

export function CycleStateSummary({
  state,
  lastCloseReason,
  canOperate,
  opportunityId,
  companyId,
  refresh,
}: CycleStateSummaryProps) {
  const { t }               = useTranslation('funnel')
  const { companyTimezone } = useAuth()

  const [showClose,   setShowClose]   = useState(false)
  const [closeReason, setCloseReason] = useState<'manual' | 'goal_reached' | 'no_response' | 'duplicate'>('manual')
  const [closing,     setClosing]     = useState(false)
  const [closeError,  setCloseError]  = useState<string | null>(null)

  const [attemptModalState, setAttemptModalState] = useState<ContactAttemptModalState | null>(null)

  const isOpen = state.contact_attempts_state === 'cycle_open'

  const canRegisterAttempt =
    canOperate &&
    (state.contact_attempts_state === 'cycle_open' || state.eligibility === 'eligible')

  const canClose = canOperate && isOpen

  const openSinceSeconds = isOpen ? secondsSince(state.last_agent_contact_at) : 0

  const handleOpenAttemptModal = () => {
    setAttemptModalState({
      opportunityId,
      whatsappMessageId: null,
      cycleState: {
        opportunity_id:               opportunityId,
        eligibility:                  state.eligibility,
        eligible_for_attempt:         true,
        contact_attempts_state:       state.contact_attempts_state,
        current_contact_cycle_id:     state.current_contact_cycle_id,
        current_cycle_attempts_count: state.current_cycle_attempts_count,
        total_contact_attempts_count: state.total_contact_attempts_count,
        last_contact_attempt_at:      null,
        eligible_for_new_cycle_at:    state.next_attempt_eligible_at,
        reason:                       '',
      },
    })
  }

  const fmtDate = (iso?: string | null): string => {
    if (!iso) return '—'
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: companyTimezone,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))
  }

  const handleCloseCycle = async () => {
    setClosing(true)
    setCloseError(null)
    try {
      await contactCycleApi.closeCycle(opportunityId, companyId, closeReason)
      setShowClose(false)
      refresh()
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : t('contactCycle.closeError'))
    } finally {
      setClosing(false)
    }
  }

  return (
    <>
      {/* ── Card de estado atual (estilo OpportunityStageTimeline) ── */}
      <div
        className="rounded-lg p-3 border"
        style={isOpen
          ? { backgroundColor: '#EEF2FF', borderColor: '#A5B4FC' }
          : { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' }}
      >
        {/* Linha superior: badge + duração + ações */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1 text-gray-500">
              {t('contactCycle.stateTitle')}
            </p>
            <div className="flex items-center gap-2">
              <CycleStatusBadge state={state.contact_attempts_state} />
              <span className="text-xs text-gray-500">
                {t('contactCycle.totalAttempts', { count: state.total_contact_attempts_count })}
              </span>
            </div>
            {isOpen && openSinceSeconds > 0 && (
              <div className="flex items-center gap-1 mt-1 text-xs text-indigo-600">
                <Timer className="w-3 h-3" />
                <span>{formatDuration(openSinceSeconds)}</span>
              </div>
            )}
          </div>

          {/* Botões de ação */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {canRegisterAttempt && (
              <button
                onClick={handleOpenAttemptModal}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 px-2 py-1 rounded transition-colors"
                title={t('contactCycle.registerAttemptBtn')}
              >
                <Phone className="w-3.5 h-3.5" />
                {t('contactCycle.registerAttemptBtn')}
              </button>
            )}
            {canClose && !showClose && (
              <button
                onClick={() => setShowClose(true)}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1 rounded transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
                {t('contactCycle.closeCycleBtn')}
              </button>
            )}
          </div>
        </div>

        {/* Grade de metadados */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mt-3">
          <div>
            <p className="text-gray-400">{t('contactCycle.lastAgentContact')}</p>
            <p className="text-gray-700 font-medium">{fmtDate(state.last_agent_contact_at)}</p>
          </div>
          <div>
            <p className="text-gray-400">{t('contactCycle.lastClientReply')}</p>
            <p className="text-gray-700 font-medium">{fmtDate(state.last_customer_reply_at)}</p>
          </div>
          {state.next_attempt_eligible_at && (
            <div>
              <p className="text-gray-400">{t('contactCycle.eligibleAt')}</p>
              <p className="text-gray-700 font-medium">{fmtDate(state.next_attempt_eligible_at)}</p>
            </div>
          )}
          {lastCloseReason && (
            <div>
              <p className="text-gray-400">{t('contactCycle.lastCloseReason')}</p>
              <p className="text-gray-700 font-medium">{t(getCloseReasonKey(lastCloseReason))}</p>
            </div>
          )}
        </div>

        {/* Painel inline de fechamento */}
        {showClose && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-xs font-semibold text-gray-700 mb-2">{t('contactCycle.closeCycleTitle')}</p>
            <div className="flex flex-col gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">{t('contactCycle.closeCycleReason')}</label>
                <select
                  value={closeReason}
                  onChange={e => setCloseReason(e.target.value as typeof closeReason)}
                  disabled={closing}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                >
                  {CLOSE_REASON_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
              </div>
              {closeError && <p className="text-xs text-red-600">{closeError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleCloseCycle}
                  disabled={closing}
                  className="flex items-center justify-center gap-1 flex-1 text-xs text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded disabled:opacity-50 transition-colors"
                >
                  {closing
                    ? <><Loader2 className="w-3 h-3 animate-spin" />{t('contactCycle.closeCycleLoading')}</>
                    : t('contactCycle.closeCycleConfirm')}
                </button>
                <button
                  onClick={() => { setShowClose(false); setCloseError(null) }}
                  disabled={closing}
                  className="flex-1 text-xs text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded disabled:opacity-50 transition-colors"
                >
                  {t('contactCycle.closeCycleCancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ContactAttemptModal
        companyId={companyId}
        modalState={attemptModalState}
        onClose={() => setAttemptModalState(null)}
        triggerReason="manual"
        onSuccess={refresh}
      />
    </>
  )
}
