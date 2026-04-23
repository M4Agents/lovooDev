// =============================================================================
// src/components/Settings/AdminConsultingPackagesEditor.tsx
//
// Catálogo de pacotes consultivos — exclusivo para platform admin.
// Permite criar e editar pacotes (nome, tipo, horas, preço, bônus de IA).
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { Package, Plus, Edit2, X, Loader2, AlertCircle, CheckCircle2, Star } from 'lucide-react'
import {
  fetchAdminConsultingPackages,
  createAdminConsultingPackage,
  updateAdminConsultingPackage,
  type ConsultingPackage,
  type ConsultingPackagePayload,
} from '../../services/consultingApi'
import { supabase } from '../../lib/supabase'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface BonusOption {
  id:   string
  name: string
  credits: number
}

const ENTRY_TYPES = [
  { value: 'implementation', label: 'Implementação' },
  { value: 'training',       label: 'Treinamento'   },
  { value: 'consulting',     label: 'Consultoria'   },
] as const

const emptyForm = (): ConsultingPackagePayload => ({
  name:                   '',
  description:            '',
  package_type:           'consulting',
  hours:                  10,
  price:                  0,
  is_active:              true,
  is_available_for_sale:  true,
  bonus_credit_package_id: null,
})

// ── Painel principal ──────────────────────────────────────────────────────────

export function AdminConsultingPackagesEditor() {
  const [packages, setPackages]   = useState<ConsultingPackage[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState<string | null>(null)
  const [editing, setEditing]     = useState<ConsultingPackage | null>(null)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState<ConsultingPackagePayload>(emptyForm())
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [bonusOptions, setBonusOptions] = useState<BonusOption[]>([])

  const loadPackages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const pkgs = await fetchAdminConsultingPackages()
      setPackages(pkgs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar catálogo')
    } finally {
      setLoading(false)
    }
  }, [])

  // Carregar opções de bônus (credit_packages com is_available_for_bonus=true)
  const loadBonusOptions = useCallback(async () => {
    const { data } = await supabase
      .from('credit_packages')
      .select('id, name, credits')
      .eq('is_active', true)
      .eq('is_available_for_bonus', true)
      .order('name')
    if (data) setBonusOptions(data)
  }, [])

  useEffect(() => {
    void loadPackages()
    void loadBonusOptions()
  }, [loadPackages, loadBonusOptions])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(pkg: ConsultingPackage) {
    setEditing(pkg)
    setForm({
      name:                   pkg.name,
      description:            pkg.description ?? '',
      package_type:           pkg.package_type,
      hours:                  pkg.hours,
      price:                  pkg.price,
      is_active:              pkg.is_active,
      is_available_for_sale:  pkg.is_available_for_sale,
      bonus_credit_package_id: pkg.bonus_credit_package_id ?? null,
    })
    setFormError(null)
    setShowForm(true)
  }

  function set<K extends keyof ConsultingPackagePayload>(key: K, value: ConsultingPackagePayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.package_type || form.hours <= 0) {
      setFormError('Preencha nome, tipo e horas (> 0)')
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await updateAdminConsultingPackage(editing.id, form)
        setSuccess('Pacote atualizado com sucesso')
      } else {
        await createAdminConsultingPackage(form)
        setSuccess('Pacote criado com sucesso')
      }
      setShowForm(false)
      void loadPackages()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Package size={18} />Catálogo de pacotes consultivos
        </h3>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
        >
          <Plus size={14} />Novo pacote
        </button>
      </div>

      {success && (
        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm">
          <CheckCircle2 size={16} />{success}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {/* Formulário */}
      {showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-slate-800">
              {editing ? 'Editar pacote' : 'Novo pacote'}
            </h4>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo *</label>
                <select
                  value={form.package_type}
                  onChange={(e) => set('package_type', e.target.value as ConsultingPackagePayload['package_type'])}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  {ENTRY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Horas *</label>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={form.hours}
                  onChange={(e) => set('hours', Number(e.target.value))}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Preço (R$) *</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.price}
                  onChange={(e) => set('price', Number(e.target.value))}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                  <Star size={12} className="text-violet-500" />Bônus de créditos de IA
                </label>
                <select
                  value={form.bonus_credit_package_id ?? ''}
                  onChange={(e) => set('bonus_credit_package_id', e.target.value || null)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="">Sem bônus</option>
                  {bonusOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name} ({opt.credits.toLocaleString('pt-BR')} créditos)
                    </option>
                  ))}
                </select>
                {bonusOptions.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1">Nenhum pacote marcado como disponível para bônus.</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Descrição</label>
              <textarea
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white resize-none"
              />
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active ?? true}
                  onChange={(e) => set('is_active', e.target.checked)}
                  className="rounded"
                />
                Ativo
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_available_for_sale ?? true}
                  onChange={(e) => set('is_available_for_sale', e.target.checked)}
                  className="rounded"
                />
                Disponível para venda
              </label>
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <AlertCircle size={14} />{formError}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar pacote'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de pacotes */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={22} className="animate-spin text-blue-500" />
        </div>
      ) : packages.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Package size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhum pacote cadastrado. Crie o primeiro.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium">Tipo</th>
                <th className="text-left px-4 py-3 font-medium">Horas</th>
                <th className="text-left px-4 py-3 font-medium">Preço</th>
                <th className="text-left px-4 py-3 font-medium">Bônus IA</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {packages.map((pkg) => (
                <tr key={pkg.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-800 font-medium">{pkg.name}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs capitalize">{pkg.package_type}</td>
                  <td className="px-4 py-3 text-slate-600">{pkg.hours}h</td>
                  <td className="px-4 py-3 text-slate-800">
                    {Number(pkg.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {pkg.bonus_credit
                      ? <span className="text-violet-600">+{pkg.bonus_credit.credits.toLocaleString('pt-BR')} créditos</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {pkg.is_active
                        ? <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">Ativo</span>
                        : <span className="text-xs text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">Inativo</span>}
                      {pkg.is_available_for_sale
                        ? <span className="text-xs text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded">À venda</span>
                        : <span className="text-xs text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">Não venda</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(pkg)}
                      className="text-slate-400 hover:text-blue-600 transition"
                      title="Editar"
                    >
                      <Edit2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
