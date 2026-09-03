// =====================================================
// Stage Transition Questions Panel
// Data: 02/09/2026 - Etapa F
//
// Painel administrativo para gerenciar perguntas de transição
// Baseado em ContactCycleQuestionsPanel
// =====================================================

import React, { useState, useEffect } from 'react'
import {
  Plus, Pencil, Eye, EyeOff, X, Loader2, AlertCircle,
  CheckCircle2, ChevronUp, ChevronDown, HelpCircle
} from 'lucide-react'
import { isStageTransitionQuestionsFeatureEnabled } from '../../hooks/dashboard/useFeatureFlags'
import {
  fetchAllQuestions,
  createQuestion,
  updateQuestion,
  setQuestionActive,
  reorderQuestions,
  type CreateQuestionInput,
  type UpdateQuestionInput,
  type QuestionOrder
} from '../../services/stageTransitionQuestionsTransport'
import { StageTransitionServiceError } from '../../services/stageTransitionQuestionsService'
import type { StageTransitionQuestion } from '../../types/stage-transition-questions'

// =====================================================
// TYPES
// =====================================================

interface Props {
  stageId: string
  stageName: string
  canManage: boolean
}

type FieldTypeOption = 'text' | 'number' | 'boolean' | 'select' | 'multi_select' | 'datetime'

const FIELD_TYPE_LABELS: Record<FieldTypeOption, string> = {
  text: 'Texto',
  number: 'Número',
  boolean: 'Sim / Não',
  select: 'Seleção (única)',
  multi_select: 'Seleção (múltipla)',
  datetime: 'Data e hora'
}

interface FormState {
  label: string
  field_type: FieldTypeOption
  options: string[]
  required: boolean
  sort_order: string
  create_activity_on_answer: boolean
}

const EMPTY_FORM: FormState = {
  label: '',
  field_type: 'text',
  options: [],
  required: false,
  sort_order: '0',
  create_activity_on_answer: false
}

const MAX_ACTIVE_QUESTIONS = 15
const WARNING_THRESHOLD = 8

// =====================================================
// COMPONENT
// =====================================================

export const StageTransitionQuestionsPanel: React.FC<Props> = ({
  stageId,
  stageName,
  canManage
}) => {
  // Feature guard
  const featureEnabled = isStageTransitionQuestionsFeatureEnabled()

  // State
  const [questions, setQuestions] = useState<StageTransitionQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<StageTransitionQuestion | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [newOption, setNewOption] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Load questions
  useEffect(() => {
    if (!featureEnabled) {
      setLoading(false)
      return
    }

    loadQuestions()
  }, [stageId, featureEnabled])

  async function loadQuestions() {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchAllQuestions(stageId, true) // include_inactive
      setQuestions(data)
    } catch (err) {
      if (err instanceof StageTransitionServiceError) {
        setError(err.message)
      } else {
        setError('Erro ao carregar perguntas')
      }
    } finally {
      setLoading(false)
    }
  }

  // Flash success message
  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3500)
  }

  // Form handlers
  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setNewOption('')
    setLocalError(null)
    setShowForm(true)
  }

  const openEdit = (q: StageTransitionQuestion) => {
    setEditing(q)
    setForm({
      label: q.label,
      field_type: q.field_type as FieldTypeOption,
      options: q.options ?? [],
      required: q.required,
      sort_order: String(q.sort_order),
      create_activity_on_answer: q.create_activity_on_answer ?? false
    })
    setNewOption('')
    setLocalError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setNewOption('')
    setLocalError(null)
  }

  // Options management
  const addOption = () => {
    const trimmed = newOption.trim()
    if (!trimmed) return
    if (form.options.includes(trimmed)) {
      setLocalError('Esta opção já existe.')
      return
    }
    setForm(prev => ({ ...prev, options: [...prev.options, trimmed] }))
    setNewOption('')
    setLocalError(null)
  }

  const removeOption = (opt: string) => {
    setForm(prev => ({ ...prev, options: prev.options.filter(o => o !== opt) }))
  }

  const moveOptionUp = (index: number) => {
    if (index === 0) return
    const newOptions = [...form.options]
    ;[newOptions[index - 1], newOptions[index]] = [newOptions[index], newOptions[index - 1]]
    setForm(prev => ({ ...prev, options: newOptions }))
  }

  const moveOptionDown = (index: number) => {
    if (index === form.options.length - 1) return
    const newOptions = [...form.options]
    ;[newOptions[index], newOptions[index + 1]] = [newOptions[index + 1], newOptions[index]]
    setForm(prev => ({ ...prev, options: newOptions }))
  }

  // Activity conflict detection (DATETIME.2A)
  const hasActivityConflict = (): boolean => {
    // Se não for datetime, sem conflito
    if (form.field_type !== 'datetime') return false
    
    // Se a flag não está marcada, sem conflito
    if (!form.create_activity_on_answer) return false
    
    // Procurar outra pergunta ativa com datetime+flag=true
    const otherActiveWithFlag = questions.find(q =>
      q.active &&
      q.field_type === 'datetime' &&
      q.create_activity_on_answer === true &&
      q.id !== editing?.id // Não considerar a própria pergunta se estiver editando
    )
    
    return !!otherActiveWithFlag
  }

  // Validation
  const validateForm = (): string | null => {
    const trimmedLabel = form.label.trim()
    if (!trimmedLabel) return 'Label é obrigatório'

    if (form.field_type === 'select' || form.field_type === 'multi_select') {
      if (form.options.length === 0) {
        return `Tipo ${form.field_type} requer pelo menos uma opção`
      }
    }

    const sortOrder = parseInt(form.sort_order, 10)
    if (isNaN(sortOrder)) return 'Sort order deve ser um número'

    // Check max active if creating new active question
    if (!editing) {
      const activeCount = questions.filter(q => q.active).length
      if (activeCount >= MAX_ACTIVE_QUESTIONS) {
        return `Limite de ${MAX_ACTIVE_QUESTIONS} perguntas ativas atingido. Desative uma pergunta existente primeiro.`
      }
    }

    return null
  }

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const validationError = validateForm()
    if (validationError) {
      setLocalError(validationError)
      return
    }

    setLocalError(null)
    setSaving(true)

    try {
      if (editing) {
        // Update
        const input: UpdateQuestionInput = {
          question_id: editing.id,
          label: form.label.trim(),
          required: form.required,
          sort_order: parseInt(form.sort_order, 10),
          create_activity_on_answer: form.create_activity_on_answer
        }

        await updateQuestion(input)
        flash('Pergunta atualizada com sucesso')
      } else {
        // Create
        const input: CreateQuestionInput = {
          funnel_stage_id: stageId,
          label: form.label.trim(),
          field_type: form.field_type,
          required: form.required,
          options: (form.field_type === 'select' || form.field_type === 'multi_select')
            ? form.options
            : null,
          sort_order: parseInt(form.sort_order, 10),
          create_activity_on_answer: form.create_activity_on_answer
        }

        await createQuestion(input)
        flash('Pergunta criada com sucesso')
      }

      closeForm()
      await loadQuestions()
    } catch (err) {
      if (err instanceof StageTransitionServiceError) {
        setLocalError(err.message)
      } else {
        setLocalError('Erro ao salvar pergunta')
      }
    } finally {
      setSaving(false)
    }
  }

  // Toggle active
  const handleToggleActive = async (question: StageTransitionQuestion) => {
    const newActive = !question.active

    // Check limit before activating
    if (newActive) {
      const activeCount = questions.filter(q => q.active && q.id !== question.id).length
      if (activeCount >= MAX_ACTIVE_QUESTIONS) {
        setError(`Limite de ${MAX_ACTIVE_QUESTIONS} perguntas ativas atingido`)
        return
      }
    }

    setTogglingId(question.id)
    setError(null)

    try {
      await setQuestionActive(question.id, newActive)
      await loadQuestions()
      flash(newActive ? 'Pergunta ativada' : 'Pergunta desativada')
    } catch (err) {
      if (err instanceof StageTransitionServiceError) {
        setError(err.message)
      } else {
        setError('Erro ao alterar status')
      }
    } finally {
      setTogglingId(null)
    }
  }

  // Reorder
  const handleMoveUp = async (index: number) => {
    if (index === 0) return

    const reordered = [...questions]
    ;[reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]]

    const order: QuestionOrder[] = reordered.map((q, i) => ({
      id: q.id,
      sort_order: i
    }))

    setSaving(true)
    setError(null)

    try {
      await reorderQuestions(stageId, order)
      await loadQuestions()
      flash('Ordem atualizada')
    } catch (err) {
      if (err instanceof StageTransitionServiceError) {
        setError(err.message)
      } else {
        setError('Erro ao reordenar')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleMoveDown = async (index: number) => {
    if (index === questions.length - 1) return

    const reordered = [...questions]
    ;[reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]]

    const order: QuestionOrder[] = reordered.map((q, i) => ({
      id: q.id,
      sort_order: i
    }))

    setSaving(true)
    setError(null)

    try {
      await reorderQuestions(stageId, order)
      await loadQuestions()
      flash('Ordem atualizada')
    } catch (err) {
      if (err instanceof StageTransitionServiceError) {
        setError(err.message)
      } else {
        setError('Erro ao reordenar')
      }
    } finally {
      setSaving(false)
    }
  }

  // Computed values
  const activeCount = questions.filter(q => q.active).length
  const showWarning = activeCount >= WARNING_THRESHOLD && activeCount < MAX_ACTIVE_QUESTIONS
  const fieldTypeNeedsOptions = form.field_type === 'select' || form.field_type === 'multi_select'

  // Feature disabled
  if (!featureEnabled) {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <p className="text-sm text-gray-600">
          Funcionalidade de perguntas de transição não está habilitada.
        </p>
      </div>
    )
  }

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        <span className="ml-2 text-sm text-gray-600">Carregando...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Perguntas: {stageName}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {activeCount} de {MAX_ACTIVE_QUESTIONS} perguntas ativas
          </p>
        </div>
        {canManage && !showForm && (
          <button
            onClick={openCreate}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Nova Pergunta
          </button>
        )}
      </div>

      {/* Warnings */}
      {showWarning && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-800">
            Você tem {activeCount} perguntas ativas. Considere manter um número razoável para melhor experiência do usuário.
          </div>
        </div>
      )}

      {activeCount >= MAX_ACTIVE_QUESTIONS && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            Limite de {MAX_ACTIVE_QUESTIONS} perguntas ativas atingido. Desative uma pergunta existente para criar/ativar outras.
          </div>
        </div>
      )}

      {/* Success */}
      {successMsg && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <span className="text-sm text-green-800">{successMsg}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-red-800">{error}</span>
        </div>
      )}

      {/* Form */}
      {showForm && canManage && (
        <form onSubmit={handleSubmit} className="p-4 border border-gray-200 rounded-lg bg-white space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-gray-900">
              {editing ? 'Editar Pergunta' : 'Nova Pergunta'}
            </h4>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {localError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-800">{localError}</span>
            </div>
          )}

          {/* Label */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Texto da Pergunta *
            </label>
            <input
              type="text"
              value={form.label}
              onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))}
              disabled={saving}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              placeholder="Ex: Cliente qualificado?"
            />
          </div>

          {/* Field Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo *
              {editing && (
                <span className="ml-2 text-xs text-gray-500">(não editável após criação)</span>
              )}
            </label>
            <select
              value={form.field_type}
              onChange={e => {
                const newType = e.target.value as FieldTypeOption
                setForm(prev => ({
                  ...prev,
                  field_type: newType,
                  options: [],
                  create_activity_on_answer: newType === 'datetime' ? prev.create_activity_on_answer : false
                }))
              }}
              disabled={saving || !!editing}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            >
              {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Options */}
          {fieldTypeNeedsOptions && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Opções * {editing && <span className="text-xs text-gray-500">(não editável após respostas existentes)</span>}
              </label>
              
              {!editing && (
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newOption}
                    onChange={e => setNewOption(e.target.value)}
                    onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addOption())}
                    disabled={saving}
                    placeholder="Digite uma opção"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
                  />
                  <button
                    type="button"
                    onClick={addOption}
                    disabled={saving || !newOption.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Adicionar
                  </button>
                </div>
              )}

              {form.options.length > 0 && (
                <div className="space-y-1 p-3 bg-gray-50 rounded border border-gray-200">
                  {form.options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-gray-900">{opt}</span>
                      {!editing && (
                        <>
                          <button
                            type="button"
                            onClick={() => moveOptionUp(i)}
                            disabled={i === 0 || saving}
                            className="p-1 hover:bg-gray-200 rounded disabled:opacity-30"
                          >
                            <ChevronUp className="w-4 h-4 text-gray-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveOptionDown(i)}
                            disabled={i === form.options.length - 1 || saving}
                            className="p-1 hover:bg-gray-200 rounded disabled:opacity-30"
                          >
                            <ChevronDown className="w-4 h-4 text-gray-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeOption(opt)}
                            disabled={saving}
                            className="p-1 hover:bg-red-100 rounded disabled:opacity-30"
                          >
                            <X className="w-4 h-4 text-red-600" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {form.options.length === 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Nenhuma opção adicionada ainda
                </p>
              )}
            </div>
          )}

          {/* Required */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="required"
              checked={form.required}
              onChange={e => setForm(prev => ({ ...prev, required: e.target.checked }))}
              disabled={saving}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="required" className="text-sm text-gray-700">
              Campo obrigatório
            </label>
          </div>

          {/* Create Activity on Answer (DATETIME.2A) */}
          {form.field_type === 'datetime' && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="create_activity"
                  checked={form.create_activity_on_answer}
                  onChange={e => setForm(prev => ({ ...prev, create_activity_on_answer: e.target.checked }))}
                  disabled={saving || hasActivityConflict()}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5"
                />
                <div className="flex-1">
                  <label htmlFor="create_activity" className="text-sm font-medium text-gray-900 cursor-pointer">
                    Criar atividade a partir da resposta
                  </label>
                  <p className="text-xs text-gray-600 mt-1">
                    Ao responder esta pergunta, o sistema oferecerá criar uma atividade no calendário com a data e hora informadas.
                  </p>
                  {hasActivityConflict() && (
                    <p className="text-xs text-amber-700 mt-2">
                      Esta etapa já possui uma pergunta ativa de data e hora configurada para criar atividade.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sort Order */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ordem
            </label>
            <input
              type="number"
              value={form.sort_order}
              onChange={e => setForm(prev => ({ ...prev, sort_order: e.target.value }))}
              disabled={saving}
              className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? 'Salvar' : 'Criar'}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Questions List */}
      {questions.length === 0 ? (
        <div className="p-8 text-center border border-gray-200 rounded-lg bg-gray-50">
          <HelpCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600">
            Nenhuma pergunta configurada para esta etapa.
          </p>
          {canManage && (
            <p className="text-xs text-gray-500 mt-1">
              Clique em "Nova Pergunta" para começar.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {questions.map((q, index) => (
            <div
              key={q.id}
              className={`p-4 border rounded-lg ${
                q.active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Reorder buttons */}
                {canManage && (
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0 || saving}
                      className="p-1 hover:bg-gray-200 rounded disabled:opacity-30"
                      title="Mover para cima"
                    >
                      <ChevronUp className="w-4 h-4 text-gray-600" />
                    </button>
                    <button
                      onClick={() => handleMoveDown(index)}
                      disabled={index === questions.length - 1 || saving}
                      className="p-1 hover:bg-gray-200 rounded disabled:opacity-30"
                      title="Mover para baixo"
                    >
                      <ChevronDown className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">{q.label}</h4>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span className="px-2 py-0.5 bg-gray-100 rounded">
                          {FIELD_TYPE_LABELS[q.field_type as FieldTypeOption]}
                        </span>
                        {q.required && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                            Obrigatória
                          </span>
                        )}
                        {q.field_type === 'datetime' && q.create_activity_on_answer && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded" title="Cria atividade no calendário">
                            📅 Cria atividade
                          </span>
                        )}
                        {!q.active && (
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded">
                            Inativa
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(q)}
                          disabled={saving}
                          className="p-2 hover:bg-gray-100 rounded disabled:opacity-30"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(q)}
                          disabled={saving || togglingId === q.id}
                          className="p-2 hover:bg-gray-100 rounded disabled:opacity-30"
                          title={q.active ? 'Desativar' : 'Ativar'}
                        >
                          {togglingId === q.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-gray-600" />
                          ) : q.active ? (
                            <Eye className="w-4 h-4 text-gray-600" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-gray-600" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Options preview */}
                  {q.options && q.options.length > 0 && (
                    <div className="mt-2 text-xs text-gray-600">
                      <span className="font-medium">Opções:</span> {q.options.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
