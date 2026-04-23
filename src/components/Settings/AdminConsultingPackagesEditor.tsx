// =============================================================================
// src/components/Settings/AdminConsultingPackagesEditor.tsx
//
// Catálogo de pacotes consultivos — exclusivo para platform admin.
// Permite criar e editar pacotes com campos comerciais opcionais:
//   - headline, subheadline, features (lista), cta_text, badge_text
//   - is_highlighted, display_order
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { Package, Plus, Edit2, X, Loader2, AlertCircle, CheckCircle2, Star, GripVertical } from 'lucide-react'
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
  id:      string
  name:    string
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
  headline:               '',
  subheadline:            '',
  features:               null,
  cta_text:               '',
  badge_text:             '',
  is_highlighted:         false,
  display_order:          0,
})

// Converte array de features em texto (uma por linha) para edição
function featuresToText(features: string[] | null | undefined): string {
  return features?.join('\n') ?? ''
}

// Converte texto (uma linha por feature) de volta para array
function textToFeatures(text: string): string[] | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length > 0 ? lines : null
}

// ── Painel principal ──────────────────────────────────────────────────────────

export function AdminConsultingPackagesEditor() {
  const [packages, setPackages]   = useState<ConsultingPackage[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState<string | null>(null)
  const [editing, setEditing]     = useState<ConsultingPackage | null>(null)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState<ConsultingPackagePayload>(emptyForm())
  const [featuresText, setFeaturesText] = useState('')
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
    const f = emptyForm()
    setForm(f)
    setFeaturesText('')
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
      headline:               pkg.headline   ?? '',
      subheadline:            pkg.subheadline ?? '',
      features:               pkg.features   ?? null,
      cta_text:               pkg.cta_text   ?? '',
      badge_text:             pkg.badge_text  ?? '',
      is_highlighted:         pkg.is_highlighted,
      display_order:          pkg.display_order,
    })
    setFeaturesText(featuresToText(pkg.features))
    setFormError(null)
    setShowForm(true)
  }

  function set<K extends keyof ConsultingPackagePayload>(key: K, value: ConsultingPackagePayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.package_type || (form.hours ?? 0) <= 0) {
      setFormError('Preencha nome, tipo e horas (> 0)')
      return
    }

    const payload: ConsultingPackagePayload = {
      ...form,
      headline:    form.headline    || null,
      subheadline: form.subheadline || null,
      cta_text:    form.cta_text    || null,
      badge_text:  form.badge_text  || null,
      description: form.description || null,
      features:    textToFeatures(featuresText),
    }

    setSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await updateAdminConsultingPackage(editing.id, payload)
        setSuccess('Pacote atualizado com sucesso')
      } else {
        await createAdminConsultingPackage(payload)
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
          <div className="flex items-center justify-between mb-5">
            <h4 className="text-sm font-semibold text-slate-800">
              {editing ? 'Editar pacote' : 'Novo pacote'}
            </h4>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-5">

            {/* ── Dados básicos ──────────────────────────────────── */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Dados básicos</legend>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  required
                  placeholder="Ex: Pacote Starter de Implementação"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Descrição interna <span className="text-slate-400">(fallback quando headline/benefícios não preenchidos)</span>
                </label>
                <textarea
                  value={form.description ?? ''}
                  onChange={(e) => set('description', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white resize-none"
                />
              </div>
            </fieldset>

            {/* ── Conteúdo comercial ─────────────────────────────── */}
            <fieldset className="space-y-4 pt-2 border-t border-slate-200">
              <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 pt-2">Conteúdo comercial</legend>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Headline <span className="text-slate-400">(frase de promessa no card)</span>
                </label>
                <input
                  type="text"
                  value={form.headline ?? ''}
                  onChange={(e) => set('headline', e.target.value)}
                  placeholder="Ex: Configure tudo do zero sem complicação"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Subheadline <span className="text-slate-400">(detalhamento abaixo do headline)</span>
                </label>
                <input
                  type="text"
                  value={form.subheadline ?? ''}
                  onChange={(e) => set('subheadline', e.target.value)}
                  placeholder="Ex: Ideal para empresas iniciando com CRM pela primeira vez"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Benefícios <span className="text-slate-400">(um por linha — máximo 5 exibidos no card)</span>
                </label>
                <textarea
                  value={featuresText}
                  onChange={(e) => setFeaturesText(e.target.value)}
                  rows={6}
                  placeholder={"Configuração completa do funil de vendas\nImportação de leads existentes\nIntegração com WhatsApp\nTreinamento da equipe de vendas\nSuporto pós-implantação"}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white resize-none font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">
                  {textToFeatures(featuresText)?.length ?? 0} benefício(s) cadastrado(s). Card exibe até 5; excedente como "+N benefícios".
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Texto do CTA <span className="text-slate-400">(botão de compra)</span>
                  </label>
                  <input
                    type="text"
                    value={form.cta_text ?? ''}
                    onChange={(e) => set('cta_text', e.target.value)}
                    placeholder="Ex: Começar implantação"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Badge <span className="text-slate-400">(ex: Mais escolhido)</span>
                  </label>
                  <input
                    type="text"
                    value={form.badge_text ?? ''}
                    onChange={(e) => set('badge_text', e.target.value)}
                    placeholder="Ex: Mais escolhido"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  />
                </div>
              </div>
            </fieldset>

            {/* ── Exibição e bônus ───────────────────────────────── */}
            <fieldset className="space-y-4 pt-2 border-t border-slate-200">
              <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 pt-2">Exibição e bônus</legend>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Ordem de exibição <span className="text-slate-400">(menor número = primeiro)</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={form.display_order ?? 0}
                    onChange={(e) => set('display_order', Number(e.target.value))}
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

              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_highlighted ?? false}
                    onChange={(e) => set('is_highlighted', e.target.checked)}
                    className="rounded accent-blue-600"
                  />
                  <span>
                    <span className="font-medium">Pacote em destaque</span>
                    <span className="text-slate-400 text-xs ml-1">(borda, sombra e fundo diferenciados)</span>
                  </span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active ?? true}
                    onChange={(e) => set('is_active', e.target.checked)}
                    className="rounded accent-blue-600"
                  />
                  Ativo
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_available_for_sale ?? true}
                    onChange={(e) => set('is_available_for_sale', e.target.checked)}
                    className="rounded accent-blue-600"
                  />
                  Disponível para venda
                </label>
              </div>
            </fieldset>

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
                <th className="text-left px-4 py-3 font-medium w-6"></th>
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium">Tipo</th>
                <th className="text-left px-4 py-3 font-medium">Horas</th>
                <th className="text-left px-4 py-3 font-medium">Preço</th>
                <th className="text-left px-4 py-3 font-medium">Bônus IA</th>
                <th className="text-left px-4 py-3 font-medium">Ordem</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {packages.map((pkg) => (
                <tr key={pkg.id} className={`hover:bg-slate-50 transition-colors ${pkg.is_highlighted ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-3 py-3 text-slate-300">
                    <GripVertical size={14} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{pkg.name}</p>
                    {pkg.headline && <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{pkg.headline}</p>}
                  </td>
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
                  <td className="px-4 py-3 text-slate-500 text-xs text-center">{pkg.display_order}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {pkg.is_highlighted && (
                        <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">Destaque</span>
                      )}
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
