// =============================================================================
// src/components/Settings/AiPlansPanel.tsx
//
// Painel de gestão de IA para empresa pai (platform admin).
//
// BLOCOS:
//   1. Planos de IA       — CRUD de ai_plans (tabela própria, separada de plans)
//   2. Pacotes Avulsos    — CRUD de credit_packages
//
// SEPARAÇÃO DE DOMÍNIO:
//   - "Planos de IA" → tabela ai_plans → vinculados a plans via plans.ai_plan_id (1:1)
//   - "Pacotes Avulsos" → tabela credit_packages → créditos pontuais, sem vínculo com planos
//
// GOVERNANÇA INTERNA:
//   - ai_plans.internal_price: custo interno de referência (NOT NULL, NOT venda)
//   - Campos estimados (tokens, custo IA) calculados localmente apenas para preview UX
//   - Fonte oficial: banco via get_ai_plans_admin() e get_credit_packages_admin()
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Package, Plus, Pencil, Check, X, Loader2, Power, TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Constantes de governança (preview UX local no admin apenas) ───────────────

const TOKENS_PER_CREDIT      = 10
const COST_PER_1K_TOKENS_BRL = 0.015

function govAiCost(credits: number): number {
  return Math.round((credits * TOKENS_PER_CREDIT / 1000) * COST_PER_1K_TOKENS_BRL * 100) / 100
}

// Estimativa de conversas: 1 conversa ≈ 500 tokens ≈ 50 créditos
const CREDITS_PER_CONVERSATION = 50

function estConversas(credits: number): number {
  return Math.floor(credits / CREDITS_PER_CONVERSATION)
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AiPlan {
  id:                      string
  name:                    string
  slug:                    string
  monthly_credits:         number
  internal_price:          number
  is_active:               boolean
  sort_order:              number
  estimated_conversations: number   // calculado pela RPC (monthly_credits / 50)
  plans_count:             number   // quantos plans CRM referenciam este ai_plan
}

interface CreditPackage {
  id:                    string
  name:                  string
  credits:               number
  price:                 number
  is_active:             boolean
  is_available_for_sale: boolean
  estimated_tokens:      number
  estimated_ai_cost:     number
  estimated_profit:      number
}

interface PackageForm {
  name:                  string
  credits:               string
  price:                 string
  is_active:             boolean
  is_available_for_sale: boolean
}

interface AiPlanCreateForm {
  name:            string
  slug:            string
  monthly_credits: string
  internal_price:  string
  is_active:       boolean
}

interface AiPlanEditForm {
  name:            string
  monthly_credits: string
  internal_price:  string
}

const EMPTY_PKG_FORM: PackageForm = { name: '', credits: '', price: '', is_active: true, is_available_for_sale: true }

const EMPTY_AI_PLAN_FORM: AiPlanCreateForm = {
  name: '', slug: '', monthly_credits: '0', internal_price: '0', is_active: true,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatCredits(n: number): string {
  return n.toLocaleString('pt-BR')
}

function generateSlug(name: string): string {
  return `ai-${name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  }`
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, right }: {
  icon:   React.ReactNode
  title:  string
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

function GovernancePreview({ credits, internalPrice }: { credits: number; internalPrice: number }) {
  if (credits <= 0) return null
  const cost = govAiCost(credits)
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 space-y-2">
      <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
        <TrendingUp size={12} className="text-violet-500" />
        Referência interna (preview)
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Tokens est.</p>
          <p className="text-sm font-semibold text-slate-700 tabular-nums">{formatCredits(credits * TOKENS_PER_CREDIT)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Custo IA est.</p>
          <p className="text-sm font-semibold text-slate-700 tabular-nums">{formatPrice(cost)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Preço interno ref.</p>
          <p className={`text-sm font-semibold tabular-nums ${internalPrice >= cost ? 'text-green-600' : 'text-amber-500'}`}>
            {formatPrice(internalPrice)}
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-400 italic">
        Preview local — valores oficiais calculados no banco
      </p>
    </div>
  )
}

// ── Modal: criar plano de IA ──────────────────────────────────────────────────

function AiPlanCreateModal({
  form, saving, error,
  onChange, onSave, onClose,
}: {
  form:     AiPlanCreateForm
  saving:   boolean
  error:    string | null
  onChange: (f: Partial<AiPlanCreateForm>) => void
  onSave:   () => void
  onClose:  () => void
}) {
  const credits       = parseInt(form.monthly_credits, 10) || 0
  const internalPrice = parseFloat(form.internal_price) || 0
  const isValid       = form.name.trim().length > 0 && form.slug.trim().length > 0

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
              placeholder="Ex: AI Business"
              autoFocus
              className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Slug</label>
            <input
              type="text"
              value={form.slug}
              onChange={e => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              placeholder="ai-business"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-slate-400">Identificador único (gerado automaticamente)</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Créditos de IA / mês</label>
              <input
                type="number" min={0} step={100}
                value={form.monthly_credits}
                onChange={e => onChange({ monthly_credits: e.target.value })}
                placeholder="0"
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              {credits > 0 && (
                <p className="text-xs text-violet-600 mt-0.5">≈ {formatCredits(estConversas(credits))} conversas</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Preço interno ref. (R$)</label>
              <input
                type="number" min={0} step={0.01}
                value={form.internal_price}
                onChange={e => onChange({ internal_price: e.target.value })}
                placeholder="0.00"
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-slate-400">Governança interna — não é preço de venda</p>
            </div>
          </div>

          {credits > 0 && (
            <GovernancePreview credits={credits} internalPrice={internalPrice} />
          )}

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
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onSave} disabled={saving || !isValid}
            className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Criar plano
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: editar plano de IA ─────────────────────────────────────────────────

function AiPlanEditModal({
  plan, form, saving, error,
  onChange, onSave, onClose,
}: {
  plan:     AiPlan
  form:     AiPlanEditForm
  saving:   boolean
  error:    string | null
  onChange: (f: Partial<AiPlanEditForm>) => void
  onSave:   () => void
  onClose:  () => void
}) {
  const credits       = parseInt(form.monthly_credits, 10) || 0
  const internalPrice = parseFloat(form.internal_price) || 0
  const isValid       = form.name.trim().length > 0 && credits >= 0 && internalPrice >= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Editar — {plan.name}</h3>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">{plan.slug}</p>
          </div>
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
              onChange={e => onChange({ name: e.target.value })}
              autoFocus
              className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Créditos de IA / mês</label>
              <input
                type="number" min={0} step={100}
                value={form.monthly_credits}
                onChange={e => onChange({ monthly_credits: e.target.value })}
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              {credits > 0 && (
                <p className="text-xs text-violet-600 mt-0.5">≈ {formatCredits(estConversas(credits))} conversas</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Preço interno ref. (R$)</label>
              <input
                type="number" min={0} step={0.01}
                value={form.internal_price}
                onChange={e => onChange({ internal_price: e.target.value })}
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {credits > 0 && (
            <GovernancePreview credits={credits} internalPrice={internalPrice} />
          )}

          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Alterações na cota de créditos entram em vigor apenas na <strong>próxima renovação</strong>. O nome tem efeito imediato.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onSave} disabled={saving || !isValid}
            className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Salvar alterações
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal de pacote ───────────────────────────────────────────────────────────

function PackageModal({
  mode, form, saving, error,
  onChange, onSave, onClose,
}: {
  mode:     'create' | 'edit'
  form:     PackageForm
  saving:   boolean
  error:    string | null
  onChange: (f: Partial<PackageForm>) => void
  onSave:   () => void
  onClose:  () => void
}) {
  const credits = parseInt(form.credits, 10)
  const price   = parseFloat(form.price)
  const isValid = form.name.trim() && credits > 0 && !isNaN(price) && price >= 0

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
            <input type="text" value={form.name}
              onChange={e => onChange({ name: e.target.value })}
              placeholder="Ex: Boost IA"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Créditos</label>
              <input type="number" min={1} step={1} value={form.credits}
                onChange={e => onChange({ credits: e.target.value })}
                placeholder="5000"
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              {credits > 0 && (
                <p className="text-xs text-violet-600 mt-0.5">≈ {formatCredits(estConversas(credits))} conversas</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Preço de venda (R$)</label>
              <input type="number" min={0} step={0.01} value={form.price}
                onChange={e => onChange({ price: e.target.value })}
                placeholder="49.90"
                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          {credits > 0 && !isNaN(price) && price >= 0 && (
            <GovernancePreview credits={credits} internalPrice={price} />
          )}

          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.is_active}
                onChange={e => onChange({ is_active: e.target.checked })}
                className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <div>
                <span className="text-sm text-slate-700">Pacote ativo</span>
                <p className="text-xs text-slate-400">Visível e gerenciável na governança</p>
              </div>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.is_available_for_sale}
                onChange={e => onChange({ is_available_for_sale: e.target.checked })}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div>
                <span className="text-sm text-slate-700">Disponível para venda</span>
                <p className="text-xs text-slate-400">Exibido para empresas filhas em "Comprar Créditos"</p>
              </div>
            </label>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onSave} disabled={saving || !isValid}
            className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
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

  // ── Estado: ai_plans ─────────────────────────────────────────────────────
  const [aiPlans,      setAiPlans]      = useState<AiPlan[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [errorPlans,   setErrorPlans]   = useState<string | null>(null)
  const [successPlans, setSuccessPlans] = useState<string | null>(null)

  const [editingAiPlan,    setEditingAiPlan]    = useState<AiPlan | null>(null)
  const [editAiPlanForm,   setEditAiPlanForm]   = useState<AiPlanEditForm>({ name: '', monthly_credits: '', internal_price: '' })
  const [savingPlanEdit,   setSavingPlanEdit]   = useState(false)
  const [errorPlanEdit,    setErrorPlanEdit]    = useState<string | null>(null)

  const [aiPlanModalOpen,  setAiPlanModalOpen]  = useState(false)
  const [aiPlanCreateForm, setAiPlanCreateForm] = useState<AiPlanCreateForm>(EMPTY_AI_PLAN_FORM)
  const [savingPlanCreate, setSavingPlanCreate] = useState(false)
  const [errorPlanCreate,  setErrorPlanCreate]  = useState<string | null>(null)

  const [togglingPlan, setTogglingPlan] = useState<string | null>(null)

  // ── Estado: pacotes ──────────────────────────────────────────────────────
  const [packages,     setPackages]     = useState<CreditPackage[]>([])
  const [loadingPkgs,  setLoadingPkgs]  = useState(true)
  const [errorPkgs,    setErrorPkgs]    = useState<string | null>(null)
  const [successPkgs,  setSuccessPkgs]  = useState<string | null>(null)

  const [packageModal, setPackageModal] = useState<{ mode: 'create' | 'edit'; pkg?: CreditPackage } | null>(null)
  const [packageForm,  setPackageForm]  = useState<PackageForm>(EMPTY_PKG_FORM)
  const [savingPkg,    setSavingPkg]    = useState(false)
  const [errorPkgForm, setErrorPkgForm] = useState<string | null>(null)
  const [togglingPkg,  setTogglingPkg]  = useState<string | null>(null)

  // ── Load: ai_plans via get_ai_plans_admin() ──────────────────────────────

  const loadAiPlans = useCallback(async () => {
    setLoadingPlans(true)
    setErrorPlans(null)
    try {
      const { data, error } = await supabase.rpc('get_ai_plans_admin')
      if (error) throw error
      setAiPlans((data ?? []) as AiPlan[])
    } catch (err) {
      setErrorPlans(err instanceof Error ? err.message : 'Erro ao carregar planos de IA')
    } finally {
      setLoadingPlans(false)
    }
  }, [])

  // ── Load: pacotes via get_credit_packages_admin() ────────────────────────

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
    void loadAiPlans()
    void loadPackages()
  }, [loadAiPlans, loadPackages])

  function showSuccessPlans(msg: string) {
    setSuccessPlans(msg)
    setTimeout(() => setSuccessPlans(null), 4000)
  }

  function showSuccessPkgs(msg: string) {
    setSuccessPkgs(msg)
    setTimeout(() => setSuccessPkgs(null), 4000)
  }

  // ── Criar plano de IA via create_ai_plan() ───────────────────────────────

  async function createAiPlan() {
    const { name, slug, monthly_credits, internal_price, is_active } = aiPlanCreateForm
    if (!name.trim() || !slug.trim()) return
    setSavingPlanCreate(true)
    setErrorPlanCreate(null)
    try {
      const { data, error } = await supabase.rpc('create_ai_plan', {
        p_name:            name.trim(),
        p_slug:            slug.trim(),
        p_monthly_credits: parseInt(monthly_credits, 10) || 0,
        p_internal_price:  parseFloat(internal_price) || 0,
        p_is_active:       is_active,
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error ?? 'Erro ao criar plano de IA')
      setAiPlanModalOpen(false)
      setAiPlanCreateForm(EMPTY_AI_PLAN_FORM)
      showSuccessPlans(`Plano "${name}" criado com sucesso.`)
      void loadAiPlans()
    } catch (err) {
      setErrorPlanCreate(err instanceof Error ? err.message : 'Erro ao criar plano')
    } finally {
      setSavingPlanCreate(false)
    }
  }

  // ── Salvar edição via update_ai_plan() ───────────────────────────────────

  async function saveAiPlanEdit() {
    if (!editingAiPlan) return
    setSavingPlanEdit(true)
    setErrorPlanEdit(null)
    try {
      const { data, error } = await supabase.rpc('update_ai_plan', {
        p_ai_plan_id:      editingAiPlan.id,
        p_name:            editAiPlanForm.name.trim() || undefined,
        p_monthly_credits: parseInt(editAiPlanForm.monthly_credits, 10) ?? undefined,
        p_internal_price:  parseFloat(editAiPlanForm.internal_price) ?? undefined,
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error ?? 'Erro ao atualizar plano')
      setEditingAiPlan(null)
      showSuccessPlans(`Plano "${editAiPlanForm.name}" atualizado com sucesso.`)
      void loadAiPlans()
    } catch (err) {
      setErrorPlanEdit(err instanceof Error ? err.message : 'Erro ao salvar plano')
    } finally {
      setSavingPlanEdit(false)
    }
  }

  // ── Toggle ativo/inativo via update_ai_plan() ────────────────────────────

  async function toggleAiPlan(plan: AiPlan) {
    setTogglingPlan(plan.id)
    try {
      const { data, error } = await supabase.rpc('update_ai_plan', {
        p_ai_plan_id: plan.id,
        p_is_active:  !plan.is_active,
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error ?? 'Erro ao alterar status')
      void loadAiPlans()
    } catch (err) {
      setErrorPlans(err instanceof Error ? err.message : 'Erro ao alterar status')
    } finally {
      setTogglingPlan(null)
    }
  }

  // ── Pacotes: salvar ──────────────────────────────────────────────────────

  async function savePackage() {
    const credits = parseInt(packageForm.credits, 10)
    const price   = parseFloat(packageForm.price)
    if (!packageForm.name.trim() || credits <= 0 || isNaN(price) || price < 0) return
    setSavingPkg(true)
    setErrorPkgForm(null)
    try {
      if (packageModal?.mode === 'create') {
        const { error } = await supabase.from('credit_packages').insert({
          name: packageForm.name.trim(), credits, price,
          is_active: packageForm.is_active,
          is_available_for_sale: packageForm.is_available_for_sale,
        })
        if (error) throw error
        showSuccessPkgs('Pacote criado com sucesso.')
      } else if (packageModal?.pkg) {
        const { error } = await supabase
          .from('credit_packages')
          .update({
            name: packageForm.name.trim(), credits, price,
            is_active: packageForm.is_active,
            is_available_for_sale: packageForm.is_available_for_sale,
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

  function openPackageModal(mode: 'create' | 'edit', pkg?: CreditPackage) {
    setErrorPkgForm(null)
    setPackageForm(
      pkg
        ? {
            name:                  pkg.name,
            credits:               String(pkg.credits),
            price:                 String(pkg.price),
            is_active:             pkg.is_active,
            is_available_for_sale: pkg.is_available_for_sale ?? true,
          }
        : EMPTY_PKG_FORM
    )
    setPackageModal({ mode, pkg })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── 1. Planos de IA (ai_plans) ──────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <SectionHeader
          icon={<Sparkles size={16} />}
          title="Planos de IA — Cota Mensal"
          right={
            <button
              onClick={() => { setErrorPlanCreate(null); setAiPlanCreateForm(EMPTY_AI_PLAN_FORM); setAiPlanModalOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
            >
              <Plus size={13} />
              Novo plano de IA
            </button>
          }
        />

        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
          <p className="text-xs text-amber-700">
            Planos de IA são entidades próprias vinculadas a Planos CRM (1:1).
            Alterações na cota de créditos entram em vigor apenas na <strong>próxima renovação</strong>.
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
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 bg-slate-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : aiPlans.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <Sparkles size={24} className="mx-auto mb-2 text-slate-200" />
            <p className="text-sm text-slate-400">Nenhum plano de IA encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left   text-xs font-medium text-slate-500 uppercase tracking-wide">Plano de IA</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Créditos/mês</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Conversas (≈)</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <span className="flex items-center justify-end gap-1">
                      <TrendingUp size={11} className="text-violet-400" />
                      Custo IA est.
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Preço interno ref.</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Planos CRM</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aiPlans.map(plan => {
                  const custo = govAiCost(plan.monthly_credits)
                  return (
                    <tr key={plan.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{plan.name}</div>
                        <div className="text-xs text-slate-400 font-mono">{plan.slug}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {formatCredits(plan.monthly_credits)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-violet-600 text-xs font-medium">
                        ~{formatCredits(plan.estimated_conversations ?? estConversas(plan.monthly_credits))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500 text-xs font-mono">
                        {formatPrice(custo)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs font-mono">
                        <span className={plan.internal_price >= custo ? 'text-green-600' : 'text-amber-500'}>
                          {plan.internal_price > 0 ? formatPrice(plan.internal_price) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700">
                          {plan.plans_count ?? 0}
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
                            onClick={() => {
                              setEditingAiPlan(plan)
                              setEditAiPlanForm({
                                name:            plan.name,
                                monthly_credits: String(plan.monthly_credits),
                                internal_price:  String(plan.internal_price ?? 0),
                              })
                              setErrorPlanEdit(null)
                            }}
                            title="Editar"
                            className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleAiPlan(plan)}
                            disabled={togglingPlan === plan.id}
                            title={plan.is_active ? 'Desativar' : 'Ativar'}
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

      {/* ── 2. Pacotes de Créditos Avulsos ──────────────────────────────────── */}
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
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Preço venda</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Lucro</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right  text-xs font-medium text-slate-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {packages.map(pkg => (
                  <tr key={pkg.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{pkg.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCredits(pkg.credits)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-violet-600 text-xs font-medium">
                      ~{formatCredits(estConversas(pkg.credits))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500 text-xs">{formatCredits(pkg.estimated_tokens)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500 font-mono text-xs">{formatPrice(pkg.estimated_ai_cost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 font-mono text-xs">{formatPrice(pkg.price)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono text-xs">
                      <span className={pkg.estimated_profit >= 0 ? 'text-green-600' : 'text-red-500'}>
                        {formatPrice(pkg.estimated_profit)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        pkg.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {pkg.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openPackageModal('edit', pkg)} title="Editar"
                          className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => togglePackage(pkg)} disabled={togglingPkg === pkg.id}
                          title={pkg.is_active ? 'Desativar' : 'Ativar'}
                          className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
                            pkg.is_active
                              ? 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                              : 'text-slate-400 hover:text-green-600 hover:bg-green-50'
                          }`}>
                          {togglingPkg === pkg.id ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
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

      {/* ── Modais ─────────────────────────────────────────────────────────────── */}

      {aiPlanModalOpen && (
        <AiPlanCreateModal
          form={aiPlanCreateForm}
          saving={savingPlanCreate}
          error={errorPlanCreate}
          onChange={partial => setAiPlanCreateForm(f => ({ ...f, ...partial }))}
          onSave={createAiPlan}
          onClose={() => setAiPlanModalOpen(false)}
        />
      )}

      {editingAiPlan && (
        <AiPlanEditModal
          plan={editingAiPlan}
          form={editAiPlanForm}
          saving={savingPlanEdit}
          error={errorPlanEdit}
          onChange={partial => setEditAiPlanForm(f => ({ ...f, ...partial }))}
          onSave={saveAiPlanEdit}
          onClose={() => setEditingAiPlan(null)}
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
