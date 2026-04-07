// =====================================================
// COMPONENTE: OpportunityDetailModal
// Objetivo: Visualização dos detalhes de uma oportunidade
//           com três abas: Detalhes, Jornada e Status.
//
// Generalizado para qualquer status (open, won, lost).
// Aba "Jornada" usa OpportunityStageTimeline + useOpportunityStageHistory.
// Aba "Status" mantém a linha do tempo de transições de status.
// =====================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X, Briefcase, DollarSign, Calendar, TrendingUp,
  FileText, Tag, CheckCircle2, XCircle, RotateCcw,
  Clock, AlertCircle, Route, Pencil, Save, User, Check
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../types/sales-funnel'
import { funnelApi } from '../../services/funnelApi'
import { catalogApi } from '../../services/catalogApi'
import { getCompanyUsers } from '../../services/userApi'
import { useAuth } from '../../contexts/AuthContext'
import { useOpportunityStageHistory } from '../../hooks/useOpportunityStageHistory'
import { OpportunityStageTimeline } from './OpportunityStageTimeline'
import { OpportunityItemsSection } from './OpportunityItemsSection'
import type { Opportunity, OpportunityStatusHistory, UpdateOpportunityForm } from '../../types/sales-funnel'
import {
  parseOpportunityCompositionError,
  resolveOpportunityCompositionErrorMessage
} from '../../utils/opportunityCompositionErrors'
import type { CompanyUser } from '../../types/user'

const MANAGEMENT_ROLES = ['super_admin', 'admin', 'partner', 'manager']

type TabType = 'details' | 'journey' | 'status'

interface OpportunityDetailModalProps {
  isOpen: boolean
  onClose: () => void
  opportunity: Opportunity
  companyId: string
  /** Aba aberta por padrão. Padrão: 'details'. */
  initialTab?: TabType
  /** Chamado após salvar alterações com sucesso. */
  onUpdate?: (updated: Opportunity) => void
}

// =====================================================
// Helpers de formatação
// =====================================================

const formatDateTime = (iso?: string): string => {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso))
}

const formatDateShort = (iso?: string): string => {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date(iso))
}

// =====================================================
// Configuração visual por status
// =====================================================

const statusConfig: Record<string, {
  label: string; color: string; bg: string
  headerBg: string; headerBorder: string
  iconBg: string; iconColor: string
  icon: React.ReactNode
}> = {
  open: {
    label: 'Em Aberto',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    headerBg: 'bg-blue-50',
    headerBorder: 'border-blue-100',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    icon: <AlertCircle className="w-3.5 h-3.5" />
  },
  won: {
    label: 'Ganha',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    headerBg: 'bg-emerald-50',
    headerBorder: 'border-emerald-100',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />
  },
  lost: {
    label: 'Perdida',
    color: 'text-red-700',
    bg: 'bg-red-100',
    headerBg: 'bg-red-50',
    headerBorder: 'border-red-100',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    icon: <XCircle className="w-3.5 h-3.5" />
  }
}

// =====================================================
// TimelineEntry (status history)
// =====================================================

const TimelineEntry: React.FC<{
  entry: OpportunityStatusHistory
  isLast: boolean
  /** Moeda atual da oportunidade — usada quando o snapshot legado não tem currency_code */
  fallbackCurrency: string
  statusConfig: typeof statusConfig
}> = ({ entry, isLast, fallbackCurrency, statusConfig: sc }) => {
  const { t } = useTranslation('funnel')
  const toConfig   = sc[entry.to_status]   ?? sc.open
  const fromConfig = entry.from_status ? (sc[entry.from_status] ?? null) : null

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${toConfig.bg} ${toConfig.color}`}>
          {entry.to_status === 'won'  && <CheckCircle2 className="w-4 h-4" />}
          {entry.to_status === 'lost' && <XCircle className="w-4 h-4" />}
          {entry.to_status === 'open' && <RotateCcw className="w-4 h-4" />}
        </div>
        {!isLast && <div className="w-px flex-1 bg-gray-200 my-1" />}
      </div>

      <div className="pb-4 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-gray-800">
              {fromConfig ? (
                <span>
                  <span className={fromConfig.color}>{fromConfig.label}</span>
                  {' → '}
                  <span className={toConfig.color}>{toConfig.label}</span>
                </span>
              ) : (
                <span className={toConfig.color}>
                  {t('opportunityDetail.timeline.statusPrefix')} {toConfig.label}
                </span>
              )}
            </p>
            {entry.loss_reason && (
              <p className="text-xs text-gray-500 mt-0.5">
                {t('opportunityDetail.timeline.lossReason', { reason: entry.loss_reason })}
              </p>
            )}
            {entry.value_snapshot != null && entry.value_snapshot > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">
                {t('opportunityDetail.timeline.valueLabel')}{' '}
                <span className="font-medium text-gray-700">
                  {formatCurrency(entry.value_snapshot, entry.currency_code ?? fallbackCurrency)}
                </span>
              </p>
            )}
          </div>
          <span className="text-xs text-gray-400 flex-shrink-0 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDateTime(entry.changed_at)}
          </span>
        </div>
      </div>
    </div>
  )
}

// =====================================================
// Modal principal
// =====================================================

export const OpportunityDetailModal: React.FC<OpportunityDetailModalProps> = ({
  isOpen,
  onClose,
  opportunity,
  companyId,
  initialTab = 'details',
  onUpdate
}) => {
  const { t } = useTranslation('funnel')
  const { currentRole, company, userRoles } = useAuth()
  const hasPlatformElevatedRole = userRoles.some(r => r.role === 'super_admin')
  const isManager =
    (currentRole ? MANAGEMENT_ROLES.includes(currentRole) : false) ||
    hasPlatformElevatedRole

  const [activeTab, setActiveTab]         = useState<TabType>(initialTab)
  const [statusHistory, setStatusHistory] = useState<OpportunityStatusHistory[]>([])
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [detailOpportunity, setDetailOpportunity] = useState<Opportunity>(opportunity)
  const [compositionEntitled, setCompositionEntitled] = useState(false)

  // Edição geral
  const [editMode, setEditMode]       = useState(false)
  const [form, setForm]               = useState<UpdateOpportunityForm>({})
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState<string | null>(null)
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])

  // Slider de probabilidade (auto-save, independente do edit mode)
  const [probDraft, setProbDraft]     = useState(opportunity.probability)
  const [savingProb, setSavingProb]   = useState(false)
  const [probSaved, setProbSaved]     = useState(false)

  const lastEventRef = useRef<HTMLDivElement>(null)

  const handleEditStart = useCallback(() => {
    setForm({
      title:               opportunity.title,
      description:         opportunity.description ?? '',
      value:               opportunity.value,
      probability:         probDraft,
      expected_close_date: opportunity.expected_close_date ?? '',
      loss_reason:         opportunity.loss_reason ?? '',
      owner_user_id:       opportunity.owner_user_id ?? '',
    })
    setSaveError(null)
    setEditMode(true)
  }, [opportunity, probDraft])

  const handleCancel = useCallback(() => {
    setEditMode(false)
    setSaveError(null)
  }, [])

  const handleProbabilityCommit = useCallback(async (value: number) => {
    if (value === opportunity.probability) return
    setSavingProb(true)
    try {
      const updated = await funnelApi.updateOpportunity(opportunity.id, { probability: value })
      onUpdate?.(updated)
      setProbSaved(true)
      setTimeout(() => setProbSaved(false), 1500)
    } finally {
      setSavingProb(false)
    }
  }, [opportunity.id, opportunity.probability, onUpdate])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      // Limpar campos vazios opcionais para não sobrescrever com string vazia
      const payload: UpdateOpportunityForm = {
        title:       form.title,
        description: form.description || undefined,
        value:       form.value,
        probability: form.probability,
        expected_close_date: form.expected_close_date || undefined,
        loss_reason:         form.loss_reason         || undefined,
        owner_user_id:       form.owner_user_id        || undefined,
      }
      const useManualValueRpc =
        compositionEntitled && (detailOpportunity.value_mode ?? 'manual') === 'manual'

      const updated = await funnelApi.updateOpportunity(opportunity.id, payload, {
        companyId,
        useCompositionManualValueRpc: useManualValueRpc,
      })
      setDetailOpportunity(updated)
      onUpdate?.(updated)
      setEditMode(false)
    } catch (err) {
      const parsed = parseOpportunityCompositionError(err)
      if (parsed.code !== 'UNKNOWN' && /^OPP_/.test(parsed.code)) {
        setSaveError(
          resolveOpportunityCompositionErrorMessage(err, t, 'opportunityDetail.errors.saveFailed')
        )
      } else {
        setSaveError(err instanceof Error ? err.message : t('opportunityDetail.errors.saveFailed'))
      }
    } finally {
      setSaving(false)
    }
  }, [form, opportunity.id, companyId, compositionEntitled, detailOpportunity.value_mode, onUpdate, t])

  // Hook de histórico de etapas (só carrega quando o modal está aberto)
  const {
    history: stageHistory,
    usersMap,
    currentEnteredAt,
    loading: loadingStage,
    error: stageError
  } = useOpportunityStageHistory(
    isOpen ? opportunity.id : null,
    companyId
  )

  // Reset de aba / modo edição: só ao abrir, mudar oportunidade (id) ou initialTab — não a cada atualização do objeto `opportunity` (mesmo id).
  useEffect(() => {
    if (!isOpen) return
    setActiveTab(initialTab)
    setEditMode(false)
    setSaveError(null)
    setProbSaved(false)
  }, [isOpen, initialTab, opportunity.id])

  // Dados da oportunidade no estado local (mesma oportunidade pode receber novo objeto do pai sem resetar a aba ativa).
  useEffect(() => {
    if (!isOpen) return
    setProbDraft(opportunity.probability)
    setDetailOpportunity(opportunity)
  }, [isOpen, opportunity])

  // Carregar usuários da empresa para o select de responsável
  useEffect(() => {
    if (!isOpen || !companyId) return
    getCompanyUsers(companyId).then(setCompanyUsers).catch(() => {})
  }, [isOpen, companyId])

  useEffect(() => {
    if (!isOpen || !companyId) {
      setCompositionEntitled(false)
      return
    }
    catalogApi
      .getOpportunityItemsEntitlement(companyId)
      .then((e) => setCompositionEntitled(e.allowed))
      .catch(() => setCompositionEntitled(false))
  }, [isOpen, companyId])

  // Carregar histórico de status ao abrir
  useEffect(() => {
    if (!isOpen) return
    setLoadingStatus(true)
    supabase
      .from('opportunity_status_history')
      .select('*')
      .eq('opportunity_id', opportunity.id)
      .eq('company_id', companyId)
      .order('changed_at', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setStatusHistory(data)
      })
      .finally(() => setLoadingStatus(false))
  }, [isOpen, opportunity.id, companyId])

  // Auto-scroll para o último evento ao abrir aba Jornada
  useEffect(() => {
    if (activeTab !== 'journey' || loadingStage) return
    const timer = setTimeout(() => {
      lastEventRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 150)
    return () => clearTimeout(timer)
  }, [activeTab, loadingStage])

  const statusConfigResolved = useMemo(
    () => ({
      open: { ...statusConfig.open, label: t('opportunityDetail.badge.open') },
      won: { ...statusConfig.won, label: t('opportunityDetail.badge.won') },
      lost: { ...statusConfig.lost, label: t('opportunityDetail.badge.lost') }
    }),
    [t]
  )

  const statusCfg = statusConfigResolved[opportunity.status] ?? statusConfigResolved.open

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'details', label: t('opportunityDetail.tabs.details'), icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'journey', label: t('opportunityDetail.tabs.journey'), icon: <Route className="w-3.5 h-3.5" /> },
    { key: 'status', label: t('opportunityDetail.tabs.status'), icon: <Clock className="w-3.5 h-3.5" /> }
  ]

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center gap-3 p-5 border-b ${statusCfg.headerBg} border-${statusCfg.headerBorder} rounded-t-xl`}>
          <div className={`p-2 rounded-lg ${statusCfg.iconBg}`}>
            <Briefcase className={`w-5 h-5 ${statusCfg.iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-gray-900 truncate">{opportunity.title}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 ${statusCfg.bg} ${statusCfg.color}`}>
                {statusCfg.icon}
                {statusCfg.label}
              </span>
            </div>
            {opportunity.description && (
              <p className="text-sm text-gray-500 truncate mt-0.5">{opportunity.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Abas */}
        <div className="flex border-b border-gray-200 px-1">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key)
              }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Body — scrollável */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ABA: Detalhes */}
          {activeTab === 'details' && (
            <div className="space-y-5">

              {/* Cabeçalho da seção com botão de edição */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  {editMode ? t('opportunityDetail.sectionEditing') : t('opportunityDetail.sectionInfo')}
                </p>
                {!editMode && (
                  <button
                    onClick={handleEditStart}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {t('form.edit')}
                  </button>
                )}
              </div>

              {/* Título */}
              <div>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <Briefcase className="w-3.5 h-3.5" />
                  {t('opportunityDetail.fields.title')}
                </label>
                {editMode ? (
                  <input
                    type="text"
                    value={form.title ?? ''}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('opportunityDetail.fields.titlePlaceholder')}
                  />
                ) : (
                  <p className="text-sm font-medium text-gray-800">{opportunity.title}</p>
                )}
              </div>

              {/* Descrição */}
              <div>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <FileText className="w-3.5 h-3.5" />
                  {t('opportunityDetail.fields.description')}
                </label>
                {editMode ? (
                  <textarea
                    value={form.description ?? ''}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder={t('opportunityDetail.fields.descriptionPlaceholder')}
                  />
                ) : (
                  <p className="text-sm text-gray-700">{opportunity.description || <span className="text-gray-400">—</span>}</p>
                )}
              </div>

              {/* Grid: Valor + Probabilidade (composição fica em bloco full-width abaixo) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                    <DollarSign className="w-3.5 h-3.5" />
                    {t('opportunityDetail.fields.value', { currency: opportunity.currency })}
                  </label>
                  {editMode ? (
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.value ?? 0}
                      onChange={e => setForm(f => ({ ...f, value: parseFloat(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className={`text-sm font-semibold ${opportunity.status === 'won' ? 'text-emerald-700' : 'text-gray-800'}`}>
                      {opportunity.value > 0 ? formatCurrency(opportunity.value, opportunity.currency) : '—'}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                      <TrendingUp className="w-3.5 h-3.5" />
                      {t('opportunityDetail.fields.probability')}
                    </label>
                    <div className="flex items-center gap-1">
                      <span className={`text-sm font-semibold ${
                        probDraft <= 30 ? 'text-red-600' :
                        probDraft <= 70 ? 'text-amber-600' :
                        'text-emerald-600'
                      }`}>
                        {probDraft}%
                      </span>
                      {savingProb && (
                        <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin ml-1" />
                      )}
                      {probSaved && !savingProb && (
                        <Check className="w-3.5 h-3.5 text-emerald-500 ml-1" />
                      )}
                    </div>
                  </div>

                  {/* Barra de progresso visual */}
                  <div className="relative h-2 bg-gray-200 rounded-full mb-2 overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full transition-all duration-75 ${
                        probDraft <= 30 ? 'bg-red-500' :
                        probDraft <= 70 ? 'bg-amber-400' :
                        'bg-emerald-500'
                      }`}
                      style={{ width: `${probDraft}%` }}
                    />
                  </div>

                  {/* Slider */}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={editMode ? (form.probability ?? probDraft) : probDraft}
                    onChange={e => {
                      const v = parseInt(e.target.value)
                      setProbDraft(v)
                      if (editMode) setForm(f => ({ ...f, probability: v }))
                    }}
                    onPointerUp={e => {
                      const v = parseInt((e.target as HTMLInputElement).value)
                      if (!editMode) handleProbabilityCommit(v)
                    }}
                    className="w-full h-1.5 appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              </div>

              <div className="w-full min-w-0 pt-1">
                <OpportunityItemsSection
                  companyId={companyId}
                  opportunity={detailOpportunity}
                  canEdit={opportunity.status === 'open'}
                  onOpportunityUpdated={(o) => {
                    setDetailOpportunity(o)
                    onUpdate?.(o)
                  }}
                />
              </div>

              {/* Grid: Responsável + Previsão de fechamento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                    <User className="w-3.5 h-3.5" />
                    {t('opportunityDetail.fields.owner')}
                  </label>
                  {editMode ? (
                    <select
                      value={form.owner_user_id ?? ''}
                      onChange={e => setForm(f => ({ ...f, owner_user_id: e.target.value || undefined }))}
                      disabled={!isManager}
                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        isManager
                          ? 'border-gray-300 bg-white'
                          : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      <option value="">{t('opportunityDetail.fields.noOwner')}</option>
                      {companyUsers.map(u => (
                        <option key={u.user_id} value={u.user_id}>
                          {u.display_name || u.email || u.user_id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm font-medium text-gray-800">
                      {opportunity.owner_user_id
                        ? (companyUsers.find(u => u.user_id === opportunity.owner_user_id)?.display_name
                          || companyUsers.find(u => u.user_id === opportunity.owner_user_id)?.email
                          || '—')
                        : <span className="text-gray-400">—</span>
                      }
                    </p>
                  )}
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {t('opportunityDetail.fields.expectedClose')}
                  </label>
                  {editMode ? (
                    <input
                      type="date"
                      value={form.expected_close_date ? form.expected_close_date.substring(0, 10) : ''}
                      onChange={e => setForm(f => ({ ...f, expected_close_date: e.target.value || undefined }))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-800">
                      {opportunity.expected_close_date ? formatDateShort(opportunity.expected_close_date) : <span className="text-gray-400">—</span>}
                    </p>
                  )}
                </div>
              </div>

              {/* Motivo da perda (editável apenas para status lost) */}
              {(opportunity.status === 'lost' || (editMode && opportunity.status === 'lost')) && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs text-red-500 mb-1">
                    <XCircle className="w-3.5 h-3.5" />
                    {t('opportunityDetail.fields.lossReason')}
                  </label>
                  {editMode ? (
                    <input
                      type="text"
                      value={form.loss_reason ?? ''}
                      onChange={e => setForm(f => ({ ...f, loss_reason: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                      placeholder={t('opportunityDetail.fields.lossReasonPlaceholder')}
                    />
                  ) : (
                    <p className="text-sm text-gray-800 bg-red-50 rounded-lg px-3 py-2">
                      {opportunity.loss_reason || <span className="text-gray-400">—</span>}
                    </p>
                  )}
                </div>
              )}

              {/* Campos somente leitura */}
              {!editMode && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-gray-100">
                  {opportunity.source && (
                    <div>
                      <p className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                        <Tag className="w-3.5 h-3.5" />
                        {t('opportunityDetail.fields.source')}
                      </p>
                      <p className="text-sm font-medium text-gray-800">{opportunity.source}</p>
                    </div>
                  )}

                  {opportunity.closed_at && (
                    <div>
                      <p className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {t('opportunityDetail.fields.closedAt')}
                      </p>
                      <p className="text-sm font-medium text-gray-800">{formatDateShort(opportunity.closed_at)}</p>
                    </div>
                  )}

                  <div>
                    <p className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                      <FileText className="w-3.5 h-3.5" />
                      {t('opportunityDetail.fields.createdAt')}
                    </p>
                    <p className="text-sm font-medium text-gray-800">{formatDateShort(opportunity.created_at)}</p>
                  </div>

                  {opportunity.updated_at && (
                    <div>
                      <p className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                        <Clock className="w-3.5 h-3.5" />
                        {t('opportunityDetail.fields.updatedAt')}
                      </p>
                      <p className="text-sm font-medium text-gray-800">{formatDateShort(opportunity.updated_at)}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Erro de save */}
              {saveError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {saveError}
                </div>
              )}
            </div>
          )}

          {/* ABA: Jornada */}
          {activeTab === 'journey' && (
            <OpportunityStageTimeline
              history={stageHistory}
              usersMap={usersMap}
              currentEnteredAt={currentEnteredAt}
              loading={loadingStage}
              error={stageError}
              lastEventRef={lastEventRef}
            />
          )}

          {/* ABA: Status */}
          {activeTab === 'status' && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                {t('opportunityDetail.statusTab.title')}
              </p>
              {loadingStatus ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  {t('form.loading')}
                </div>
              ) : statusHistory.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">{t('opportunityDetail.statusTab.empty')}</p>
              ) : (
                <div>
                  {statusHistory.map((entry, idx) => (
                    <TimelineEntry
                      key={entry.id}
                      entry={entry}
                      isLast={idx === statusHistory.length - 1}
                      fallbackCurrency={opportunity.currency}
                      statusConfig={statusConfigResolved}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 pt-0 border-t border-gray-100">
          {editMode ? (
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={saving}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {t('form.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title?.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saving ? t('form.savingEllipsis') : t('form.save')}
              </button>
            </div>
          ) : (
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {t('form.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
