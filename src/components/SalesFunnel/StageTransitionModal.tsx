// =====================================================
// COMPONENTE: StageTransitionModal
// Data: 02/09/2026 - Etapa C
// Objetivo: Modal para coletar respostas de perguntas de transição entre etapas
// Escopo: Componente isolado, sem integração com FunnelBoard
// =====================================================

import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import type { StageTransitionQuestion, StageTransitionAnswer } from '../../types/stage-transition-questions'
import {
  buildTransitionAnswersPayload,
  StageTransitionServiceError,
  type StageTransitionDraftAnswer
} from '../../services/stageTransitionQuestionsService'

// =====================================================
// TYPES
// =====================================================

export interface StageTransitionModalProps {
  open: boolean
  destinationStageName: string
  questions: StageTransitionQuestion[]
  onCancel: () => void
  onConfirm: (answers: StageTransitionAnswer[]) => void | Promise<void>
  isSubmitting?: boolean
}

interface FieldError {
  questionId: string
  message: string
}

// =====================================================
// COMPONENT
// =====================================================

export function StageTransitionModal({
  open,
  destinationStageName,
  questions,
  onCancel,
  onConfirm,
  isSubmitting = false
}: StageTransitionModalProps) {
  
  // ===================================================
  // STATE
  // ===================================================
  
  // Draft values - formato natural da UI
  const [draftValues, setDraftValues] = useState<Record<string, any>>({})
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [globalError, setGlobalError] = useState<string | null>(null)
  
  // ===================================================
  // VALIDAÇÃO DA CONFIGURAÇÃO
  // ===================================================
  
  const configError = useMemo(() => {
    try {
      for (const q of questions) {
        // SELECT e MULTI_SELECT devem ter options
        if (q.field_type === 'select' || q.field_type === 'multi_select') {
          if (!q.options || q.options.length === 0) {
            return `Configuração inválida: pergunta "${q.label}" sem opções`
          }
        }
        
        // Validar field_type conhecido
        const validTypes = ['text', 'number', 'boolean', 'select', 'multi_select', 'datetime']
        if (!validTypes.includes(q.field_type)) {
          return `Tipo de pergunta desconhecido: ${q.field_type}`
        }
      }
      return null
    } catch (error) {
      return 'Erro ao validar configuração das perguntas'
    }
  }, [questions])
  
  // ===================================================
  // PERGUNTAS ATIVAS ORDENADAS
  // ===================================================
  
  const activeQuestions = useMemo(() => {
    return questions
      .filter(q => q.active !== false) // Defesa: só renderizar active
      .sort((a, b) => {
        // Ordenar por sort_order ASC, desempate por id
        if (a.sort_order !== b.sort_order) {
          return a.sort_order - b.sort_order
        }
        return a.id.localeCompare(b.id)
      })
  }, [questions])
  
  // ===================================================
  // RESET AO ABRIR/FECHAR
  // ===================================================
  
  useEffect(() => {
    if (open) {
      // Limpar estado ao abrir
      setDraftValues({})
      setFieldErrors([])
      setGlobalError(null)
    }
  }, [open])
  
  // ===================================================
  // HANDLERS
  // ===================================================
  
  const handleValueChange = (questionId: string, value: any) => {
    setDraftValues(prev => ({ ...prev, [questionId]: value }))
    // Limpar erro do campo ao editar
    setFieldErrors(prev => prev.filter(e => e.questionId !== questionId))
    setGlobalError(null)
  }
  
  const handleCancel = () => {
    if (isSubmitting) return
    onCancel()
  }
  
  const handleConfirm = async () => {
    if (isSubmitting) return
    
    setFieldErrors([])
    setGlobalError(null)
    
    try {
      // Preparar draft no formato esperado pela service
      const draft: StageTransitionDraftAnswer[] = activeQuestions.map(q => ({
        questionId: q.id,
        value: draftValues[q.id]
      }))
      
      // Usar service layer para validar e preparar payload
      const payload = buildTransitionAnswersPayload(draft, activeQuestions)
      
      // Entregar ao consumidor
      await onConfirm(payload)
      
    } catch (error) {
      if (error instanceof StageTransitionServiceError) {
        // Erro conhecido da service layer
        if (error.code === 'MISSING_REQUIRED_ANSWER') {
          // Tentar identificar qual pergunta
          const missingRequired = activeQuestions.find(q => 
            q.required && !draftValues[q.id]
          )
          if (missingRequired) {
            setFieldErrors([{
              questionId: missingRequired.id,
              message: 'Campo obrigatório'
            }])
          } else {
            setGlobalError('Existem perguntas obrigatórias não respondidas')
          }
        } else {
          setGlobalError(error.message || 'Erro ao processar respostas')
        }
      } else {
        setGlobalError('Erro inesperado ao processar respostas')
        console.error('StageTransitionModal confirm error:', error)
      }
    }
  }
  
  // ===================================================
  // RENDER - OVERLAY
  // ===================================================
  
  if (!open) return null
  
  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleCancel}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* HEADER */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Perguntas da Etapa
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {destinationStageName}
            </p>
          </div>
          <button
            onClick={handleCancel}
            disabled={isSubmitting}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        
        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6">
          
          {/* ERRO DE CONFIGURAÇÃO */}
          {configError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900">
                  Não foi possível carregar as perguntas desta etapa
                </p>
                <p className="text-xs text-red-700 mt-1">
                  {configError}
                </p>
              </div>
            </div>
          )}
          
          {/* ERRO GLOBAL */}
          {globalError && !configError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-900">{globalError}</p>
            </div>
          )}
          
          {/* PERGUNTAS */}
          {!configError && (
            <div className="space-y-6">
              {activeQuestions.map(question => (
                <QuestionField
                  key={question.id}
                  question={question}
                  value={draftValues[question.id]}
                  onChange={(value) => handleValueChange(question.id, value)}
                  error={fieldErrors.find(e => e.questionId === question.id)?.message}
                  disabled={isSubmitting}
                />
              ))}
            </div>
          )}
        </div>
        
        {/* FOOTER */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={handleCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || !!configError}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? 'Confirmando...' : 'Confirmar'}
          </button>
        </div>
        
      </div>
    </div>
  )
}

// =====================================================
// HELPERS (DATETIME.2B → DATETIME.UX1)
// =====================================================

/**
 * Gera string date "YYYY-MM-DD" para min attribute
 * usando wall clock LOCAL do browser (não UTC)
 */
function getLocalDateMin(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  
  return `${year}-${month}-${day}`
}

/**
 * Separa datetime-local "YYYY-MM-DDTHH:mm" em date e time
 */
function splitDatetime(datetimeLocal: string | undefined): { date: string; time: string } {
  if (!datetimeLocal) return { date: '', time: '' }
  
  const [date, time] = datetimeLocal.split('T')
  return { 
    date: date || '', 
    time: time || '' 
  }
}

// =====================================================
// DATETIME FIELD COMPONENT (DATETIME.UX1)
// =====================================================

interface DatetimeFieldProps {
  value: string | undefined
  onChange: (value: string | undefined) => void
  disabled: boolean
  question: StageTransitionQuestion
}

function DatetimeField({ value, onChange, disabled, question }: DatetimeFieldProps) {
  // Estado local para manter valores parciais (data sem hora, ou hora sem data)
  const [localDate, setLocalDate] = useState('')
  const [localTime, setLocalTime] = useState('')
  
  // Sincronizar com value externo quando mudar
  useEffect(() => {
    const { date, time } = splitDatetime(value)
    setLocalDate(date)
    setLocalTime(time)
  }, [value])
  
  // Determinar se precisa validar futuro
  const requiresFuture = question.create_activity_on_answer === true
  const minDateAttr = requiresFuture ? getLocalDateMin() : undefined
  
  const handleDateChange = (newDate: string) => {
    setLocalDate(newDate)
    // Só propaga se ambos estiverem preenchidos
    if (newDate && localTime) {
      onChange(`${newDate}T${localTime}`)
    } else if (!newDate && !localTime) {
      // Se ambos vazios, limpa
      onChange(undefined)
    }
    // Se apenas um preenchido, não propaga (mantém estado parcial)
  }
  
  const handleTimeChange = (newTime: string) => {
    setLocalTime(newTime)
    // Só propaga se ambos estiverem preenchidos
    if (localDate && newTime) {
      onChange(`${localDate}T${newTime}`)
    } else if (!localDate && !newTime) {
      // Se ambos vazios, limpa
      onChange(undefined)
    }
    // Se apenas um preenchido, não propaga (mantém estado parcial)
  }
  
  return (
    <div>
      <div className="flex gap-3">
        {/* CAMPO DATA */}
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Data {question.required && <span className="text-red-600">*</span>}
          </label>
          <input
            type="date"
            value={localDate}
            onChange={(e) => handleDateChange(e.target.value)}
            disabled={disabled}
            min={minDateAttr}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
        
        {/* CAMPO HORA */}
        <div className="w-32">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Hora {question.required && <span className="text-red-600">*</span>}
          </label>
          <input
            type="time"
            value={localTime}
            onChange={(e) => handleTimeChange(e.target.value)}
            disabled={disabled}
            step="60"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>
      
      {/* HINT */}
      {requiresFuture && (
        <p className="mt-2 text-xs text-gray-600">
          💡 Informe quando a atividade deverá ser agendada. Você pode digitar ou usar os calendários.
        </p>
      )}
    </div>
  )
}

// =====================================================
// QUESTION FIELD COMPONENT
// =====================================================

interface QuestionFieldProps {
  question: StageTransitionQuestion
  value: any
  onChange: (value: any) => void
  error?: string
  disabled: boolean
}

function QuestionField({ question, value, onChange, error, disabled }: QuestionFieldProps) {
  
  const renderField = () => {
    switch (question.field_type) {
      case 'text':
        return (
          <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed resize-none"
            placeholder={question.required ? 'Resposta obrigatória' : 'Opcional'}
          />
        )
      
      case 'number':
        return (
          <input
            type="text"
            inputMode="decimal"
            value={value || ''}
            onChange={(e) => {
              const val = e.target.value
              // Permitir apenas números e ponto decimal
              if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
                onChange(val)
              }
            }}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
            placeholder={question.required ? 'Ex: 1500.50' : 'Opcional'}
          />
        )
      
      case 'boolean':
        return (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onChange(true)}
              disabled={disabled}
              className={`flex-1 px-4 py-2 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                value === true
                  ? 'bg-green-50 border-green-500 text-green-900'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Sim
            </button>
            <button
              type="button"
              onClick={() => onChange(false)}
              disabled={disabled}
              className={`flex-1 px-4 py-2 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                value === false
                  ? 'bg-red-50 border-red-500 text-red-900'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Não
            </button>
          </div>
        )
      
      case 'select':
        return (
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {question.required ? '-- Selecione --' : '-- Nenhuma (opcional) --'}
            </option>
            {question.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )
      
      case 'multi_select':
        return (
          <div className="space-y-2">
            {question.options?.map(opt => {
              const selected = Array.isArray(value) && value.includes(opt)
              return (
                <label
                  key={opt}
                  className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                  } ${selected ? 'bg-blue-50 border-blue-500' : 'border-gray-300'}`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const current = Array.isArray(value) ? value : []
                      const newValue = selected
                        ? current.filter(v => v !== opt)
                        : [...current, opt]
                      onChange(newValue.length > 0 ? newValue : undefined)
                    }}
                    disabled={disabled}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:cursor-not-allowed"
                  />
                  <span className="text-sm text-gray-900">{opt}</span>
                </label>
              )
            })}
          </div>
        )
      
      case 'datetime':
        // DATETIME.UX1 — Inputs separados para melhor digitação
        return <DatetimeField 
          value={value}
          onChange={onChange}
          disabled={disabled}
          question={question}
        />
      
      default:
        return (
          <div className="text-sm text-gray-500 italic">
            Tipo de pergunta não suportado: {question.field_type}
          </div>
        )
    }
  }
  
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-2">
        {question.label}
        {question.required && <span className="text-red-600 ml-1">*</span>}
      </label>
      {renderField()}
      {error && (
        <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
          <AlertCircle className="w-4 h-4" />
          {error}
        </p>
      )}
    </div>
  )
}
