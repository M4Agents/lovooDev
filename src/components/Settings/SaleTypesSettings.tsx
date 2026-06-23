/**
 * SaleTypesSettings
 *
 * Gerencia Tipos de Venda:
 *
 * Tipos de sistema (is_system=true):
 *   - Badge "Sistema" sempre visível
 *   - Badge "Oculto" quando is_hidden=true
 *   - Ação Ocultar/Exibir (via RPC set_system_sale_type_hidden)
 *   - SEM Editar, Ativar/Desativar ou Excluir
 *
 * Tipos customizados (is_system=false):
 *   - CRUD completo (Criar, Editar, Ativar/Desativar, Excluir)
 *   - Excluir bloqueado por FK — orientar desativação
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus, Pencil, Trash2, Eye, EyeOff, GripVertical,
  Tag, Loader2, AlertCircle, CheckCircle2, ShieldCheck,
} from 'lucide-react'
import { saleTypesApi } from '../../services/saleTypesApi'
import type { SaleType } from '../../types/sales-funnel'

interface Props {
  companyId: string
}

interface FormState {
  name: string
  description: string
  sort_order: string
}

const EMPTY_FORM: FormState = { name: '', description: '', sort_order: '1000' }

export const SaleTypesSettings: React.FC<Props> = ({ companyId }) => {
  const { t } = useTranslation('settings.app')

  const [saleTypes, setSaleTypes] = useState<SaleType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<SaleType | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const flash = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await saleTypesApi.getSaleTypes(companyId)
      setSaleTypes(data)
    } catch {
      setError(t('saleTypes.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [companyId, t])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  const openEdit = (st: SaleType) => {
    if (st.is_system) {
      setError(t('saleTypes.systemTypeCannotEdit'))
      return
    }
    setEditing(st)
    setForm({
      name:        st.name,
      description: st.description ?? '',
      sort_order:  String(st.sort_order),
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
      setError(t('saleTypes.errorNameRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await saleTypesApi.updateSaleType(editing.id, companyId, {
          name:        form.name.trim(),
          description: form.description.trim() || null,
          sort_order:  parseInt(form.sort_order) || 1000,
        })
        flash(t('saleTypes.successUpdated'))
      } else {
        await saleTypesApi.createSaleType(companyId, {
          name:        form.name.trim(),
          description: form.description.trim() || null,
          sort_order:  parseInt(form.sort_order) || 1000,
        })
        flash(t('saleTypes.successCreated'))
      }
      closeForm()
      await load()
    } catch {
      setError(t('saleTypes.errorSave'))
    } finally {
      setSaving(false)
    }
  }

  // Apenas para tipos customizados
  const handleToggleActive = async (st: SaleType) => {
    if (st.is_system) return
    try {
      await saleTypesApi.updateSaleType(st.id, companyId, { is_active: !st.is_active })
      flash(st.is_active ? t('saleTypes.successDeactivated') : t('saleTypes.successActivated'))
      await load()
    } catch {
      setError(t('saleTypes.errorSave'))
    }
  }

  // Apenas para tipos de sistema
  const handleToggleHidden = async (st: SaleType) => {
    if (!st.is_system) return
    setTogglingId(st.id)
    setError(null)
    try {
      await saleTypesApi.setSystemSaleTypeHidden(companyId, st.id, !st.is_hidden)
      flash(st.is_hidden ? t('saleTypes.successShown') : t('saleTypes.successHidden'))
      await load()
    } catch {
      setError(t('saleTypes.errorSave'))
    } finally {
      setTogglingId(null)
    }
  }

  // Apenas para tipos customizados
  const handleDelete = async (st: SaleType) => {
    if (st.is_system) return
    if (!window.confirm(t('saleTypes.confirmDelete', { name: st.name }))) return
    setDeletingId(st.id)
    setError(null)
    try {
      await saleTypesApi.deleteSaleType(st.id, companyId)
      flash(t('saleTypes.successDeleted'))
      await load()
    } catch (err: any) {
      const msg = err?.message ?? ''
      if (
        msg.includes('foreign key') ||
        msg.includes('violates') ||
        msg.includes('RESTRICT') ||
        msg.includes('23503')
      ) {
        setError(t('saleTypes.errorDeleteInUse'))
      } else {
        setError(t('saleTypes.errorSave'))
      }
    } finally {
      setDeletingId(null)
    }
  }

  // Separar tipos de sistema dos customizados para exibição organizada
  const systemTypes = saleTypes.filter(st => st.is_system)
  const customTypes = saleTypes.filter(st => !st.is_system)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Tag className="w-5 h-5 text-indigo-600" />
            {t('saleTypes.title')}
          </h3>
          <p className="text-sm text-slate-500 mt-1">{t('saleTypes.subtitle')}</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('saleTypes.btnNew')}
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
            {editing ? t('saleTypes.formTitleEdit') : t('saleTypes.formTitleCreate')}
          </h4>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              {t('saleTypes.fieldName')} *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t('saleTypes.fieldNamePlaceholder')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              maxLength={255}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              {t('saleTypes.fieldDescription')}
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('saleTypes.fieldDescriptionPlaceholder')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
              rows={2}
            />
          </div>

          <div className="max-w-[120px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              {t('saleTypes.fieldOrder')}
            </label>
            <input
              type="number"
              value={form.sort_order}
              onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              min={0}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              {t('saleTypes.btnSave')}
            </button>
            <button
              onClick={closeForm}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              {t('saleTypes.btnCancel')}
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          <span className="text-sm">{t('saleTypes.loading')}</span>
        </div>
      ) : saleTypes.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Tag className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{t('saleTypes.empty')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Tipos de sistema */}
          {systemTypes.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {t('saleTypes.badgeSystem')}
                </span>
              </div>

              {systemTypes.map(st => (
                <div
                  key={st.id}
                  className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 transition-all ${
                    st.is_hidden ? 'border-slate-100 opacity-60' : 'border-slate-200'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-indigo-300 shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800 truncate">{st.name}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100">
                        {t('saleTypes.badgeSystem')}
                      </span>
                      {st.is_hidden && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full border border-amber-100">
                          {t('saleTypes.badgeHidden')}
                        </span>
                      )}
                    </div>
                    {st.description && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{st.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Ocultar / Exibir — única ação permitida em tipos de sistema */}
                    <button
                      onClick={() => handleToggleHidden(st)}
                      disabled={togglingId === st.id}
                      title={st.is_hidden ? t('saleTypes.btnShow') : t('saleTypes.btnHide')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-amber-600 hover:bg-amber-50 border border-transparent hover:border-amber-200 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {togglingId === st.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : st.is_hidden
                          ? <Eye className="w-3.5 h-3.5" />
                          : <EyeOff className="w-3.5 h-3.5" />
                      }
                      {st.is_hidden ? t('saleTypes.btnShow') : t('saleTypes.btnHide')}
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

              {customTypes.map(st => (
                <div
                  key={st.id}
                  className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 transition-all ${
                    st.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'
                  }`}
                >
                  <GripVertical className="w-4 h-4 text-slate-300 shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{st.name}</span>
                      {!st.is_active && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                          {t('saleTypes.badgeInactive')}
                        </span>
                      )}
                    </div>
                    {st.description && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{st.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(st)}
                      title={t('saleTypes.btnEdit')}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleToggleActive(st)}
                      title={st.is_active ? t('saleTypes.btnDeactivate') : t('saleTypes.btnActivate')}
                      className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                    >
                      {st.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => handleDelete(st)}
                      disabled={deletingId === st.id}
                      title={t('saleTypes.btnDelete')}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {deletingId === st.id
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
