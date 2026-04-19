// =============================================================================
// src/components/Settings/AiPlansPanel.tsx
//
// Painel de gestão de IA para empresa pai (company_type === 'parent').
// Integrado em: Configurações → Agentes Globais
//
// BLOCOS:
//   1. Planos Mensais  — tabela com governança + criar + ativar/desativar + editar cota
//   2. Pacotes Avulsos — CRUD de credit_packages
//
// GOVERNANÇA INTERNA:
//   - Campos estimated_tokens, estimated_ai_cost são calculados e entregues
//     exclusivamente pelas RPCs admin-only:
//       get_credit_packages_admin()   → pacotes + custo/tokens/lucro
//       get_plans_governance()        → planos + custo/tokens
//   - Empresa filha NUNCA recebe esses valores (exceção lançada no banco)
//   - Constantes locais (TOKENS_PER_CREDIT etc.) são usadas APENAS para
//     preview visual no modal do admin durante digitação — fonte oficial é o banco
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Package, Plus, Pencil, Check, X, Loader2, Power, TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Constantes de governança (apenas para preview UX local no admin) ──────────

const TOKENS_PER_CREDIT       = 10
const COST_PER_1K_TOKENS_BRL  = 0.015

function govTokens(credits: number): number {
  return credits * TOKENS_PER_CREDIT
}

function govAiCost(credits: number): number {
  return Math.round((govTokens(credits) / 1000) * COST_PER_1K_TOKENS_BRL * 100) / 100
}

function govProfit(price: number, credits: number): number {
  return Math.round((price - govAiCost(credits)) * 100) / 100
}

// ── Estimativa de conversas (UX only — sem impacto no billing) ────────────────
// Regra: 1 conversa ≈ 500 tokens ≈ 50 créditos (1 crédito = 10 tokens)

const CREDITS_PER_CONVERSATION = 50

function estConversas(credits: number): number {
  return Math.floor(credits / CREDITS_PER_CONVERSATION)
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Plan {
  id:                 string
  name:               string
  slug:               string
  is_active:          boolean
  price:              number
  monthly_ai_credits: number
  sort_order:         number
  // Campos de governança — entregues pela RPC get_plans_governance()
  estimated_tokens:   number
  estimated_ai_cost:  number
}

interface CreditPackage {
  id:                string
  name:              string
  credits:           number
  price:             number
  is_active:         boolean
  // Campos de governança — entregues pela RPC get_credit_packages_admin()
  estimated_tokens:  number
  estimated_ai_cost: number
  estimated_profit:  number
}

interface PackageForm {
  name:      string
  credits:   string
  price:     string
  is_active: boolean
}

interface PlanForm {
  name:               string
  slug:               string
  monthly_ai_credits: string
  is_active:          boolean
}

const EMPTY_PKG_FORM:  PackageForm = { name: '', credits: '', price: '', is_active: true }
const EMPTY_PLAN_FORM: PlanForm    = { name: '', slug: '', monthly_ai_credits: '0', is_active: true }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatCredits(n: number): string {
  return n.toLocaleString('pt-BR')
}

// Preço por conversa — exibição UX, sem impacto em billing
function precoConversa(price: number, credits: number): string {
  const conv = estConversas(credits)
  if (conv === 0 || price === 0) return '—'
  return formatPrice(Math.round((price / conv) * 100) / 100)
}

// Slug a partir do nome: lowercase, sem acentos, espaços → hífen
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
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

// ── Preview de governança — somente UX local no admin ─────────────────────────

function GovernancePreview({ credits, price }: { credits: number; price: number }) {
  if (credits <= 0 || price < 0) return null

  const tokens  = govTokens(credits)
  const cost    = govAiCost(credits)
  const profit  = govProfit(price, credits)

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 space-y-2">
      <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
        <TrendingUp size={12} className="text-violet-500" />
        Referência interna de governança (preview)
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Tokens estimados</p>
          <p className="text-sm font-semibold text-slate-700 tabular-nums">{formatCredits(tokens)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Custo estimado</p>
          <p className="text-sm font-semibold text-slate-700 tabular-nums">{formatPrice(cost)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Lucro estimado</p>
          <p className={`text-sm font-semibold tabular-nums ${profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {formatPrice(profit)}
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-400 italic">
        Preview local — valores oficiais calculados e validados no banco
      </p>
    </div>
  )
}

// ── Modal: editar cota de créditos de um plano ────────────────────────────────

function EditCotaModal({
  plan,
  saving,
  onSave,
  onClose,
}: {
  plan:    Plan
  saving:  boolean
  onSave:  (credits: number) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(String(plan.monthly_ai_credits))
  const credits = parseInt(draft, 10)
  const isValid = !isNaN(credits) && credits >= 0
  const conv    = isValid && credits > 0 ? estConversas(credits) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Editar cota de IA — {plan.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Créditos de IA / mês</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={100}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
                className="flex-1 border border-violet-400 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 text-right tabular-nums"
              />
              <span className="text-xs text-slate-400 whitespace-nowrap">cr/mês</span>
            </div>
            {isValid && credits > 0 && (
              <p className="text-xs text-violet-600 mt-0.5">
                ≈ {formatCredits(conv)} conversas estimadas
              </p>
            )}
          </div>
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            A nova cota entrará em vigor apenas na <strong>próxima renovação</strong> das
            empresas que utilizam este plano. O ciclo atual não é afetado.
          </p>
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
            onClick={() => onSave(credits)}
            disabled={saving || !isValid}
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

// ── Modal: criar novo plano ───────────────────────────────────────────────────

function PlanModal({
  form,
  saving,
  error,
  onChange,
  onSave,
  onClose,
}: {
  form:     PlanForm
  saving:   boolean
  error:    string | null
  onChange: (f: Partial<PlanForm>) => void
  onSave:   () => void
  onClose:  () => void
}) {
  const credits = parseInt(form.monthly_ai_credits, 10) || 0
  const isValid = form.name.trim().length > 0 && form.slug.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Novo plano de IA</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <ErrorBanner message={error} />}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Nome do plano</label>
            <input
              type="text"
              value={form.name}
              onChange={e => {
                const name = e.target.value
                onChange({ name, slug: generateSlug(name) })
              }}
              placeholder="Ex: Business"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Slug</label>
            <input
              type="text"
              value={form.slug}
              onChange={e => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              placeholder="business"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-slate-400">Identificador único do plano (gerado automaticamente)</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Créditos de IA / mês</label>
            <input
              type="number"
              min={0}
              step={100}
              value={form.monthly_ai_credits}
              onChange={e => onChange({ monthly_ai_credits: e.target.value })}
              placeholder="0"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {credits > 0 && (
              <p className="text-xs text-violet-600 mt-0.5">
                ≈ {formatCredits(estConversas(credits))} conversas estimadas
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => onChange({ is_active: e.target.checked })}
              className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            />
            <span className="text-sm text-slate-700">Plano ativo</span>
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
            Criar plano
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
  const credits  = parseInt(form.credits, 10)
  const price    = parseFloat(form.price)
  const isValid  = form.name.trim() && credits > 0 && !isNaN(price) && price >= 0
  const showPrev = credits > 0 && !isNaN(price) && price >= 0

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
              {credits > 0 && (
                <p className="text-xs text-violet-600 mt-0.5">
                  ≈ {formatCredits(estConversas(credits))} conversas estimadas
                </p>
              )}
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

          {showPrev && (
            <GovernancePreview credits={credits} price={price} />
          )}

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
  const [plans,        setPlans]        = useState<Plan[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [errorPlans,   setErrorPlans]   = useState<string | null>(null)
  const [successPlans, setSuccessPlans] = useState<string | null>(null)

  // Editar cota
  const [editingCota,  setEditingCota]  = useState<Plan | null>(null)
  const [savingCota,   setSavingCota]   = useState(false)

  // Criar plano
  const [planModalOpen,  setPlanModalOpen]  = useState(false)
  const [planForm,       setPlanForm]       = useState<PlanForm>(EMPTY_PLAN_FORM)
  const [savingPlanForm, setSavingPlanForm] = useState(false)
  const [errorPlanForm,  setErrorPlanForm]  = useState<string | null>(null)

  // Toggle ativo/inativo
  const [togglingPlan, setTogglingPlan] = useState<string | null>(null)

  // ── Estado: pacotes ──────────────────────────────────────────────────────
  const [packages,      setPackages]     = useState<CreditPackage[]>([])
  const [loadingPkgs,   setLoadingPkgs]  = useState(true)
  const [errorPkgs,     setErrorPkgs]    = useState<string | null>(null)
  const [successPkgs,   setSuccessPkgs]  = useState<string | null>(null)

  const [packageModal,  setPackageModal]  = useState<{ mode: 'create' | 'edit'; pkg?: CreditPackage } | null>(null)
  const [packageForm,   setPackageForm]   = useState<PackageForm>(EMPTY_PKG_FORM)
  const [savingPkg,     setSavingPkg]     = useState(false)
  const [errorPkgForm,  setErrorPkgForm]  = useState<string | null>(null)
  const [togglingPkg,   setTogglingPkg]   = useState<string | null>(null)

  // ── Carregar planos via RPC admin-only ───────────────────────────────────

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true)
    setErrorPlans(null)
    try {
      const { data, error } = await supabase.rpc('get_plans_governance')
      if (error) throw error
      setPlans((data ?? []) as Plan[])
    } catch (err) {
      setErrorPlans(err instanceof Error ? err.message : 'Erro ao carregar planos')
    } finally {
      setLoadingPlans(false)
    }
  }, [])

  // ── Carregar pacotes via RPC admin-only ──────────────────────────────────

  const loadPackages = useCallback(async () => {
    setLoadingPkgs(true)
    setErrorPkgs(null)
    try {
      const { data, error } = await supabase.rpc('get_credit_packages_admin')
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

  async function savePlanCredits(plan: Plan, newCredits: number) {
    setSavingCota(true)
    try {
      const { data, error } = await supabase.rpc('update_plan_ai_credits', {
        p_plan_id: plan.id,
        p_credits: newCredits,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error ?? 'Erro ao salvar cota')
      setEditingCota(null)
      showSuccessPlans(`Cota do plano "${plan.name}" atualizada. Aplicada na próxima renovação.`)
      void loadPlans()
    } catch (err) {
      setErrorPlans(err instanceof Error ? err.message : 'Erro ao salvar cota')
    } finally {
      setSavingCota(false)
    }
  }

  // ── Criar novo plano ─────────────────────────────────────────────────────

  async function createPlan() {
    if (!planForm.name.trim() || !planForm.slug.trim()) return
    setSavingPlanForm(true)
    setErrorPlanForm(null)
    try {
      // Cria o plano com campos mínimos — demais campos usam defaults do banco
      const { data, error } = await supabase.rpc('create_plan', {
        p_name:      planForm.name.trim(),
        p_slug:      planForm.slug.trim(),
        p_is_active: planForm.is_active,
      })
      if (error) throw error

      const result = data as { success: boolean; error?: string; plan_id?: string }
      if (!result?.success) throw new Error(result?.error ?? 'Erro ao criar plano')

      // Aplica a cota de créditos de IA ao plano recém-criado
      const credits = parseInt(planForm.monthly_ai_credits, 10) || 0
      if (credits > 0 && result.plan_id) {
        await supabase.rpc('update_plan_ai_credits', {
          p_plan_id: result.plan_id,
          p_credits: credits,
        })
      }

      setPlanModalOpen(false)
      setPlanForm(EMPTY_PLAN_FORM)
      showSuccessPlans(`Plano "${planForm.name}" criado com sucesso.`)
      void loadPlans()
    } catch (err) {
      setErrorPlanForm(err instanceof Error ? err.message : 'Erro ao criar plano')
    } finally {
      setSavingPlanForm(false)
    }
  }

  // ── Toggle ativo/inativo do plano ────────────────────────────────────────

  async function togglePlan(plan: Plan) {
    setTogglingPlan(plan.id)
    try {
      const { data, error } = await supabase.rpc('update_plan', {
        p_plan_id:   plan.id,
        p_is_active: !plan.is_active,
      })
      if (error) throw error

      const result = data as { success: boolean; error?: string }
      if (!result?.success) throw new Error(result?.error ?? 'Erro ao alterar status')
      void loadPlans()
    } catch (err) {
      setErrorPlans(err instanceof Error ? err.message : 'Erro ao alterar status do plano')
    } finally {
      setTogglingPlan(null)
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
      void loadPackages()
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
        : EMPTY_PKG_FORM
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
          right={
            <button
              onClick={() => { setErrorPlanForm(null); setPlanForm(EMPTY_PLAN_FORM); setPlanModalOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
            >
              <Plus size={13} />
              Novo plano
            </button>
          }
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : plans.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Sparkles size={24} className="mx-auto mb-2 text-slate-200" />
            <p className="text-sm text-slate-400">Nenhum plano encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left   text-xs font-medium text-slate-500 uppercase tracking-wide">Plano</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Créditos/mês</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Conversas (≈)</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Preço/conv</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Valor Mensal</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <span className="flex items-center justify-end gap-1">
                      <TrendingUp size={11} className="text-violet-400" />
                      Custo (OpenAI)
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Lucro Estimado</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map(plan => {
                  const lucroEst = plan.price - plan.estimated_ai_cost
                  return (
                    <tr key={plan.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{plan.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {formatCredits(plan.monthly_ai_credits)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-violet-600 text-xs font-medium">
                        ~{formatCredits(estConversas(plan.monthly_ai_credits))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600 text-xs font-mono">
                        {precoConversa(plan.price, plan.monthly_ai_credits)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700 text-xs font-mono">
                        {plan.price > 0 ? formatPrice(plan.price) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500 text-xs font-mono">
                        {formatPrice(plan.estimated_ai_cost)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs font-mono">
                        <span className={lucroEst >= 0 ? 'text-green-600' : 'text-red-500'}>
                          {plan.price > 0 ? formatPrice(lucroEst) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          plan.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {plan.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditingCota(plan)}
                            title="Editar cota de créditos"
                            className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => togglePlan(plan)}
                            disabled={togglingPlan === plan.id}
                            title={plan.is_active ? 'Desativar plano' : 'Ativar plano'}
                            className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
                              plan.is_active
                                ? 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                                : 'text-slate-400 hover:text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {togglingPlan === plan.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Power size={14} />
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-4 py-4">
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
                  <th className="px-4 py-3 text-left   text-xs font-medium text-slate-500 uppercase tracking-wide">Pacote</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Créditos</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Conversas (≈)</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <span className="flex items-center justify-end gap-1">
                      <TrendingUp size={11} className="text-violet-400" />
                      Tokens est.
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Custo IA</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Preço</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Lucro</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {packages.map(pkg => (
                  <tr key={pkg.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{pkg.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {formatCredits(pkg.credits)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-violet-600 text-xs font-medium">
                      ~{formatCredits(estConversas(pkg.credits))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500 text-xs">
                      {formatCredits(pkg.estimated_tokens)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500 font-mono text-xs">
                      {formatPrice(pkg.estimated_ai_cost)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 font-mono text-xs">
                      {formatPrice(pkg.price)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono text-xs">
                      <span className={pkg.estimated_profit >= 0 ? 'text-green-600' : 'text-red-500'}>
                        {formatPrice(pkg.estimated_profit)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        pkg.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {pkg.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
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

      {editingCota && (
        <EditCotaModal
          plan={editingCota}
          saving={savingCota}
          onSave={credits => savePlanCredits(editingCota, credits)}
          onClose={() => setEditingCota(null)}
        />
      )}

      {planModalOpen && (
        <PlanModal
          form={planForm}
          saving={savingPlanForm}
          error={errorPlanForm}
          onChange={partial => setPlanForm(f => ({ ...f, ...partial }))}
          onSave={createPlan}
          onClose={() => setPlanModalOpen(false)}
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
