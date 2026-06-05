import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus, Building2, Globe, Clock, CalendarClock,
  Edit2, Trash2, LogIn, Copy, Check, X, Gift,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccessControl } from '../../hooks/useAccessControl'
import { api } from '../../services/api'
import { supabase, Company } from '../../lib/supabase'

// ── Tipos locais ──────────────────────────────────────────────────────────────

interface TrialInfo {
  company_id:        string
  is_internal_trial: boolean
  trial_start:       string | null
  trial_end:         string | null
  trial_extended:    boolean
  can_extend:        boolean
  days_remaining:    number | null
}

interface CreateResult {
  company_id:    string
  trial_started: boolean
  trial_end:     string | null
  admin_created: boolean
  admin_email:   string | null
  invite_link:   string | null
}

type ClientCompany = Company & { plans?: { name: string; slug: string } | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null
  const diff = new Date(isoDate).getTime() - Date.now()
  return Math.ceil(diff / 86_400_000)
}

function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  return new Date(isoDate).toLocaleDateString('pt-BR')
}

function statusLabel(status: string) {
  if (status === 'active')    return 'Ativo'
  if (status === 'suspended') return 'Suspenso'
  return 'Cancelado'
}

function statusColor(status: string) {
  if (status === 'active')    return 'bg-green-100 text-green-800'
  if (status === 'suspended') return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-100 text-red-800'
}

const EXTEND_ERROR_MSGS: Record<string, string> = {
  trial_already_extended: 'Este trial já foi estendido. Apenas 1 extensão por empresa.',
  not_internal_trial:     'Esta empresa já possui uma assinatura Stripe ativa.',
  trial_not_started:      'Esta empresa não possui trial iniciado.',
  trial_not_eligible:     'Esta empresa não está em estado elegível para extensão.',
  forbidden:              'Você não tem permissão para estender este trial.',
  company_not_found:      'Empresa não encontrada.',
}

const FREE_PLAN_ERROR_MSGS: Record<string, string> = {
  forbidden:               'Você não tem permissão para executar esta ação.',
  company_not_found:       'Empresa não encontrada.',
  not_a_client_company:   'Esta operação só é permitida para empresas clientes.',
  subscription_not_found:  'Empresa não possui assinatura registrada.',
  has_stripe_subscription: 'Esta empresa já possui uma assinatura Stripe ativa. Não é possível aplicar o plano gratuito.',
  growth_plan_not_found:   'Plano Growth não encontrado. Contate o suporte.',
}

// ── Componente principal ──────────────────────────────────────────────────────

export const CompaniesPanel: React.FC = () => {
  const { impersonateUser } = useAuth()
  const { isSaaSAdmin, isSystemAdmin, canAccessCompanies } = useAccessControl()

  const [companies,       setCompanies]       = useState<ClientCompany[]>([])
  const [loading,         setLoading]         = useState(true)
  const [trialInfoMap,    setTrialInfoMap]     = useState<Record<string, TrialInfo | null>>({})
  const [trialLoadingIds, setTrialLoadingIds]  = useState<string[]>([])

  // ── Modal de criação ──────────────────────────────────────────────────────
  const [showCreate,    setShowCreate]    = useState(false)
  const [createStep,    setCreateStep]    = useState<'form' | 'result'>('form')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError,   setCreateError]   = useState<string | null>(null)
  const [createResult,  setCreateResult]  = useState<CreateResult | null>(null)
  const [createForm,    setCreateForm]    = useState({
    name:        '',
    domain:      '',
    createAdmin: false,
    adminEmail:  '',
  })

  // ── Modal de edição ───────────────────────────────────────────────────────
  const [editCompany,  setEditCompany]  = useState<ClientCompany | null>(null)
  const [editLoading,  setEditLoading]  = useState(false)
  const [editError,    setEditError]    = useState<string | null>(null)
  const [editForm,     setEditForm]     = useState({ name: '', domain: '', status: '' })

  // ── Modal de exclusão ─────────────────────────────────────────────────────
  const [deleteCompany,  setDeleteCompany]  = useState<ClientCompany | null>(null)
  const [deleteLoading,  setDeleteLoading]  = useState(false)
  const [deleteError,    setDeleteError]    = useState<string | null>(null)

  // ── Modal de extensão de trial ────────────────────────────────────────────
  const [extendCompany,  setExtendCompany]  = useState<ClientCompany | null>(null)
  const [extending,      setExtending]      = useState(false)
  const [extendError,    setExtendError]    = useState<string | null>(null)
  const [extendSuccess,  setExtendSuccess]  = useState(false)

  // ── Modal de plano gratuito ───────────────────────────────────────────────
  // freePlanMap: cache local do estado is_free de cada empresa
  const [freePlanCompany,  setFreePlanCompany]  = useState<ClientCompany | null>(null)
  const [freePlanLoading,  setFreePlanLoading]  = useState(false)
  const [freePlanError,    setFreePlanError]    = useState<string | null>(null)
  const [freePlanSuccess,  setFreePlanSuccess]  = useState(false)
  const [freePlanMap,      setFreePlanMap]      = useState<Record<string, boolean>>({})

  // ── Copiar invite link ────────────────────────────────────────────────────
  const [copiedLink, setCopiedLink] = useState(false)

  // ── Carregar empresas ─────────────────────────────────────────────────────

  const loadCompanies = useCallback(async () => {
    if (!canAccessCompanies) return
    setLoading(true)
    try {
      const data = await api.getAllCompanies() as ClientCompany[]
      // Filtrar: somente client e não deletadas
      const clients = data.filter(
        c => c.company_type === 'client' && !(c as any).deleted_at
      )
      setCompanies(clients)
      clients.forEach(c => fetchTrialInfo(c.id))

      // Carregar is_free de todas as empresas client de uma vez
      if (clients.length > 0) {
        const ids = clients.map(c => c.id)
        const { data: subs } = await supabase
          .from('company_subscriptions')
          .select('company_id, is_free')
          .in('company_id', ids)
        if (subs) {
          const map: Record<string, boolean> = {}
          subs.forEach((s: any) => { map[s.company_id] = s.is_free ?? false })
          setFreePlanMap(map)
        }
      }
    } catch (err) {
      console.error('[CompaniesPanel] Erro ao carregar empresas:', err)
    } finally {
      setLoading(false)
    }
  }, [canAccessCompanies])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  const fetchTrialInfo = async (companyId: string) => {
    setTrialLoadingIds(prev => [...prev, companyId])
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const res = await fetch(`/api/admin/trials/info?company_id=${companyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const info: TrialInfo = await res.json()
      setTrialInfoMap(prev => ({ ...prev, [companyId]: info }))
    } catch {
      // silencioso
    } finally {
      setTrialLoadingIds(prev => prev.filter(id => id !== companyId))
    }
  }

  // ── Criar empresa ─────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canAccessCompanies) return

    setCreateLoading(true)
    setCreateError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sessão inválida')

      const res = await fetch('/api/companies/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name:        createForm.name.trim(),
          domain:      createForm.domain.trim() || undefined,
          createAdmin: createForm.createAdmin,
          adminEmail:  createForm.createAdmin ? createForm.adminEmail.trim() : undefined,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        setCreateError(json?.error ?? 'Erro ao criar empresa')
        return
      }

      setCreateResult(json as CreateResult)
      setCreateStep('result')
      loadCompanies()
    } catch (err: any) {
      setCreateError(err?.message ?? 'Erro inesperado')
    } finally {
      setCreateLoading(false)
    }
  }

  const closeCreate = () => {
    setShowCreate(false)
    setCreateStep('form')
    setCreateError(null)
    setCreateResult(null)
    setCreateForm({ name: '', domain: '', createAdmin: false, adminEmail: '' })
  }

  const handleCopyLink = () => {
    if (!createResult?.invite_link) return
    navigator.clipboard.writeText(createResult.invite_link)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  // ── Editar empresa ────────────────────────────────────────────────────────

  const openEdit = (comp: ClientCompany) => {
    setEditCompany(comp)
    setEditForm({ name: comp.name, domain: comp.domain ?? '', status: comp.status })
    setEditError(null)
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canAccessCompanies || !editCompany) return

    setEditLoading(true)
    setEditError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sessão inválida')

      const updates: Record<string, string> = {}
      if (editForm.name.trim())   updates.name   = editForm.name.trim()
      if (editForm.domain !== undefined) updates.domain = editForm.domain.trim() || ''
      if (editForm.status) updates.status = editForm.status

      const res = await fetch('/api/companies/update', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId: editCompany.id, updates }),
      })

      const json = await res.json()
      if (!res.ok) {
        setEditError(json?.error ?? 'Erro ao salvar')
        return
      }

      setEditCompany(null)
      loadCompanies()
    } catch (err: any) {
      setEditError(err?.message ?? 'Erro inesperado')
    } finally {
      setEditLoading(false)
    }
  }

  // ── Excluir empresa ───────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!canAccessCompanies || !deleteCompany) return

    setDeleteLoading(true)
    setDeleteError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sessão inválida')

      const res = await fetch(`/api/companies/${deleteCompany.id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      const json = await res.json()
      if (!res.ok) {
        setDeleteError(json?.error ?? 'Erro ao excluir')
        return
      }

      setDeleteCompany(null)
      setCompanies(prev => prev.filter(c => c.id !== deleteCompany.id))
    } catch (err: any) {
      setDeleteError(err?.message ?? 'Erro inesperado')
    } finally {
      setDeleteLoading(false)
    }
  }

  // ── Estender trial ────────────────────────────────────────────────────────

  const handleExtend = async () => {
    if (!canAccessCompanies || !extendCompany) return

    setExtending(true)
    setExtendError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sessão inválida')

      const res = await fetch('/api/admin/trials/extend', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: extendCompany.id }),
      })

      const json = await res.json()
      if (!res.ok) {
        const msg = EXTEND_ERROR_MSGS[json?.error] ?? 'Erro ao estender trial.'
        setExtendError(msg)
        return
      }

      setExtendSuccess(true)
      await fetchTrialInfo(extendCompany.id)
      setTimeout(() => {
        setExtendCompany(null)
        setExtendSuccess(false)
        setExtendError(null)
      }, 2200)
    } catch {
      setExtendError('Erro interno ao processar extensão.')
    } finally {
      setExtending(false)
    }
  }

  // ── Plano gratuito ────────────────────────────────────────────────────────

  const handleFreePlan = async () => {
    if (!isSaaSAdmin || !freePlanCompany) return

    const targetIsFree = !freePlanMap[freePlanCompany.id]

    setFreePlanLoading(true)
    setFreePlanError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sessão inválida')

      const res = await fetch('/api/admin/companies/free-plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_id: freePlanCompany.id, is_free: targetIsFree }),
      })

      const json = await res.json()
      if (!res.ok) {
        const msg = FREE_PLAN_ERROR_MSGS[json?.error] ?? 'Erro ao processar operação.'
        setFreePlanError(msg)
        return
      }

      setFreePlanMap(prev => ({ ...prev, [freePlanCompany.id]: targetIsFree }))
      setFreePlanSuccess(true)
      setTimeout(() => {
        setFreePlanCompany(null)
        setFreePlanSuccess(false)
        setFreePlanError(null)
      }, 2200)
    } catch {
      setFreePlanError('Erro interno ao processar operação.')
    } finally {
      setFreePlanLoading(false)
    }
  }

  // ── Impersonar ────────────────────────────────────────────────────────────

  const handleImpersonate = async (comp: ClientCompany) => {
    if (!canAccessCompanies) return
    if (!confirm(`Entrar como ${comp.name}?`)) return
    try {
      await impersonateUser(comp.id)
      setTimeout(() => { window.location.href = '/dashboard' }, 500)
    } catch (err: any) {
      alert('Erro ao impersonar: ' + err?.message)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!canAccessCompanies) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500">
        Acesso não autorizado.
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Cabeçalho */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Empresas</h1>
          <p className="text-slate-500 mt-1 text-sm">Gerencie as empresas clientes da plataforma</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreateStep('form') }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova empresa
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-slate-500 gap-2">
          <Building2 className="w-10 h-10 text-slate-300" />
          <p>Nenhuma empresa cadastrada</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {companies.map(comp => {
            const trial    = trialInfoMap[comp.id]
            const days     = trial ? daysUntil(trial.trial_end) : null
            const isLoadingTrial = trialLoadingIds.includes(comp.id)
            const isFree   = freePlanMap[comp.id] ?? false

            return (
              <div
                key={comp.id}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow space-y-3"
              >
                {/* Header do card */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                      <Building2 className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{comp.name}</p>
                      {comp.domain && (
                        <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
                          <Globe className="w-3 h-3" />{comp.domain}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isFree && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                        <Gift className="w-3 h-3" /> Gratuito
                      </span>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(comp.status)}`}>
                      {statusLabel(comp.status)}
                    </span>
                  </div>
                </div>

                {/* Plano */}
                {(comp as any).plans?.name && (
                  <p className="text-xs text-slate-500">Plano: <span className="font-medium">{(comp as any).plans.name}</span></p>
                )}

                {/* Trial badge — oculto quando empresa é gratuita */}
                {!isFree && (isLoadingTrial ? (
                  <div className="h-5 w-24 bg-slate-100 rounded animate-pulse" />
                ) : trial?.is_internal_trial ? (
                  <div className="flex items-center gap-1.5 text-xs">
                    <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
                    {days !== null && days > 0 ? (
                      <span className="text-amber-700 font-medium">{days} dias de trial</span>
                    ) : days !== null && days <= 0 ? (
                      <span className="text-red-600 font-medium">Trial expirado</span>
                    ) : (
                      <span className="text-slate-500">Expira {formatDate(trial.trial_end)}</span>
                    )}
                    {trial.trial_extended && (
                      <span className="ml-1 text-slate-400">(estendido)</span>
                    )}
                  </div>
                ) : null)}

                {/* Ações */}
                <div className="flex items-center gap-1 pt-1 flex-wrap">
                  <button
                    onClick={() => openEdit(comp)}
                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                    title="Editar"
                  >
                    <Edit2 className="w-3 h-3" /> Editar
                  </button>
                  {trial?.can_extend && !isFree && (
                    <button
                      onClick={() => { setExtendCompany(comp); setExtendError(null); setExtendSuccess(false) }}
                      className="flex items-center gap-1 text-xs text-amber-600 hover:bg-amber-50 px-2 py-1 rounded transition-colors"
                      title="Estender trial"
                    >
                      <Clock className="w-3 h-3" /> +14 dias
                    </button>
                  )}
                  {isSaaSAdmin && (
                    <button
                      onClick={() => { setFreePlanCompany(comp); setFreePlanError(null); setFreePlanSuccess(false) }}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                        isFree
                          ? 'text-emerald-700 hover:bg-emerald-50'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}
                      title={isFree ? 'Revogar plano gratuito' : 'Marcar como gratuito'}
                    >
                      <Gift className="w-3 h-3" />
                      {isFree ? 'Gratuito ✓' : 'Gratuito'}
                    </button>
                  )}
                  {(isSaaSAdmin || isSystemAdmin) && (
                    <button
                      onClick={() => handleImpersonate(comp)}
                      className="flex items-center gap-1 text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded transition-colors"
                      title="Entrar como"
                    >
                      <LogIn className="w-3 h-3" /> Entrar
                    </button>
                  )}
                  <button
                    onClick={() => { setDeleteCompany(comp); setDeleteError(null) }}
                    className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded transition-colors ml-auto"
                    title="Excluir"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Modal de Criação ───────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">

            {createStep === 'form' ? (
              <>
                <div className="flex items-center justify-between p-6 border-b">
                  <h2 className="text-lg font-semibold text-slate-900">Nova Empresa</h2>
                  <button onClick={closeCreate} className="text-slate-400 hover:text-slate-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleCreate} className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Nome da empresa <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={createForm.name}
                      onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Ex: Empresa XPTO"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Domínio</label>
                    <input
                      type="text"
                      value={createForm.domain}
                      onChange={e => setCreateForm(f => ({ ...f, domain: e.target.value }))}
                      placeholder="empresa.com.br"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createForm.createAdmin}
                      onChange={e => setCreateForm(f => ({ ...f, createAdmin: e.target.checked }))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-slate-700">Criar usuário administrador agora</span>
                  </label>

                  {createForm.createAdmin && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        E-mail do administrador <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        required={createForm.createAdmin}
                        value={createForm.adminEmail}
                        onChange={e => setCreateForm(f => ({ ...f, adminEmail: e.target.value }))}
                        placeholder="admin@empresa.com.br"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  {createError && (
                    <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{createError}</p>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeCreate}
                      className="flex-1 border border-slate-300 text-slate-600 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={createLoading}
                      className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {createLoading ? 'Criando...' : 'Criar empresa'}
                    </button>
                  </div>
                </form>
              </>
            ) : createResult && (
              <>
                <div className="flex items-center justify-between p-6 border-b">
                  <h2 className="text-lg font-semibold text-slate-900">Empresa criada</h2>
                  <button onClick={closeCreate} className="text-slate-400 hover:text-slate-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <Building2 className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{createForm.name}</p>
                      <p className="text-xs text-green-600 font-medium">Criada com sucesso</p>
                    </div>
                  </div>

                  {createResult.trial_started && createResult.trial_end && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg">
                      <CalendarClock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">Trial ativo — 14 dias</p>
                        <p className="text-xs text-amber-600">
                          Expira em {formatDate(createResult.trial_end)}
                          {daysUntil(createResult.trial_end) !== null && (
                            <> ({daysUntil(createResult.trial_end)} dias restantes)</>
                          )}
                        </p>
                      </div>
                    </div>
                  )}

                  {createResult.admin_created && createResult.admin_email && (
                    <div className="p-3 bg-blue-50 rounded-lg space-y-2">
                      <p className="text-sm font-medium text-blue-800">Administrador criado</p>
                      <p className="text-xs text-slate-600">E-mail: <span className="font-medium">{createResult.admin_email}</span></p>
                      {createResult.invite_link ? (
                        <div>
                          <p className="text-xs text-slate-500 mb-1">Link de acesso (uso único):</p>
                          <div className="flex items-center gap-2">
                            <input
                              readOnly
                              value={createResult.invite_link}
                              className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 bg-white truncate"
                            />
                            <button
                              onClick={handleCopyLink}
                              className="shrink-0 p-1.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors"
                              title="Copiar link"
                            >
                              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Link de convite não disponível — verifique o e-mail do administrador.</p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={closeCreate}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Modal de Edição ────────────────────────────────────────────────── */}
      {editCompany && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold text-slate-900">Editar empresa</h2>
              <button onClick={() => setEditCompany(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Domínio</label>
                <input
                  type="text"
                  value={editForm.domain}
                  onChange={e => setEditForm(f => ({ ...f, domain: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Ativo</option>
                  <option value="suspended">Suspenso</option>
                </select>
              </div>

              {editError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditCompany(null)}
                  className="flex-1 border border-slate-300 text-slate-600 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {editLoading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal de Exclusão ──────────────────────────────────────────────── */}
      {deleteCompany && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 rounded-lg shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Excluir empresa</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Tem certeza que deseja excluir <strong>{deleteCompany.name}</strong>? Esta ação não pode ser desfeita.
                </p>
              </div>
            </div>

            {deleteError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{deleteError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteCompany(null)}
                className="flex-1 border border-slate-300 text-slate-600 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal de Plano Gratuito ────────────────────────────────────────── */}
      {freePlanCompany && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg shrink-0">
                <Gift className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                {freePlanMap[freePlanCompany.id] ? (
                  <>
                    <h3 className="font-semibold text-slate-900">Revogar plano gratuito</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Remover o plano gratuito de <strong>{freePlanCompany.name}</strong>.
                      A empresa continuará operacional com o estado atual até que um administrador tome outra ação.
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="font-semibold text-slate-900">Conceder plano gratuito</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Marcar <strong>{freePlanCompany.name}</strong> como gratuita.
                      A empresa manterá o plano Growth, status ativo e não será afetada pela expiração de trial.
                    </p>
                  </>
                )}
              </div>
            </div>

            {freePlanSuccess && (
              <p className="text-sm text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2 font-medium">
                {freePlanMap[freePlanCompany.id]
                  ? 'Plano gratuito concedido com sucesso!'
                  : 'Plano gratuito revogado com sucesso!'}
              </p>
            )}

            {freePlanError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{freePlanError}</p>
            )}

            {!freePlanSuccess && (
              <div className="flex gap-3">
                <button
                  onClick={() => { setFreePlanCompany(null); setFreePlanError(null) }}
                  className="flex-1 border border-slate-300 text-slate-600 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleFreePlan}
                  disabled={freePlanLoading}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${
                    freePlanMap[freePlanCompany.id]
                      ? 'bg-slate-600 hover:bg-slate-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {freePlanLoading
                    ? 'Processando...'
                    : freePlanMap[freePlanCompany.id]
                    ? 'Revogar gratuito'
                    : 'Conceder gratuito'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Modal de Extensão de Trial ─────────────────────────────────────── */}
      {extendCompany && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 rounded-lg shrink-0">
                <CalendarClock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Estender trial</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Adicionar <strong>+14 dias</strong> ao trial de <strong>{extendCompany.name}</strong>.
                  Permitido apenas uma vez por empresa.
                </p>
              </div>
            </div>

            {extendSuccess && (
              <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2 font-medium">
                Trial estendido com sucesso!
              </p>
            )}

            {extendError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{extendError}</p>
            )}

            {!extendSuccess && (
              <div className="flex gap-3">
                <button
                  onClick={() => setExtendCompany(null)}
                  className="flex-1 border border-slate-300 text-slate-600 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleExtend}
                  disabled={extending}
                  className="flex-1 bg-amber-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
                >
                  {extending ? 'Processando...' : 'Estender +14 dias'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
