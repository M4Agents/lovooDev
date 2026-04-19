// =============================================================================
// src/components/Settings/AiPlansPanel.tsx
//
// Painel de gestão de IA para empresa pai (company_type === 'parent').
// Integrado em: Configurações → Agentes Globais
//
// BLOCOS:
//   1. Planos Mensais  — edição de cota de créditos de IA por plano
//   2. Pacotes Avulsos — CRUD de credit_packages
//
// REGRAS:
//   - Acesso: canManageOpenAI (isSaaSAdmin)
//   - monthly_ai_credits só afeta próxima renovação (aviso obrigatório)
//   - valid_days NÃO é exibido (sem efeito funcional na v1)
//   - Tokens e custo OpenAI: NUNCA exibidos
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Package, Plus, Pencil, Check, X, Loader2, Power } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Plan {
  id:                 string
  name:               string
  slug:               string
  is_active:          boolean
  monthly_ai_credits: number
}

interface CreditPackage {
  id:        string
  name:      string
  credits:   number
  price:     number
  is_active: boolean
}

interface PackageForm {
  name:      string
  credits:   string
  price:     string
  is_active: boolean
}

const EMPTY_FORM: PackageForm = { name: '', credits: '', price: '', is_active: true }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatCredits(n: number): string {
  return n.toLocaleString('pt-BR')
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, right }: {
  icon: React.ReactNode
  title: string
  right?: React.ReactNode
}) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-violet-600">{icon}</span>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      {right}
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-5 my-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
      {message}
    </div>
  )
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="mx-5 my-3 px-4 py-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg flex items-center gap-2">
      <Check size={14} />
      {message}
    </div>
  )
}

// ── Modal de confirmação (planos) ─────────────────────────────────────────────

function ConfirmPlanModal({
  planName,
  newCredits,
  saving,
  onConfirm,
  onCancel,
}: {
  planName:   string
  newCredits: number
  saving:     boolean
  onConfirm:  () => void
  onCancel:   () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Confirmar alteração</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-slate-700">
            Esta alteração atualizará a cota de créditos de IA do plano{' '}
            <strong>{planName}</strong> para{' '}
            <strong>{formatCredits(newCredits)} créditos/mês</strong>.
          </p>
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            A nova cota entrará em vigor apenas na <strong>próxima renovação</strong> das
            empresas que utilizam este plano. O ciclo atual não é afetado.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Confirmar alteração
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal de pacote ───────────────────────────────────────────────────────────

function PackageModal({
  mode,
  form,
  saving,
  error,
  onChange,
  onSave,
  onClose,
}: {
  mode:     'create' | 'edit'
  form:     PackageForm
  saving:   boolean
  error:    string | null
  onChange: (f: Partial<PackageForm>) => void
  onSave:   () => void
  onClose:  () => void
}) {
  const isValid = form.name.trim() && Number(form.credits) > 0 && Number(form.price) >= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">
            {mode === 'create' ? 'Novo pacote de créditos' : 'Editar pacote'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <ErrorBanner message={error} />}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Nome do pacote</label>
            <input
              type="text"
              value={form.name}
              onChange={e => onChange({ name: e.target.value })}
              placeholder="Ex: Pacote 500 créditos"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Créditos</label>
              <input
                type="number"
                min={1}
                step={1}
                value={form.credits}
                onChange={e => onChange({ credits: e.target.value })}
                placeholder="500"
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Preço (R$)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.price}
                onChange={e => onChange({ price: e.target.value })}
                placeholder="49.90"
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => onChange({ is_active: e.target.checked })}
              className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            />
            <span className="text-sm text-slate-700">Pacote ativo (visível para compra)</span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving || !isValid}
            className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {mode === 'create' ? 'Criar pacote' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AiPlansPanel() {
  // ── Estado: planos ───────────────────────────────────────────────────────
  const [plans,         setPlans]         = useState<Plan[]>([])
  const [loadingPlans,  setLoadingPlans]  = useState(true)
  const [errorPlans,    setErrorPlans]    = useState<string | null>(null)
  const [successPlans,  setSuccessPlans]  = useState<string | null>(null)

  // Edição inline de cota: { planId, draftValue }
  const [editingPlan,   setEditingPlan]   = useState<{ id: string; draft: string } | null>(null)
  // Modal de confirmação antes de salvar
  const [confirmPlan,   setConfirmPlan]   = useState<{ plan: Plan; newCredits: number } | null>(null)
  const [savingPlan,    setSavingPlan]    = useState(false)

  // ── Estado: pacotes ──────────────────────────────────────────────────────
  const [packages,       setPackages]      = useState<CreditPackage[]>([])
  const [loadingPkgs,    setLoadingPkgs]   = useState(true)
  const [errorPkgs,      setErrorPkgs]     = useState<string | null>(null)
  const [successPkgs,    setSuccessPkgs]   = useState<string | null>(null)

  const [packageModal,   setPackageModal]  = useState<{ mode: 'create' | 'edit'; pkg?: CreditPackage } | null>(null)
  const [packageForm,    setPackageForm]   = useState<PackageForm>(EMPTY_FORM)
  const [savingPkg,      setSavingPkg]     = useState(false)
  const [errorPkgForm,   setErrorPkgForm]  = useState<string | null>(null)
  const [togglingPkg,    setTogglingPkg]   = useState<string | null>(null)

  // ── Carregar planos ──────────────────────────────────────────────────────

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true)
    setErrorPlans(null)
    try {
      const { data, error } = await supabase
        .from('plans')
        .select('id, name, slug, is_active, monthly_ai_credits')
        .order('sort_order', { ascending: true })
      if (error) throw error
      setPlans((data ?? []) as Plan[])
    } catch (err) {
      setErrorPlans(err instanceof Error ? err.message : 'Erro ao carregar planos')
    } finally {
      setLoadingPlans(false)
    }
  }, [])

  // ── Carregar pacotes ─────────────────────────────────────────────────────

  const loadPackages = useCallback(async () => {
    setLoadingPkgs(true)
    setErrorPkgs(null)
    try {
      const { data, error } = await supabase
        .from('credit_packages')
        .select('id, name, credits, price, is_active')
        .order('credits', { ascending: true })
      if (error) throw error
      setPackages((data ?? []) as CreditPackage[])
    } catch (err) {
      setErrorPkgs(err instanceof Error ? err.message : 'Erro ao carregar pacotes')
    } finally {
      setLoadingPkgs(false)
    }
  }, [])

  useEffect(() => {
    void loadPlans()
    void loadPackages()
  }, [loadPlans, loadPackages])

  // ── Feedback com auto-dismiss ────────────────────────────────────────────

  function showSuccessPlans(msg: string) {
    setSuccessPlans(msg)
    setTimeout(() => setSuccessPlans(null), 4000)
  }

  function showSuccessPkgs(msg: string) {
    setSuccessPkgs(msg)
    setTimeout(() => setSuccessPkgs(null), 4000)
  }

  // ── Salvar cota do plano ─────────────────────────────────────────────────

  async function savePlanCredits() {
    if (!confirmPlan) return
    setSavingPlan(true)
    try {
      const { data, error } = await supabase.rpc('update_plan_ai_credits', {
        p_plan_id: confirmPlan.plan.id,
        p_credits:  confirmPlan.newCredits,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error ?? 'Erro ao salvar cota')
      setPlans(prev => prev.map(p =>
        p.id === confirmPlan.plan.id
          ? { ...p, monthly_ai_credits: confirmPlan.newCredits }
          : p
      ))
      setConfirmPlan(null)
      setEditingPlan(null)
      showSuccessPlans(`Cota do plano "${confirmPlan.plan.name}" atualizada. Aplicada na próxima renovação.`)
    } catch (err) {
      setErrorPlans(err instanceof Error ? err.message : 'Erro ao salvar cota')
      setConfirmPlan(null)
    } finally {
      setSavingPlan(false)
    }
  }

  // ── Salvar pacote (create/edit) ──────────────────────────────────────────

  async function savePackage() {
    const credits = parseInt(packageForm.credits, 10)
    const price   = parseFloat(packageForm.price)
    if (!packageForm.name.trim() || credits <= 0 || isNaN(price) || price < 0) return

    setSavingPkg(true)
    setErrorPkgForm(null)
    try {
      if (packageModal?.mode === 'create') {
        const { error } = await supabase.from('credit_packages').insert({
          name:      packageForm.name.trim(),
          credits,
          price,
          is_active: packageForm.is_active,
        })
        if (error) throw error
        showSuccessPkgs('Pacote criado com sucesso.')
      } else if (packageModal?.pkg) {
        const { error } = await supabase
          .from('credit_packages')
          .update({
            name:      packageForm.name.trim(),
            credits,
            price,
            is_active: packageForm.is_active,
          })
          .eq('id', packageModal.pkg.id)
        if (error) throw error
        showSuccessPkgs('Pacote atualizado com sucesso.')
      }
      setPackageModal(null)
      void loadPackages()
    } catch (err) {
      setErrorPkgForm(err instanceof Error ? err.message : 'Erro ao salvar pacote')
    } finally {
      setSavingPkg(false)
    }
  }

  // ── Toggle ativo/inativo do pacote ───────────────────────────────────────

  async function togglePackage(pkg: CreditPackage) {
    setTogglingPkg(pkg.id)
    try {
      const { error } = await supabase
        .from('credit_packages')
        .update({ is_active: !pkg.is_active })
        .eq('id', pkg.id)
      if (error) throw error
      setPackages(prev => prev.map(p =>
        p.id === pkg.id ? { ...p, is_active: !p.is_active } : p
      ))
    } catch (err) {
      setErrorPkgs(err instanceof Error ? err.message : 'Erro ao alterar status do pacote')
    } finally {
      setTogglingPkg(null)
    }
  }

  // ── Abrir modal de pacote ────────────────────────────────────────────────

  function openPackageModal(mode: 'create' | 'edit', pkg?: CreditPackage) {
    setErrorPkgForm(null)
    setPackageForm(
      pkg
        ? { name: pkg.name, credits: String(pkg.credits), price: String(pkg.price), is_active: pkg.is_active }
        : EMPTY_FORM
    )
    setPackageModal({ mode, pkg })
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── 1. Planos Mensais ──────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <SectionHeader
          icon={<Sparkles size={16} />}
          title="Planos Mensais — Cota de IA"
        />

        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
          <p className="text-xs text-amber-700">
            Alterações na cota de créditos entram em vigor apenas na <strong>próxima renovação</strong> das
            empresas que utilizam cada plano. O ciclo em andamento não é afetado.
          </p>
        </div>

        {successPlans && <SuccessBanner message={successPlans} />}
        {!loadingPlans && errorPlans && <ErrorBanner message={errorPlans} />}

        {loadingPlans ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4">
                <div className="h-4 bg-slate-100 rounded animate-pulse w-32" />
                <div className="h-4 bg-slate-100 rounded animate-pulse w-20 ml-auto" />
                <div className="h-8 bg-slate-100 rounded animate-pulse w-24" />
              </div>
            ))}
          </div>
        ) : plans.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Nenhum plano encontrado</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {plans.map(plan => {
              const isEditing = editingPlan?.id === plan.id

              return (
                <div key={plan.id} className="px-5 py-4 flex items-center gap-4 flex-wrap">
                  {/* Nome e status */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-slate-800 truncate">{plan.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      plan.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {plan.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>

                  {/* Cota atual / input de edição */}
                  <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                    {isEditing ? (
                      <>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step={100}
                            value={editingPlan.draft}
                            onChange={e => setEditingPlan({ id: plan.id, draft: e.target.value })}
                            className="w-28 border border-violet-400 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-right tabular-nums"
                            autoFocus
                          />
                          <span className="text-xs text-slate-400 whitespace-nowrap">cr/mês</span>
                        </div>
                        <button
                          onClick={() => {
                            const v = parseInt(editingPlan.draft, 10)
                            if (isNaN(v) || v < 0) return
                            setConfirmPlan({ plan, newCredits: v })
                          }}
                          className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => setEditingPlan(null)}
                          className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-slate-600 tabular-nums">
                          <strong>{formatCredits(plan.monthly_ai_credits)}</strong>
                          <span className="text-slate-400 text-xs ml-1">cr/mês</span>
                        </span>
                        <button
                          onClick={() => setEditingPlan({ id: plan.id, draft: String(plan.monthly_ai_credits) })}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                        >
                          <Pencil size={12} />
                          Editar cota
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 2. Pacotes de Créditos Avulsos ─────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <SectionHeader
          icon={<Package size={16} />}
          title="Pacotes de Créditos Avulsos"
          right={
            <button
              onClick={() => openPackageModal('create')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
            >
              <Plus size={13} />
              Novo pacote
            </button>
          }
        />

        {successPkgs && <SuccessBanner message={successPkgs} />}
        {!loadingPkgs && errorPkgs && <ErrorBanner message={errorPkgs} />}

        {loadingPkgs ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {[1, 2, 3, 4].map(j => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : packages.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Package size={24} className="mx-auto mb-2 text-slate-200" />
            <p className="text-sm text-slate-400">Nenhum pacote cadastrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Nome</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Créditos</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Preço</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {packages.map(pkg => (
                  <tr key={pkg.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-800">{pkg.name}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                      {formatCredits(pkg.credits)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700 font-mono text-xs">
                      {formatPrice(pkg.price)}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        pkg.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {pkg.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openPackageModal('edit', pkg)}
                          title="Editar"
                          className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => togglePackage(pkg)}
                          disabled={togglingPkg === pkg.id}
                          title={pkg.is_active ? 'Desativar' : 'Ativar'}
                          className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
                            pkg.is_active
                              ? 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                              : 'text-slate-400 hover:text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {togglingPkg === pkg.id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Power size={14} />
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {confirmPlan && (
        <ConfirmPlanModal
          planName={confirmPlan.plan.name}
          newCredits={confirmPlan.newCredits}
          saving={savingPlan}
          onConfirm={savePlanCredits}
          onCancel={() => setConfirmPlan(null)}
        />
      )}

      {packageModal && (
        <PackageModal
          mode={packageModal.mode}
          form={packageForm}
          saving={savingPkg}
          error={errorPkgForm}
          onChange={partial => setPackageForm(f => ({ ...f, ...partial }))}
          onSave={savePackage}
          onClose={() => setPackageModal(null)}
        />
      )}

    </div>
  )
}
