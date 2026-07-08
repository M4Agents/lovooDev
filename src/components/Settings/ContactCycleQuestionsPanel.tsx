// =====================================================
// ContactCycleQuestionsPanel
//
// Lista e formulário inline para perguntas dinâmicas de tentativa de contato.
// Consumido por ContactCycleSection (E10) — não importar em outros arquivos ainda.
//
// Props:
//   companyId — empresa ativa
//   canManage — true = admin+ (CRUD); false = seller (somente leitura)
// =====================================================

import React, { useState } from 'react'
import { Plus, Pencil, Eye, EyeOff, HelpCircle, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useContactCycleQuestions } from '../../hooks/useContactCycleQuestions'
import type { ContactAttemptQuestion, FieldType } from '../../types/contact-cycles'

interface Props {
  companyId: string
  canManage: boolean
}

interface FormState {
  label:      string
  field_type: FieldType
  options:    string[]
  required:   boolean
  sort_order: string
}

const EMPTY_FORM: FormState = {
  label:      '',
  field_type: 'text',
  options:    [],
  required:   false,
  sort_order: '0',
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text:     'Texto curto',
  textarea: 'Texto longo',
  select:   'Seleção (lista)',
  boolean:  'Sim / Não',
  number:   'Número',
}

export const ContactCycleQuestionsPanel: React.FC<Props> = ({ companyId, canManage }) => {
  const { questions, loading, saving, error, create, update } = useContactCycleQuestions(
    companyId,
    canManage,
  )

  const [showForm, setShowForm]     = useState(false)
  const [editing, setEditing]       = useState<ContactAttemptQuestion | null>(null)
  const [form, setForm]             = useState<FormState>(EMPTY_FORM)
  const [newOption, setNewOption]   = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3500)
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setNewOption('')
    setLocalError(null)
    setShowForm(true)
  }

  const openEdit = (q: ContactAttemptQuestion) => {
    setEditing(q)
    setForm({
      label:      q.label,
      field_type: q.field_type,
      options:    q.options ?? [],
      required:   q.required,
      sort_order: String(q.sort_order),
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

  const addOption = () => {
    const trimmed = newOption.trim()
    if (!trimmed) return
    if (form.options.includes(trimmed)) {
      setLocalError('Esta opção já existe.')
      return
    }
    setForm(f => ({ ...f, options: [...f.options, trimmed] }))
    setNewOption('')
    setLocalError(null)
  }

  const removeOption = (idx: number) => {
    setForm(f => ({ ...f, options: f.options.filter((_, i) => i !== idx) }))
  }

  const handleSave = async () => {
    setLocalError(null)
    const sortOrder = parseInt(form.sort_order, 10)
    const optionsForApi = form.field_type === 'select' ? form.options : null

    if (editing) {
      const ok = await update(editing.id, {
        label:      form.label,
        field_type: form.field_type,
        options:    optionsForApi,
        required:   form.required,
        sort_order: isNaN(sortOrder) ? 0 : sortOrder,
      })
      if (ok) { flash('Pergunta atualizada com sucesso.'); closeForm() }
      else setLocalError(error)
    } else {
      const created = await create({
        label:      form.label,
        field_type: form.field_type,
        options:    optionsForApi,
        required:   form.required,
        sort_order: isNaN(sortOrder) ? 0 : sortOrder,
      })
      if (created) { flash('Pergunta criada com sucesso.'); closeForm() }
      else setLocalError(error)
    }
  }

  const handleToggleActive = async (q: ContactAttemptQuestion) => {
    setTogglingId(q.id)
    setLocalError(null)
    const ok = await update(q.id, { active: !q.active })
    if (ok) flash(q.active ? 'Pergunta desativada.' : 'Pergunta reativada.')
    else setLocalError(error)
    setTogglingId(null)
  }

  const activeQuestions   = questions.filter(q => q.active)
  const inactiveQuestions = questions.filter(q => !q.active)

  return (
    <div className="space-y-5">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-indigo-500" />
            Perguntas adicionais
          </h4>
          <p className="text-xs text-slate-500 mt-1">
            Perguntas exibidas no modal de tentativa quando "Exibir perguntas adicionais" estiver ativo.
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova pergunta
          </button>
        )}
      </div>

      {!canManage && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Você tem permissão apenas para visualizar as perguntas cadastradas.
        </p>
      )}

      {/* Mensagens */}
      {(localError ?? (!showForm && error)) && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {localError ?? error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Formulário inline */}
      {showForm && canManage && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
          <h5 className="text-sm font-semibold text-slate-800">
            {editing ? 'Editar pergunta' : 'Nova pergunta'}
          </h5>

          {localError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {localError}
            </div>
          )}

          {/* label */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Texto da pergunta *
            </label>
            <input
              type="text"
              value={form.label}
              maxLength={150}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              placeholder="Ex: Qual o interesse demonstrado pelo cliente?"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              autoFocus
            />
            <p className="text-xs text-slate-400 mt-1">{form.label.length}/150 caracteres</p>
          </div>

          {/* field_type */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Tipo de resposta *
            </label>
            <select
              value={form.field_type}
              onChange={e => setForm(f => ({
                ...f,
                field_type: e.target.value as FieldType,
                // Limpar options ao sair de 'select'
                options: e.target.value === 'select' ? f.options : [],
              }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {(Object.entries(FIELD_TYPE_LABELS) as [FieldType, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          {/* options — apenas para 'select' */}
          {form.field_type === 'select' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Opções * (ao menos 1)
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newOption}
                  onChange={e => setNewOption(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
                  placeholder="Digite uma opção e pressione Enter"
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={addOption}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {form.options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {form.options.map((opt, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-full border border-indigo-100"
                    >
                      {opt}
                      <button
                        type="button"
                        onClick={() => removeOption(idx)}
                        className="hover:text-red-600 transition-colors ml-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {form.options.length === 0 && (
                <p className="text-xs text-red-500 mt-1">Adicione ao menos uma opção.</p>
              )}
            </div>
          )}

          {/* required + sort_order */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <input
                id="q-required"
                type="checkbox"
                checked={form.required}
                onChange={e => setForm(f => ({ ...f, required: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="q-required" className="text-sm text-slate-700 cursor-pointer">
                Resposta obrigatória
              </label>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600 whitespace-nowrap">Ordem:</label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              Salvar
            </button>
            <button
              onClick={closeForm}
              disabled={saving}
              className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando perguntas...</span>
        </div>
      ) : questions.length === 0 ? (
        <div className="text-center py-10 text-slate-400">
          <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhuma pergunta cadastrada.</p>
          {canManage && (
            <p className="text-xs mt-1">Clique em "Nova pergunta" para começar.</p>
          )}
        </div>
      ) : (
        <div className="space-y-5">

          {/* Ativas */}
          {activeQuestions.length > 0 && (
            <div className="space-y-2">
              {inactiveQuestions.length > 0 && (
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Ativas</p>
              )}
              {activeQuestions.map(q => (
                <div
                  key={q.id}
                  className="flex items-start gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800">{q.label}</span>
                      {q.required && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-red-50 text-red-600 rounded-full border border-red-100">
                          Obrigatória
                        </span>
                      )}
                      <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                        {FIELD_TYPE_LABELS[q.field_type]}
                      </span>
                    </div>
                    {q.field_type === 'select' && q.options && q.options.length > 0 && (
                      <p className="text-xs text-slate-500 mt-1">
                        Opções: {q.options.join(', ')}
                      </p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(q)}
                        title="Editar"
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(q)}
                        disabled={togglingId === q.id}
                        title="Desativar"
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40"
                      >
                        {togglingId === q.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <EyeOff className="w-3.5 h-3.5" />
                        }
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Inativas — apenas admin+ */}
          {canManage && inactiveQuestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Inativas</p>
              {inactiveQuestions.map(q => (
                <div
                  key={q.id}
                  className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-4 py-3 opacity-60"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-600 line-through">{q.label}</span>
                    <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full">
                      {FIELD_TYPE_LABELS[q.field_type]}
                    </span>
                  </div>
                  <button
                    onClick={() => handleToggleActive(q)}
                    disabled={togglingId === q.id}
                    title="Reativar"
                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-40 shrink-0"
                  >
                    {togglingId === q.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Eye className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  )
}
