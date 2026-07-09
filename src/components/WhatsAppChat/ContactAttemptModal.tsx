// =====================================================
// ContactAttemptModal
//
// Modal para registro de tentativa de contato.
// Suporta dois fluxos:
//   - Automático: disparado após envio de mensagem WhatsApp (trigger_reason: 'whatsapp_sent')
//   - Manual: disparado pelo vendedor após ligação ou contato fora do WhatsApp (trigger_reason: 'manual')
//
// Fluxo automático:
//   1. ChatArea chama triggerCheck → useContactCycleState preenche modalState
//   2. Este modal lê modalState e se torna visível
//
// Fluxo manual:
//   1. Vendedor clica em "Registrar tentativa" em OpportunitiesSection ou CycleStateSummary
//   2. Componente pai monta modalState com opportunityId e cycleState
//   3. Passa triggerReason='manual' e onSuccess=refresh
//
// Garantias:
//   - "Agora não" e X sempre funcionam (nunca bloqueados)
//   - Perguntas required bloqueiam APENAS o botão "Registrar"
//   - Nenhuma chamada Supabase direta — apenas via service
//   - Nenhum ciclo é aberto manualmente no frontend
// =====================================================

import { useState, useEffect } from 'react'
import { X, Loader2, MessageSquare, AlertCircle, Phone } from 'lucide-react'
import { contactCycleApi } from '../../services/contactCycleApi'
import type { ContactAttemptModalState } from '../../hooks/useContactCycleState'
import type { ContactAttemptReason, ContactAttemptQuestion } from '../../types/contact-cycles'

// ── Props ────────────────────────────────────────────────────────

interface ContactAttemptModalProps {
  companyId: string
  /** null = modal fechado */
  modalState: ContactAttemptModalState | null
  /** Chamar para fechar sem registrar (dismiss ou sucesso) */
  onClose: () => void
  /**
   * Razão do trigger. Default: 'whatsapp_sent' (fluxo automático do chat).
   * Passar 'manual' para ligações e contatos fora do WhatsApp.
   */
  triggerReason?: 'whatsapp_sent' | 'manual'
  /** Callback executado após registro bem-sucedido (ex: refresh do painel de ciclos) */
  onSuccess?: () => void
}

// ── Renderizador de campo por field_type ─────────────────────────

interface QuestionFieldProps {
  question: ContactAttemptQuestion
  value: string
  onChange: (value: string) => void
  disabled: boolean
}

function QuestionField({ question, value, onChange, disabled }: QuestionFieldProps) {
  const base =
    'w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-50 disabled:opacity-60'

  switch (question.field_type) {
    case 'textarea':
      return (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
          className={`${base} resize-none`}
          placeholder={question.label}
        />
      )

    case 'select':
      return (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={base}
        >
          <option value="">Selecione...</option>
          {(question.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )

    case 'boolean':
      return (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={base}
        >
          <option value="">Selecione...</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      )

    case 'number':
      return (
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={base}
          placeholder="0"
        />
      )

    default: // 'text'
      return (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={base}
          placeholder={question.label}
        />
      )
  }
}

// ── Modal principal ──────────────────────────────────────────────

export function ContactAttemptModal({
  companyId,
  modalState,
  onClose,
  triggerReason = 'whatsapp_sent',
  onSuccess,
}: ContactAttemptModalProps) {
  const isOpen = modalState !== null

  // ── Dados carregados na abertura ──
  const [reasons, setReasons]       = useState<ContactAttemptReason[]>([])
  const [questions, setQuestions]   = useState<ContactAttemptQuestion[]>([])
  const [loadingData, setLoadingData] = useState(false)

  // ── Form ──
  const [selectedReasonId, setSelectedReasonId] = useState<string>('')
  const [answers, setAnswers]   = useState<Record<string, string>>({})
  const [notes, setNotes]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Carregar motivos + perguntas ao abrir
  useEffect(() => {
    if (!isOpen || !companyId) return

    // Resetar form
    setSelectedReasonId('')
    setAnswers({})
    setNotes('')
    setError(null)

    setLoadingData(true)
    Promise.all([
      contactCycleApi.listReasons(companyId, false),
      contactCycleApi.listQuestions(companyId, false),
    ])
      .then(([r, q]) => {
        setReasons(r)
        setQuestions(q)
      })
      .catch(() => {
        // Não bloquear o modal se houver falha no carregamento
        setReasons([])
        setQuestions([])
      })
      .finally(() => setLoadingData(false))
  }, [isOpen, companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Validação de obrigatórias ──────────────────────────────────
  // Bloqueia APENAS o botão de confirmação, nunca o cancelamento
  const missingRequired = questions
    .filter(q => q.required)
    .filter(q => !answers[q.id]?.trim())

  const canSubmit = !submitting && missingRequired.length === 0

  // ── Handlers ──────────────────────────────────────────────────

  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  const handleConfirm = async () => {
    if (!modalState || !canSubmit) return

    setError(null)
    setSubmitting(true)

    try {
      const answersArray = questions
        .filter(q => answers[q.id] !== undefined && answers[q.id] !== '')
        .map(q => ({ question_id: q.id, value: answers[q.id] }))

      await contactCycleApi.registerAttempt(
        modalState.opportunityId,
        companyId,
        {
          trigger_reason:       triggerReason,
          reason_id:            selectedReasonId || null,
          whatsapp_message_id:  triggerReason === 'manual' ? null : modalState.whatsappMessageId,
          notes:                notes.trim() || null,
          answers:              answersArray,
        },
      )

      onSuccess?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao registrar tentativa'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !submitting) onClose()
  }

  if (!isOpen) return null

  const cycleState = modalState.cycleState
  const attemptNum = (cycleState.current_cycle_attempts_count ?? 0) + 1

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onMouseDown={handleBackdropClick}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-indigo-100 bg-indigo-50 rounded-t-2xl sm:rounded-t-xl flex-shrink-0">
          <div className="p-2 rounded-lg bg-indigo-100">
            <Phone className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-indigo-900">
              {triggerReason === 'manual'
                ? 'Registrar tentativa manual'
                : 'Registrar tentativa de contato'}
            </h2>
            <p className="text-xs text-indigo-600 mt-0.5">
              {triggerReason === 'manual'
                ? 'Ligação telefônica ou contato fora do WhatsApp'
                : `Tentativa nº ${attemptNum} neste ciclo`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-indigo-100 rounded-lg transition-colors"
            aria-label="Fechar"
          >
            <X className="w-4 h-4 text-indigo-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {loadingData ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">Carregando informações...</span>
            </div>
          ) : (
            <>
              {/* Motivo comercial */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Motivo da tentativa
                  <span className="text-gray-400 font-normal ml-1">(opcional)</span>
                </label>
                <select
                  value={selectedReasonId}
                  onChange={e => setSelectedReasonId(e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-50 disabled:opacity-60"
                >
                  <option value="">Sem motivo específico</option>
                  {reasons.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* Perguntas dinâmicas */}
              {questions.length > 0 && (
                <div className="space-y-4">
                  {questions.map(q => (
                    <div key={q.id} className="space-y-1.5">
                      <label className="block text-sm font-medium text-gray-700">
                        {q.label}
                        {q.required
                          ? <span className="text-red-500 ml-1">*</span>
                          : <span className="text-gray-400 font-normal ml-1">(opcional)</span>
                        }
                      </label>
                      <QuestionField
                        question={q}
                        value={answers[q.id] ?? ''}
                        onChange={v => handleAnswerChange(q.id, v)}
                        disabled={submitting}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Observação livre */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                  <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
                  Observação
                  <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  disabled={submitting}
                  rows={3}
                  placeholder="Alguma observação sobre esta tentativa?"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-50 disabled:opacity-60 resize-none"
                />
              </div>

              {/* Aviso de perguntas obrigatórias pendentes */}
              {missingRequired.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span className="text-amber-700 text-sm">
                    Responda as perguntas obrigatórias antes de registrar.
                  </span>
                </div>
              )}

              {/* Erro de submissão */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-red-600 text-sm">{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 pt-0 flex-shrink-0">
          {/* "Agora não" — SEMPRE funciona, nunca bloqueado */}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Agora não
          </button>

          {/* "Registrar tentativa" — bloqueado por perguntas obrigatórias ou submitting */}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit || loadingData}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Registrar tentativa
          </button>
        </div>
      </div>
    </div>
  )
}
