// =====================================================
// ContactCycleReasonsPanel
//
// Lista e formulário inline para motivos de tentativa de contato.
// Consumido por ContactCycleSection (E10) — não importar em outros arquivos ainda.
//
// Props:
//   companyId — empresa ativa
//   canManage — true = admin+ (CRUD); false = seller (somente leitura)
// =====================================================

import React, { useState } from 'react'
import { Plus, Pencil, Eye, EyeOff, MessageSquare, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useContactCycleReasons } from '../../hooks/useContactCycleReasons'
import type { ContactAttemptReason } from '../../types/contact-cycles'

interface Props {
  companyId: string
  canManage: boolean
}

interface FormState {
  label: string
}

const EMPTY_FORM: FormState = { label: '' }

export const ContactCycleReasonsPanel: React.FC<Props> = ({ companyId, canManage }) => {
  const { reasons, loading, saving, error, create, update } = useContactCycleReasons(
    companyId,
    canManage,
  )

  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<ContactAttemptReason | null>(null)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
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
    setLocalError(null)
    setShowForm(true)
  }

  const openEdit = (reason: ContactAttemptReason) => {
    setEditing(reason)
    setForm({ label: reason.label })
    setLocalError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setLocalError(null)
  }

  const handleSave = async () => {
    setLocalError(null)
    if (editing) {
      const ok = await update(editing.id, { label: form.label })
      if (ok) { flash('Motivo atualizado com sucesso.'); closeForm() }
      else setLocalError(error)
    } else {
      const created = await create({ label: form.label })
      if (created) { flash('Motivo criado com sucesso.'); closeForm() }
      else setLocalError(error)
    }
  }

  const handleToggleActive = async (reason: ContactAttemptReason) => {
    setTogglingId(reason.id)
    setLocalError(null)
    const ok = await update(reason.id, { active: !reason.active })
    if (ok) {
      flash(reason.active ? 'Motivo desativado.' : 'Motivo reativado.')
    } else {
      setLocalError(error)
    }
    setTogglingId(null)
  }

  // Separar ativos e inativos para exibição organizada
  const activeReasons   = reasons.filter(r => r.active)
  const inactiveReasons = reasons.filter(r => !r.active)

  return (
    <div className="space-y-5">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-indigo-500" />
            Motivos de contato
          </h4>
          <p className="text-xs text-slate-500 mt-1">
            Razões comerciais que o vendedor pode associar a uma tentativa de contato.
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo motivo
          </button>
        )}
      </div>

      {!canManage && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Você tem permissão apenas para visualizar os motivos cadastrados.
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
            {editing ? 'Editar motivo' : 'Novo motivo'}
          </h5>

          {localError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {localError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Nome do motivo *
            </label>
            <input
              type="text"
              value={form.label}
              maxLength={80}
              onChange={e => setForm({ label: e.target.value })}
              placeholder="Ex: Retorno de proposta"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              autoFocus
            />
            <p className="text-xs text-slate-400 mt-1">{form.label.length}/80 caracteres</p>
          </div>

          <div className="flex gap-2">
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
          <span className="text-sm">Carregando motivos...</span>
        </div>
      ) : reasons.length === 0 ? (
        <div className="text-center py-10 text-slate-400">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhum motivo cadastrado.</p>
          {canManage && (
            <p className="text-xs mt-1">Clique em "Novo motivo" para começar.</p>
          )}
        </div>
      ) : (
        <div className="space-y-5">

          {/* Ativos */}
          {activeReasons.length > 0 && (
            <div className="space-y-2">
              {inactiveReasons.length > 0 && (
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Ativos</p>
              )}
              {activeReasons.map(reason => (
                <div
                  key={reason.id}
                  className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3"
                >
                  <span className="flex-1 text-sm text-slate-800">{reason.label}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                    Ativo
                  </span>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(reason)}
                        title="Editar"
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(reason)}
                        disabled={togglingId === reason.id}
                        title="Desativar"
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40"
                      >
                        {togglingId === reason.id
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

          {/* Inativos — visível apenas para admin+ */}
          {canManage && inactiveReasons.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Inativos</p>
              {inactiveReasons.map(reason => (
                <div
                  key={reason.id}
                  className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-4 py-3 opacity-60"
                >
                  <span className="flex-1 text-sm text-slate-600 line-through">{reason.label}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                    Inativo
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggleActive(reason)}
                      disabled={togglingId === reason.id}
                      title="Reativar"
                      className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {togglingId === reason.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Eye className="w-3.5 h-3.5" />
                      }
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
