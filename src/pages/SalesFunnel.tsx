// =====================================================
// PÁGINA: SalesFunnel
// Data: 03/03/2026
// Objetivo: Página principal do funil de vendas
// =====================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounce } from '../hooks/useDebounce'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Filter, Download, Plus, Sliders, MoreVertical, Edit2, X, Tag as TagIcon, ChevronUp } from 'lucide-react'
import { FunnelBoard } from '../components/SalesFunnel/FunnelBoard'
import { FunnelListView } from '../components/SalesFunnel/FunnelListView'
import { FunnelViewToggle } from '../components/SalesFunnel/FunnelViewToggle'
import { FunnelSelector } from '../components/SalesFunnel/FunnelSelector'
import { CreateFunnelWizard } from '../components/SalesFunnel/CreateFunnelWizard'
import { EditFunnelModal } from '../components/SalesFunnel/EditFunnelModal'
import { LeadCardCustomizer } from '../components/SalesFunnel/LeadCardCustomizer'
import ChatModalSimple from '../components/SalesFunnel/ChatModalSimple'
import { PeriodFilter } from '../components/PeriodFilter'
import { useFunnels } from '../hooks/useFunnels'
import { useAuth } from '../contexts/AuthContext'
import { useAvailableTags } from '../hooks/useAvailableTags'
import { useAccessControl } from '../hooks/useAccessControl'
import { useContactCycleConfig }   from '../hooks/useContactCycleConfig'
import { useCompanyIntegration }   from '../hooks/useCompanyIntegration'
import { funnelApi, FUNNEL_PROBABILITY_RANGE_RPC_ENABLED } from '../services/funnelApi'
import { api } from '../services/api'
import { supabase } from '../lib/supabase'
import type { CreateFunnelForm, FunnelStage, SortOption, DateField, CustomFieldDefinition } from '../types/sales-funnel'
import { FUNNEL_CONSTANTS } from '../types/sales-funnel'
import type { ContactAttemptsState } from '../types/contact-cycles'
import type { PeriodFilter as PeriodFilterType } from '../types/analytics'
import {
  useFunnelFilterPreferences,
  type FunnelFilterSnapshot,
  DEFAULT_FILTER_SNAPSHOT,
} from '../hooks/useFunnelFilterPreferences'
import { useFunnelViewMode } from '../hooks/useFunnelViewMode'
import { UNASSIGNED_ASSIGNEE, isValidAssigneeSelection } from '../utils/funnelAssigneeFilter'
import { ProbabilityRangeFilter } from '../components/SalesFunnel/ProbabilityRangeFilter'
import {
  EMPTY_PROBABILITY_RANGE,
  commitProbabilityDraft,
  formatProbabilityRangeLabel,
  getEffectiveProbabilityRange,
  probabilityRangeToDraftTexts,
  type ProbabilityRange,
} from '../utils/funnelProbabilityFilter'

export default function SalesFunnel() {
  const { t } = useTranslation('funnel')
  const navigate = useNavigate()
  const { company, user } = useAuth()
  const companyId = company?.id

  // Deep-link do Dashboard: /sales-funnel?opportunity_id=xxx
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightOpportunityId = searchParams.get('opportunity_id') ?? null

  const {
    funnels,
    loading,
    error,
    selectedFunnel,
    setSelectedFunnel,
    createFunnel,
    deleteFunnel,
    reorderFunnels,
    refreshFunnels,
    isAtFunnelLimit,
  } = useFunnels(companyId || '', undefined, user?.id)

  // ─── Persistência de filtros ────────────────────────────────────────────────
  const {
    savedFilters,
    isLoaded: filtersLoaded,
    loadedFunnelId: filtersLoadedForFunnelId,
    saveFilters,
    clearFilters,
    hasUnsavedChanges,
  } = useFunnelFilterPreferences(companyId, user?.id, selectedFunnel?.id)

  const [showFilters, setShowFilters] = useState(false)
  const [hasSavedFilters, setHasSavedFilters] = useState(false)
  const hasRestoredRef = useRef<string | null>(null)

  const [showCreateFunnelModal, setShowCreateFunnelModal] = useState(false)
  const [showEditFunnelModal, setShowEditFunnelModal] = useState(false)
  const [showCardCustomizer, setShowCardCustomizer] = useState(false)
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  const [showChatModal, setShowChatModal] = useState(false)
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null)
  const [visibleFields, setVisibleFields] = useState<string[]>([...FUNNEL_CONSTANTS.DEFAULT_VISIBLE_FIELDS])
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedTagsMode, setSelectedTagsMode] = useState<'or' | 'and'>('or')
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const [selectedOrigin, setSelectedOrigin] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilterType | null>(null)
  const [selectedDateField, setSelectedDateField] = useState<DateField>('created_at')
  const [globalSort, setGlobalSort] = useState<SortOption | undefined>(undefined)
  const [selectedOwner, setSelectedOwner] = useState<string>('')
  const [ownerOptions, setOwnerOptions] = useState<{ user_id: string; display_name: string }[]>([])
  const [selectedCycleState, setSelectedCycleState] = useState<ContactAttemptsState | null>(null)
  const [probabilityMinText, setProbabilityMinText] = useState('')
  const [probabilityMaxText, setProbabilityMaxText] = useState('')
  const [probabilityDraftError, setProbabilityDraftError] = useState<string | null>(null)
  const [appliedProbability, setAppliedProbability] = useState<ProbabilityRange>(EMPTY_PROBABILITY_RANGE)

  const applyProbabilityRange = useCallback((range: ProbabilityRange) => {
    const texts = probabilityRangeToDraftTexts(range)
    setProbabilityMinText(texts.minText)
    setProbabilityMaxText(texts.maxText)
    setAppliedProbability(range)
    setProbabilityDraftError(null)
  }, [])

  const { viewMode, setViewMode } = useFunnelViewMode(companyId, user?.id)
  const { canViewContactCycles }  = useAccessControl()
  // Visibilidade condicional — integração Nuvemshop (UX apenas; segurança no backend)
  const { hasNuvemshopEver }      = useCompanyIntegration()
  const { config: cycleConfig } = useContactCycleConfig(companyId ?? null)
  const showCycleFilter = canViewContactCycles && cycleConfig?.enabled === true

  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const { tags: availableTags } = useAvailableTags(companyId)

  // Carregar usuários atribuíveis para o dropdown de responsável.
  // Usa get_assignable_users (exige apenas membership ativa) em vez de
  // get_company_users_with_details (exige permissão 'users') para evitar
  // dropdown vazio para sellers e managers sem essa permissão.
  // Padrão idêntico ao usado em LeadPanel.tsx e WhatsAppLifeModule.tsx.
  useEffect(() => {
    if (!companyId) return
    supabase
      .rpc('get_assignable_users', { p_company_id: companyId })
      .then(({ data }) => setOwnerOptions(data || []))
      .catch(() => setOwnerOptions([]))
  }, [companyId])

  // ─── Restauração das preferências salvas ────────────────────────────────────
  // Executa uma vez por funil assim que companyId, userId, funnelId e
  // savedFilters estiverem disponíveis. selectedOwner é restaurado imediatamente
  // e validado em um efeito separado quando ownerOptions carregar.
  //
  // SINCRONIZAÇÃO: filtersLoadedForFunnelId garante que savedFilters corresponde
  // exatamente ao funil selecionado. Sem essa guarda, haveria uma race condition
  // na troca de funil: o efeito rodaria com savedFilters do funil anterior antes
  // do hook terminar de ler o localStorage do novo funil.
  useEffect(() => {
    if (!filtersLoaded) return
    if (!companyId || !user?.id || !selectedFunnel?.id) return
    // Aguarda o hook carregar os dados do funil correto antes de restaurar
    if (filtersLoadedForFunnelId !== selectedFunnel.id) return
    if (hasRestoredRef.current === selectedFunnel.id) return

    hasRestoredRef.current = selectedFunnel.id

    if (!savedFilters) {
      setSearchTerm(DEFAULT_FILTER_SNAPSHOT.searchTerm)
      setSelectedTags(DEFAULT_FILTER_SNAPSHOT.selectedTags)
      setSelectedTagsMode(DEFAULT_FILTER_SNAPSHOT.selectedTagsMode)
      setSelectedOrigin(DEFAULT_FILTER_SNAPSHOT.selectedOrigin)
      setSelectedPeriod(DEFAULT_FILTER_SNAPSHOT.selectedPeriod)
      setSelectedDateField(DEFAULT_FILTER_SNAPSHOT.selectedDateField)
      setGlobalSort(DEFAULT_FILTER_SNAPSHOT.globalSort)
      setSelectedOwner(DEFAULT_FILTER_SNAPSHOT.selectedOwner)
      setSelectedCycleState(DEFAULT_FILTER_SNAPSHOT.selectedCycleState)
      applyProbabilityRange(EMPTY_PROBABILITY_RANGE)
      setHasSavedFilters(false)
      return
    }

    setSearchTerm(savedFilters.searchTerm)
    setSelectedTags(savedFilters.selectedTags)
    setSelectedTagsMode(savedFilters.selectedTagsMode)
    setSelectedOrigin(savedFilters.selectedOrigin)
    setSelectedPeriod(savedFilters.selectedPeriod)
    setSelectedDateField(savedFilters.selectedDateField ?? 'created_at')
    setGlobalSort(savedFilters.globalSort)
    // selectedOwner é restaurado aqui e revalidado quando ownerOptions carregar
    setSelectedOwner(savedFilters.selectedOwner)
    setSelectedCycleState(savedFilters.selectedCycleState ?? null)
    applyProbabilityRange({
      min: savedFilters.probabilityMin,
      max: savedFilters.probabilityMax,
    })
    setHasSavedFilters(true)
  }, [filtersLoaded, filtersLoadedForFunnelId, companyId, user?.id, selectedFunnel?.id, savedFilters, applyProbabilityRange])

  // ─── Validação de selectedOwner contra ownerOptions ─────────────────────────
  // Só atua quando ownerOptions já carregou. Se o owner salvo não existir mais,
  // limpa silenciosamente sem bloquear a restauração dos demais filtros.
  useEffect(() => {
    if (ownerOptions.length === 0 || !selectedOwner) return
    const isValid = isValidAssigneeSelection(
      selectedOwner,
      ownerOptions.map(o => o.user_id),
    )
    if (!isValid) setSelectedOwner('')
  }, [ownerOptions, selectedOwner])

  // Debounce na busca textual: evita requisições a cada tecla (300ms)
  const debouncedSearch = useDebounce(searchTerm, 300)

  const optionsMenuRef = useRef<HTMLDivElement>(null)

  // Fechar menu de opções ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(event.target as Node)) {
        setShowOptionsMenu(false)
      }
    }

    if (showOptionsMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showOptionsMenu])

  // Fechar dropdown de tags ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(event.target as Node)) {
        setTagDropdownOpen(false)
      }
    }
    if (tagDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [tagDropdownOpen])

  const addTag = (tagId: string) => {
    if (!selectedTags.includes(tagId)) {
      setSelectedTags(prev => [...prev, tagId])
    }
    setTagDropdownOpen(false)
  }

  const removeTag = (tagId: string) => {
    setSelectedTags(prev => prev.filter(id => id !== tagId))
  }

  // Carregar preferências salvas ao montar componente e ao trocar funil
  useEffect(() => {
    const loadPreferences = async () => {
      if (!companyId) return
      try {
        const preferences = await funnelApi.getCardPreferences(companyId)
        if (preferences && preferences.visible_fields && preferences.visible_fields.length > 0) {
          setVisibleFields(preferences.visible_fields)
        }
      } catch (error) {
        console.error('Error loading preferences:', error)
      }
    }
    loadPreferences()
  }, [companyId, selectedFunnel])

  // Carregar definições de campos personalizados para o customizer
  useEffect(() => {
    let cancelled = false

    if (!companyId) {
      setCustomFields([])
      return () => { cancelled = true }
    }
    api.getCustomFields(companyId)
      .then((fields) => {
        if (cancelled) return
        setCustomFields(fields as CustomFieldDefinition[])
      })
      .catch(() => {
        if (!cancelled) setCustomFields([])
      })

    return () => { cancelled = true }
  }, [companyId])

  // ─── Helper: snapshot do estado atual de filtros ────────────────────────────
  const buildCurrentSnapshot = useCallback((): FunnelFilterSnapshot => ({
    version: 1,
    searchTerm,
    selectedTags,
    selectedTagsMode,
    selectedOrigin,
    selectedPeriod,
    selectedDateField,
    globalSort,
    selectedOwner,
    selectedCycleState,
    probabilityMin: FUNNEL_PROBABILITY_RANGE_RPC_ENABLED
      ? appliedProbability.min
      : (savedFilters?.probabilityMin ?? appliedProbability.min),
    probabilityMax: FUNNEL_PROBABILITY_RANGE_RPC_ENABLED
      ? appliedProbability.max
      : (savedFilters?.probabilityMax ?? appliedProbability.max),
  }), [searchTerm, selectedTags, selectedTagsMode, selectedOrigin, selectedPeriod, selectedDateField, globalSort, selectedOwner, selectedCycleState, appliedProbability, savedFilters])

  const handleToggleFilters = useCallback(() => {
    setShowFilters(prev => !prev)
  }, [])

  const handleSavePreference = useCallback(() => {
    if (!selectedFunnel?.id) return
    saveFilters(buildCurrentSnapshot())
    setHasSavedFilters(true)
  }, [selectedFunnel?.id, saveFilters, buildCurrentSnapshot])

  const allPeriodDisplay = useMemo<PeriodFilterType>(
    () => ({ type: 'all', label: t('filters.periodAll') }),
    [t],
  )

  const handlePeriodChange = useCallback((period: PeriodFilterType) => {
    setSelectedPeriod(period.type === 'all' ? null : period)
  }, [])

  const activeFilterChips = useMemo(() => {
    const chips: { id: string; label: string; onClear: () => void }[] = []

    if (searchTerm.trim()) {
      chips.push({
        id: 'search',
        label: `${t('filters.searchLabel')}: ${searchTerm.trim()}`,
        onClear: () => setSearchTerm(''),
      })
    }

    for (const tagId of selectedTags) {
      const tag = availableTags.find(item => item.id === tagId)
      chips.push({
        id: `tag-${tagId}`,
        label: tag?.name ?? tagId,
        onClear: () => removeTag(tagId),
      })
    }

    if (selectedOrigin) {
      const originLabels: Record<string, string> = {
        whatsapp: t('filters.originWhatsapp'),
        site: t('filters.originSite'),
        indicacao: t('filters.originReferral'),
        nuvemshop: 'Nuvemshop',
        nuvemshop_abandoned: 'Carrinho Abandonado (NS)',
      }
      chips.push({
        id: 'origin',
        label: `${t('filters.originLabel')}: ${originLabels[selectedOrigin] ?? selectedOrigin}`,
        onClear: () => setSelectedOrigin(''),
      })
    }

    if (selectedOwner) {
      const ownerName = selectedOwner === UNASSIGNED_ASSIGNEE
        ? t('filters.ownerUnassigned')
        : (ownerOptions.find(userOption => userOption.user_id === selectedOwner)?.display_name ?? t('filters.ownerLabel'))
      chips.push({
        id: 'owner',
        label: `${t('filters.ownerLabel')}: ${ownerName}`,
        onClear: () => setSelectedOwner(''),
      })
    }

    if (selectedPeriod) {
      const dateFieldLabel = selectedDateField === 'closed_at'
        ? t('filters.dateFieldClosed')
        : selectedDateField === 'last_contact_at'
          ? t('filters.dateFieldLastContact')
          : t('filters.dateFieldCreated')
      chips.push({
        id: 'period',
        label: `${dateFieldLabel}: ${selectedPeriod.label || t('filters.periodLabel')}`,
        onClear: () => setSelectedPeriod(null),
      })
    }

    if (selectedCycleState) {
      const cycleLabels: Record<ContactAttemptsState, string> = {
        none: t('contactCycle.filterAll'),
        cycle_open: t('contactCycle.filterCycleOpen'),
        waiting: t('contactCycle.filterWaiting'),
        eligible: t('contactCycle.filterEligible'),
      }
      chips.push({
        id: 'cycle',
        label: cycleLabels[selectedCycleState] ?? selectedCycleState,
        onClear: () => setSelectedCycleState(null),
      })
    }

    const probabilityLabel = FUNNEL_PROBABILITY_RANGE_RPC_ENABLED
      ? formatProbabilityRangeLabel(appliedProbability)
      : null
    if (probabilityLabel) {
      chips.push({
        id: 'probability',
        label: `${t('filters.probabilityLabel')}: ${probabilityLabel}`,
        onClear: () => applyProbabilityRange(EMPTY_PROBABILITY_RANGE),
      })
    }

    if (globalSort) {
      const sortLabels: Record<SortOption, string> = {
        entered_stage_at: t('filters.sortEnteredStage'),
        entered_funnel_at: t('filters.sortEnteredFunnel'),
        lead_created_at: t('filters.sortLeadCreated'),
        last_interaction_at: t('filters.sortLastInteraction'),
      }
      chips.push({
        id: 'sort',
        label: `${t('filters.sortLabel')}: ${sortLabels[globalSort]}`,
        onClear: () => setGlobalSort(undefined),
      })
    }

    return chips
  }, [
    searchTerm, selectedTags, availableTags, selectedOrigin, selectedOwner, ownerOptions,
    selectedPeriod, selectedDateField, selectedCycleState, appliedProbability, globalSort, applyProbabilityRange, t,
  ])

  const effectiveProbability = getEffectiveProbabilityRange(
    appliedProbability,
    FUNNEL_PROBABILITY_RANGE_RPC_ENABLED,
  )

  const filtersHaveUnsavedChanges = hasUnsavedChanges(buildCurrentSnapshot())

  const handleClearSavedFilters = useCallback(() => {
    clearFilters()
    setSearchTerm(DEFAULT_FILTER_SNAPSHOT.searchTerm)
    setSelectedTags(DEFAULT_FILTER_SNAPSHOT.selectedTags)
    setSelectedTagsMode(DEFAULT_FILTER_SNAPSHOT.selectedTagsMode)
    setSelectedOrigin(DEFAULT_FILTER_SNAPSHOT.selectedOrigin)
    setSelectedPeriod(DEFAULT_FILTER_SNAPSHOT.selectedPeriod)
    setSelectedDateField(DEFAULT_FILTER_SNAPSHOT.selectedDateField)
    setGlobalSort(DEFAULT_FILTER_SNAPSHOT.globalSort)
    setSelectedOwner(DEFAULT_FILTER_SNAPSHOT.selectedOwner)
    setSelectedCycleState(DEFAULT_FILTER_SNAPSHOT.selectedCycleState)
    applyProbabilityRange(EMPTY_PROBABILITY_RANGE)
    setHasSavedFilters(false)
  }, [clearFilters, applyProbabilityRange])

  const handleLeadClick = (leadId: number) => {
    setSelectedLeadId(leadId)
    setShowChatModal(true)
  }

  const handleCreateFunnel = () => {
    if (isAtFunnelLimit) return
    setShowCreateFunnelModal(true)
  }

  const handleSubmitFunnel = async (
    data: CreateFunnelForm,
    stages: Omit<FunnelStage, 'id' | 'funnel_id' | 'created_at' | 'updated_at'>[]
  ) => {
    if (!companyId) return
    
    // Criar funil com flag para pular criação automática de etapas
    const funnelData = { ...data, skip_default_stages: true }
    const newFunnel = await createFunnel(funnelData)
    
    // Criar etapas customizadas
    for (const stage of stages) {
      await funnelApi.createStage({
        funnel_id: newFunnel.id,
        name: stage.name,
        description: stage.description,
        color: stage.color,
        position: stage.position,
        stage_type: stage.stage_type
      })
    }
    
    await refreshFunnels()
  }

  const handleUpdateCardPreferences = async (fields: string[]) => {
    if (!companyId) return
    try {
      setVisibleFields(fields)
      await funnelApi.updateCardPreferences(companyId, fields)
    } catch (error) {
      console.error('Error saving preferences:', error)
      alert(t('alerts.savePreferencesError'))
    }
  }

  const handleExport = async () => {
    if (!selectedFunnel || !companyId) {
      alert(t('alerts.exportSelectFunnel'))
      return
    }

    try {
      // Buscar todas as posições do funil
      const positions = await funnelApi.getLeadPositions(selectedFunnel.id)
      
      if (!positions || positions.length === 0) {
        alert(t('alerts.exportNoLeads'))
        return
      }

      // Buscar etapas para mapear nomes
      const stages = await funnelApi.getStages(selectedFunnel.id)
      const stageMap = new Map(stages.map((s: any) => [s.id, s.name]))

      // Preparar dados CSV
      const csvHeaders = [
        t('export.csvHeaders.name'),
        t('export.csvHeaders.email'),
        t('export.csvHeaders.phone'),
        t('export.csvHeaders.company'),
        t('export.csvHeaders.stage'),
        t('export.csvHeaders.dealValue'),
        t('export.csvHeaders.origin'),
        t('export.csvHeaders.entryDate'),
        t('export.csvHeaders.daysInStage')
      ]

      const csvRows = positions.map(pos => {
        const lead = pos.lead
        if (!lead) return null

        return [
          lead.name || '',
          lead.email || '',
          lead.phone || '',
          lead.company_name || '',
          stageMap.get(pos.stage_id) || '',
          lead.deal_value ? `R$ ${lead.deal_value.toFixed(2)}` : '',
          lead.origin || '',
          pos.entered_stage_at ? new Date(pos.entered_stage_at).toLocaleDateString('pt-BR') : '',
          pos.days_in_stage || 0
        ]
      }).filter(row => row !== null)

      // Criar CSV
      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row!.map(cell => `"${cell}"`).join(','))
      ].join('\n')

      // Download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      
      link.setAttribute('href', url)
      link.setAttribute('download', `funil_${selectedFunnel.name}_${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error exporting data:', error)
      alert(t('alerts.exportError'))
    }
  }

  // Removido: botão de configurações - usuário cria funis direto nesta página

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-gray-600">{t('states.companyNotFound')}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-600">{t('states.loadingFunnels')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {t('states.retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Banner de contexto — visível quando navegado a partir do Dashboard */}
      {highlightOpportunityId && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex items-center justify-between">
          <p className="text-xs text-blue-700">
            Navegado a partir do Dashboard — use a busca ou os filtros para localizar a oportunidade.
          </p>
          <button
            className="text-xs text-blue-500 hover:text-blue-700 underline ml-4"
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('opportunity_id')
              setSearchParams(next)
            }}
          >
            Limpar
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900">
              {t('header.title')}
            </h1>
            
            <FunnelSelector
              funnels={funnels}
              selectedFunnel={selectedFunnel}
              onSelectFunnel={setSelectedFunnel}
              onCreateFunnel={handleCreateFunnel}
              onReorderFunnels={reorderFunnels}
              isAtFunnelLimit={isAtFunnelLimit}
            />
          </div>

          <div className="flex items-center gap-2">
            <FunnelViewToggle viewMode={viewMode} onChange={setViewMode} />
            <button
              onClick={handleToggleFilters}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg transition-colors
                ${showFilters || activeFilterChips.length > 0
                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }
              `}
              title={showFilters ? t('filters.minimize') : t('filters.expand')}
            >
              <Filter className="w-4 h-4" />
              <span className="text-sm font-medium">
                {activeFilterChips.length > 0
                  ? t('filters.activeCount', { count: activeFilterChips.length })
                  : t('actions.filters')}
              </span>
              {(hasSavedFilters || activeFilterChips.length > 0) && !showFilters && (
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              )}
            </button>

            {/* Menu de Opções (...) */}
            <div className="relative" ref={optionsMenuRef}>
              <button
                onClick={() => setShowOptionsMenu(!showOptionsMenu)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                title={t('actions.moreOptions')}
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showOptionsMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <button
                    onClick={() => {
                      setShowCardCustomizer(true)
                      setShowOptionsMenu(false)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                  >
                    <Sliders className="w-4 h-4" />
                    <span>{t('actions.customize')}</span>
                  </button>

                  <button
                    onClick={() => {
                      handleExport()
                      setShowOptionsMenu(false)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                  >
                    <Download className="w-4 h-4" />
                    <span>{t('actions.export')}</span>
                  </button>

                  <div className="border-t border-gray-200 my-1" />

                  <button
                    onClick={() => {
                      setShowEditFunnelModal(true)
                      setShowOptionsMenu(false)
                    }}
                    disabled={!selectedFunnel}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Edit2 className="w-4 h-4" />
                    <span>{t('actions.editFunnel')}</span>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => navigate('/leads?action=create')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">{t('actions.newLead')}</span>
            </button>
          </div>
        </div>

        {!showFilters && (activeFilterChips.length > 0 || hasSavedFilters) && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {activeFilterChips.map(chip => (
              <span
                key={chip.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.onClear}
                  className="hover:opacity-70 transition-opacity"
                  title={t('filters.clearChip')}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {hasSavedFilters && (
              <button
                type="button"
                onClick={handleClearSavedFilters}
                className="text-xs text-gray-500 hover:text-gray-700 underline transition-colors"
              >
                {t('filters.clearSaved')}
              </button>
            )}
          </div>
        )}

        {showFilters && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
            <div className="flex items-center justify-end gap-2">
              {filtersHaveUnsavedChanges && (
                <button
                  type="button"
                  onClick={handleSavePreference}
                  className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                >
                  {t('filters.savePreference')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowFilters(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-300 bg-white rounded-md hover:bg-gray-50 transition-colors"
                title={t('filters.minimize')}
              >
                <ChevronUp className="w-3.5 h-3.5" />
                {t('filters.minimize')}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {t('filters.searchLabel')}
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('filters.searchPlaceholder')}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-700">
                    {t('filters.tagsLabel')}
                  </label>
                  {selectedTags.length > 1 && (
                    <div className="flex rounded border border-gray-300 overflow-hidden text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedTagsMode('or')}
                        className={`px-2 py-0.5 transition-colors ${selectedTagsMode === 'or' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Qualquer
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedTagsMode('and')}
                        className={`px-2 py-0.5 border-l border-gray-300 transition-colors ${selectedTagsMode === 'and' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Todas
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1 min-h-[34px] px-2 py-1 border border-gray-300 rounded-lg bg-white">
                  {selectedTags.map(tagId => {
                    const tag = availableTags.find(item => item.id === tagId)
                    if (!tag) return null
                    return (
                      <span
                        key={tagId}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: `${tag.color}22`, color: tag.color, border: `1px solid ${tag.color}66` }}
                      >
                        {tag.name}
                        <button
                          type="button"
                          onClick={() => removeTag(tagId)}
                          className="hover:opacity-70 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )
                  })}
                  {availableTags.some(item => !selectedTags.includes(item.id)) && (
                    <div className="relative" ref={tagDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setTagDropdownOpen(prev => !prev)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs border border-dashed border-gray-300 rounded-full text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
                      >
                        <TagIcon className="w-3 h-3" />
                        {selectedTags.length === 0 ? t('filters.filterByTag') : t('filters.addTag')}
                      </button>
                      {tagDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] max-h-48 overflow-y-auto">
                          {availableTags
                            .filter(item => !selectedTags.includes(item.id))
                            .map(tag => (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => addTag(tag.id)}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2 transition-colors"
                              >
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                                <span className="truncate">{tag.name}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {t('filters.originLabel')}
                </label>
                <select
                  value={selectedOrigin}
                  onChange={(e) => setSelectedOrigin(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t('filters.originAll')}</option>
                  <option value="whatsapp">{t('filters.originWhatsapp')}</option>
                  <option value="site">{t('filters.originSite')}</option>
                  <option value="indicacao">{t('filters.originReferral')}</option>
                  {hasNuvemshopEver && (
                    <>
                      <option value="nuvemshop">Nuvemshop</option>
                      <option value="nuvemshop_abandoned">Carrinho Abandonado (NS)</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {t('filters.ownerLabel')}
                </label>
                <select
                  value={selectedOwner}
                  onChange={(e) => setSelectedOwner(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t('filters.ownerAll')}</option>
                  <option value={UNASSIGNED_ASSIGNEE}>{t('filters.ownerUnassigned')}</option>
                  {ownerOptions.map(u => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.display_name}
                    </option>
                  ))}
                </select>
              </div>

              {FUNNEL_PROBABILITY_RANGE_RPC_ENABLED && (
                <div className="sm:col-span-2">
                  <ProbabilityRangeFilter
                    minText={probabilityMinText}
                    maxText={probabilityMaxText}
                    error={probabilityDraftError}
                    applied={appliedProbability}
                    onMinChange={(value) => {
                      setProbabilityMinText(value)
                      setProbabilityDraftError(null)
                    }}
                    onMaxChange={(value) => {
                      setProbabilityMaxText(value)
                      setProbabilityDraftError(null)
                    }}
                    onApply={() => {
                      const committed = commitProbabilityDraft(
                        appliedProbability,
                        probabilityMinText,
                        probabilityMaxText,
                      )
                      if (committed.status === 'invalid_number') {
                        setProbabilityDraftError(t('filters.probabilityInvalidNumber'))
                        return
                      }
                      if (committed.status === 'out_of_range') {
                        setProbabilityDraftError(t('filters.probabilityOutOfRange'))
                        return
                      }
                      if (committed.status === 'min_gt_max') {
                        setProbabilityDraftError(t('filters.probabilityMinGtMax'))
                        return
                      }
                      applyProbabilityRange(committed.applied)
                    }}
                    onPreset={applyProbabilityRange}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:flex-wrap">
              <div className="inline-flex rounded-lg border border-gray-300 bg-white overflow-hidden">
                {([
                  { value: 'created_at' as DateField, label: t('filters.dateFieldCreated') },
                  { value: 'closed_at' as DateField, label: t('filters.dateFieldClosed') },
                  { value: 'last_contact_at' as DateField, label: t('filters.dateFieldLastContact') },
                ]).map((opt, index) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedDateField(opt.value)}
                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      index > 0 ? 'border-l border-gray-300' : ''
                    } ${
                      selectedDateField === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-56 sm:flex-shrink-0">
                <PeriodFilter
                  selectedPeriod={selectedPeriod ?? allPeriodDisplay}
                  onPeriodChange={handlePeriodChange}
                  showAll
                  className="flex-1"
                />
                {selectedPeriod !== null && (
                  <button
                    type="button"
                    onClick={() => setSelectedPeriod(null)}
                    className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                    title={t('filters.periodAll')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {showCycleFilter && (
                <div className="flex items-center gap-1 flex-wrap">
                  {([
                    { value: null, label: t('contactCycle.filterAll') },
                    { value: 'cycle_open' as ContactAttemptsState, label: t('contactCycle.filterCycleOpen') },
                    { value: 'waiting' as ContactAttemptsState, label: t('contactCycle.filterWaiting') },
                    { value: 'eligible' as ContactAttemptsState, label: t('contactCycle.filterEligible') },
                  ]).map(opt => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setSelectedCycleState(opt.value)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        selectedCycleState === opt.value
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1 flex-wrap">
                {([
                  { value: undefined, label: t('filters.sortDefault') },
                  { value: 'entered_stage_at' as SortOption, label: t('filters.sortEnteredStage') },
                  { value: 'entered_funnel_at' as SortOption, label: t('filters.sortEnteredFunnel') },
                  { value: 'lead_created_at' as SortOption, label: t('filters.sortLeadCreated') },
                  { value: 'last_interaction_at' as SortOption, label: t('filters.sortLastInteraction') },
                ]).map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setGlobalSort(opt.value)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      globalSort === opt.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedPeriod !== null && selectedDateField === 'closed_at' && (
              <p className="text-xs text-amber-700">{t('filters.closedAtHint')}</p>
            )}
            {selectedPeriod !== null && selectedDateField === 'last_contact_at' && (
              <p className="text-xs text-amber-700">{t('filters.lastContactHint')}</p>
            )}
          </div>
        )}
      </div>

      {/* Board Kanban ou Lista */}
      <div className="flex-1 overflow-hidden p-6">
        {selectedFunnel ? (
          viewMode === 'list' ? (
            <FunnelListView
              funnelId={selectedFunnel.id}
              funnelName={selectedFunnel.name}
              onLeadClick={handleLeadClick}
              searchTerm={debouncedSearch}
              selectedOrigin={selectedOrigin}
              selectedPeriod={selectedPeriod}
              selectedDateField={selectedDateField}
              selectedTags={selectedTags}
              selectedTagsMode={selectedTagsMode}
              globalSort={globalSort}
              selectedOwner={selectedOwner || undefined}
              selectedCycleState={selectedCycleState}
              showCycleColumn={showCycleFilter}
              visibleFields={visibleFields}
              customFields={customFields}
              probabilityMin={effectiveProbability.min}
              probabilityMax={effectiveProbability.max}
            />
          ) : (
            <FunnelBoard
              funnelId={selectedFunnel.id}
              funnelName={selectedFunnel.name}
              funnelRequireWonItems={selectedFunnel.require_won_items ?? false}
              funnelRequireWonSaleType={selectedFunnel.require_won_sale_type ?? false}
              funnelRequireLostLossType={selectedFunnel.require_lost_loss_type ?? false}
              onLeadClick={handleLeadClick}
              visibleFields={visibleFields}
              searchTerm={debouncedSearch}
              selectedOrigin={selectedOrigin}
              selectedPeriod={selectedPeriod}
              selectedDateField={selectedDateField}
              selectedTags={selectedTags}
              selectedTagsMode={selectedTagsMode}
              globalSort={globalSort}
              selectedOwner={selectedOwner || undefined}
              selectedCycleState={selectedCycleState}
              probabilityMin={effectiveProbability.min}
              probabilityMax={effectiveProbability.max}
            />
          )
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Filter className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t('states.selectFunnelTitle')}
              </h3>
              <p className="text-gray-600 mb-4">
                {t('states.selectFunnelDescription')}
              </p>
              {funnels.length === 0 && (
                <button
                  onClick={isAtFunnelLimit ? undefined : handleCreateFunnel}
                  disabled={isAtFunnelLimit}
                  title={isAtFunnelLimit ? 'Limite do plano atingido. Faça upgrade ou remova funis existentes.' : undefined}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('states.createFirstFunnel')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modais */}
      <CreateFunnelWizard
        isOpen={showCreateFunnelModal}
        onClose={() => setShowCreateFunnelModal(false)}
        onSubmit={handleSubmitFunnel}
      />

      <LeadCardCustomizer
        isOpen={showCardCustomizer}
        onClose={() => setShowCardCustomizer(false)}
        onSubmit={handleUpdateCardPreferences}
        currentVisibleFields={visibleFields}
        availableCustomFields={customFields}
      />

      {selectedFunnel && (
        <EditFunnelModal
          isOpen={showEditFunnelModal}
          onClose={() => {
            setShowEditFunnelModal(false)
            refreshFunnels()
          }}
          funnel={selectedFunnel}
          onUpdate={refreshFunnels}
          onDelete={deleteFunnel}
        />
      )}

      {/* Modal de Chat */}
      {selectedLeadId && user && companyId && (
        <ChatModalSimple
          leadId={selectedLeadId}
          companyId={companyId}
          userId={user.id}
          isOpen={showChatModal}
          onClose={() => {
            setShowChatModal(false)
            setSelectedLeadId(null)
          }}
        />
      )}
    </div>
  )
}
