/**
 * LossTypesSettings
 *
 * Gerencia Tipos de Perda:
 *
 * Tipos de sistema (is_system=true):
 *   - Badge "Sistema" sempre visível
 *   - Badge "Oculto" quando is_hidden=true
 *   - Ação Ocultar/Exibir (via RPC set_system_loss_type_hidden)
 *   - SEM Editar, Ativar/Desativar ou Excluir
 *
 * Tipos customizados (is_system=false):
 *   - CRUD completo (Criar, Editar, Ativar/Desativar, Excluir)
 *   - Excluir bloqueado por FK — orientar desativação
 *
 * Espelho de SaleTypesSettings.tsx.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus, Pencil, Trash2, Eye, EyeOff, GripVertical,
  AlertTriangle, Loader2, AlertCircle, CheckCircle2, ShieldCheck,
} from 'lucide-react'
import { lossTypesApi } from '../../services/lossTypesApi'
import type { LossType } from '../../types/sales-funnel'

interface Props {
  companyId: string
}

interface FormState {
  name: string
  description: string
  sort_order: string
}

const EMPTY_FORM: FormState = { name: '', description: '', sort_order: '1000' }

export const LossTypesSettings: React.FC<Props> = ({ companyId }) => {
  const [lossTypes, setLossTypes] = useState<LossType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<LossType | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await lossTypesApi.getLossTypes(companyId)
      setLossTypes(data)
    } catch {
      setError('Erro ao carregar tipos de perda.')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  const openEdit = (lt: LossType) => {
    if (lt.is_system) {
      setError('Tipos de sistema não podem ser editados.')
      return
    }
    setEditing(lt)
    setForm({
      name:        lt.name,
      description: lt.description ?? '',
      sort_order:  String(lt.sort_order),
    })
    setError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('O nome do tipo de perda é obrigatório.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await lossTypesApi.updateLossType(editing.id, companyId, {
          name:        form.name.trim(),
          description: form.description.trim() || null,
          sort_order:  parseInt(form.sort_order) || 1000,
        })
        flash('Tipo de perda atualizado com sucesso.')
      } else {
        await lossTypesApi.createLossType(companyId, {
          name:        form.name.trim(),
          description: form.description.trim() || null,
          sort_order:  parseInt(form.sort_order) || 1000,
        })
        flash('Tipo de perda criado com sucesso.')
      }
      closeForm()
      await load()
    } catch {
      setError('Erro ao salvar tipo de perda.')
    } finally {
      setSaving(false)
    }
  }

  // Apenas para tipos customizados
  const handleToggleActive = async (lt: LossType) => {
    if (lt.is_system) return
    try {
      await lossTypesApi.updateLossType(lt.id, companyId, { is_active: !lt.is_active })
      flash(lt.is_active ? 'Tipo de perda desativado.' : 'Tipo de perda ativado.')
      await load()
    } catch {
      setError('Erro ao atualizar tipo de perda.')
    }
  }

  // Apenas para tipos de sistema
  const handleToggleHidden = async (lt: LossType) => {
    if (!lt.is_system) return
    setTogglingId(lt.id)
    setError(null)
    try {
      await lossTypesApi.setSystemLossTypeHidden(companyId, lt.id, !lt.is_hidden)
      flash(lt.is_hidden ? 'Tipo de perda exibido novamente.' : 'Tipo de perda ocultado.')
      await load()
    } catch {
      setError('Erro ao atualizar visibilidade.')
    } finally {
      setTogglingId(null)
    }
  }

  // Apenas para tipos customizados
  const handleDelete = async (lt: LossType) => {
    if (lt.is_system) return
    if (!window.confirm(`Excluir o tipo de perda "${lt.name}"? Esta ação não pode ser desfeita.`)) return
    setDeletingId(lt.id)
    setError(null)
    try {
      await lossTypesApi.deleteLossType(lt.id, companyId)
      flash('Tipo de perda excluído.')
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes('foreign key') ||
        msg.includes('violates') ||
        msg.includes('RESTRICT') ||
        msg.includes('23503')
      ) {
        setError('Este tipo de perda já está em uso. Desative-o em vez de excluir.')
      } else {
        setError('Erro ao excluir tipo de perda.')
      }
    } finally {
      setDeletingId(null)
    }
  }

  // Separar tipos de sistema dos customizados para exibição organizada
  const systemTypes = lossTypes.filter(lt => lt.is_system)
  const customTypes = lossTypes.filter(lt => !lt.is_system)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Tipos de Perda
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Classifique os motivos pelos quais oportunidades são perdidas.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo tipo
        </button>
      </div>

      {/* Mensagens globais */}
      {error && !showForm && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Formulário inline (apenas para custom) */}
      {showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <h4 className="font-semibold text-slate-800">
            {editing ? 'Editar tipo de perda' : 'Novo tipo de perda'}
          </h4>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Nome *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Preço alto, Sem budget..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
              maxLength={255}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Descrição
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Descrição opcional do tipo de perda"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
              rows={2}
            />
          </div>

          <div className="max-w-[120px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Ordem
            </label>
            <input
              type="number"
              value={form.sort_order}
              onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
              min={0}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              Salvar
            </button>
            <button
              onClick={closeForm}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : lossTypes.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhum tipo de perda cadastrado.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Tipos de sistema */}
          {systemTypes.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Sistema
                </span>
              </div>

              {systemTypes.map(lt => (
                <div
                  key={lt.id}
                  className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 transition-all ${
                    lt.is_hidden ? 'border-slate-100 opacity-60' : 'border-slate-200'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-red-300 shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800 truncate">{lt.name}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 bg-red-50 text-red-600 rounded-full border border-red-100">
                        Sistema
                      </span>
                      {lt.is_hidden && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full border border-amber-100">
                          Oculto
                        </span>
                      )}
                    </div>
                    {lt.description && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{lt.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Ocultar / Exibir — única ação permitida em tipos de sistema */}
                    <button
                      onClick={() => handleToggleHidden(lt)}
                      disabled={togglingId === lt.id}
                      title={lt.is_hidden ? 'Exibir' : 'Ocultar'}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-amber-600 hover:bg-amber-50 border border-transparent hover:border-amber-200 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {togglingId === lt.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : lt.is_hidden
                          ? <Eye className="w-3.5 h-3.5" />
                          : <EyeOff className="w-3.5 h-3.5" />
                      }
                      {lt.is_hidden ? 'Exibir' : 'Ocultar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tipos customizados */}
          {customTypes.length > 0 && (
            <div className="space-y-2">
              {systemTypes.length > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <GripVertical className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Personalizados
                  </span>
                </div>
              )}

              {customTypes.map(lt => (
                <div
                  key={lt.id}
                  className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 transition-all ${
                    lt.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'
                  }`}
                >
                  <GripVertical className="w-4 h-4 text-slate-300 shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{lt.name}</span>
                      {!lt.is_active && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                          Inativo
                        </span>
                      )}
                    </div>
                    {lt.description && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{lt.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(lt)}
                      title="Editar"
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleToggleActive(lt)}
                      title={lt.is_active ? 'Desativar' : 'Ativar'}
                      className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                    >
                      {lt.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => handleDelete(lt)}
                      disabled={deletingId === lt.id}
                      title="Excluir"
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {deletingId === lt.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />
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
