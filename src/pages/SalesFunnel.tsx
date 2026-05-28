// =====================================================
// PÁGINA: SalesFunnel
// Data: 03/03/2026
// Objetivo: Página principal do funil de vendas
// =====================================================

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounce } from '../hooks/useDebounce'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Filter, Download, Plus, Sliders, MoreVertical, Edit2, X, Tag as TagIcon, Calendar, ChevronDown } from 'lucide-react'
import { FunnelBoard } from '../components/SalesFunnel/FunnelBoard'
import { FunnelSelector } from '../components/SalesFunnel/FunnelSelector'
import { CreateFunnelWizard } from '../components/SalesFunnel/CreateFunnelWizard'
import { EditFunnelModal } from '../components/SalesFunnel/EditFunnelModal'
import { LeadCardCustomizer } from '../components/SalesFunnel/LeadCardCustomizer'
import ChatModalSimple from '../components/SalesFunnel/ChatModalSimple'
import { PeriodFilter } from '../components/PeriodFilter'
import { useFunnels } from '../hooks/useFunnels'
import { useAuth } from '../contexts/AuthContext'
import { useAvailableTags } from '../hooks/useAvailableTags'
import { funnelApi } from '../services/funnelApi'
import type { CreateFunnelForm, FunnelStage } from '../types/sales-funnel'
import { FUNNEL_CONSTANTS } from '../types/sales-funnel'
import type { PeriodFilter as PeriodFilterType } from '../types/analytics'
import { PREDEFINED_PERIODS } from '../types/analytics'

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
  } = useFunnels(companyId || '')

  const [showFilters, setShowFilters] = useState(false)
  const [showCreateFunnelModal, setShowCreateFunnelModal] = useState(false)
  const [showEditFunnelModal, setShowEditFunnelModal] = useState(false)
  const [showCardCustomizer, setShowCardCustomizer] = useState(false)
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  const [showChatModal, setShowChatModal] = useState(false)
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null)
  const [visibleFields, setVisibleFields] = useState<string[]>([...FUNNEL_CONSTANTS.DEFAULT_VISIBLE_FIELDS])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedTagsMode, setSelectedTagsMode] = useState<'or' | 'and'>('or')
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const [selectedOrigin, setSelectedOrigin] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilterType | null>(null)

  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const { tags: availableTags } = useAvailableTags(companyId)

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
        console.log('📊 Preferências carregadas:', preferences)
        if (preferences && preferences.visible_fields && preferences.visible_fields.length > 0) {
          console.log('✅ Aplicando preferências:', preferences.visible_fields)
          setVisibleFields(preferences.visible_fields)
        } else {
          console.log('⚠️ Nenhuma preferência salva, usando padrão')
        }
      } catch (error) {
        console.error('Error loading preferences:', error)
      }
    }
    loadPreferences()
  }, [companyId, selectedFunnel])

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
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg transition-colors
                ${showFilters 
                  ? 'bg-blue-100 text-blue-700 border border-blue-300' 
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }
              `}
            >
              <Filter className="w-4 h-4" />
              <span className="text-sm font-medium">{t('actions.filters')}</span>
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

        {/* Filtros (quando ativo) */}
        {showFilters && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('filters.searchLabel')}
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t('filters.searchPlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">
                    {t('filters.tagsLabel')}
                  </label>
                  {selectedTags.length > 1 && (
                    <div className="flex rounded border border-gray-300 overflow-hidden text-xs">
                      <button
                        onClick={() => setSelectedTagsMode('or')}
                        className={`px-2 py-0.5 transition-colors ${selectedTagsMode === 'or' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        title="Qualquer tag selecionada"
                      >
                        Qualquer
                      </button>
                      <button
                        onClick={() => setSelectedTagsMode('and')}
                        className={`px-2 py-0.5 border-l border-gray-300 transition-colors ${selectedTagsMode === 'and' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        title="Todas as tags selecionadas"
                      >
                        Todas
                      </button>
                    </div>
                  )}
                </div>

                {/* Chips das tags selecionadas */}
                <div className="flex flex-wrap items-center gap-1 min-h-[38px] px-2 py-1.5 border border-gray-300 rounded-lg bg-white">
                  {selectedTags.map(tagId => {
                    const tag = availableTags.find(t => t.id === tagId)
                    if (!tag) return null
                    return (
                      <span
                        key={tagId}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: `${tag.color}22`, color: tag.color, border: `1px solid ${tag.color}66` }}
                      >
                        {tag.name}
                        <button
                          onClick={() => removeTag(tagId)}
                          className="hover:opacity-70 transition-opacity"
                          title={`Remover ${tag.name}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )
                  })}

                  {/* Botão para abrir dropdown de seleção */}
                  {availableTags.some(t => !selectedTags.includes(t.id)) && (
                    <div className="relative" ref={tagDropdownRef}>
                      <button
                        onClick={() => setTagDropdownOpen(prev => !prev)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs border border-dashed border-gray-300 rounded-full text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
                      >
                        <TagIcon className="w-3 h-3" />
                        {selectedTags.length === 0 ? 'Filtrar por tag' : 'Adicionar'}
                      </button>

                      {tagDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px] max-h-48 overflow-y-auto">
                          {availableTags
                            .filter(t => !selectedTags.includes(t.id))
                            .map(tag => (
                              <button
                                key={tag.id}
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

                  {selectedTags.length === 0 && availableTags.length === 0 && (
                    <span className="text-xs text-gray-400">Nenhuma tag cadastrada</span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('filters.originLabel')}
                </label>
                <select 
                  value={selectedOrigin}
                  onChange={(e) => setSelectedOrigin(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{t('filters.originAll')}</option>
                  <option value="whatsapp">{t('filters.originWhatsapp')}</option>
                  <option value="site">{t('filters.originSite')}</option>
                  <option value="indicacao">{t('filters.originReferral')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('filters.periodLabel')}
                </label>
                <div className="flex items-center gap-2">
                  {selectedPeriod === null ? (
                    <button
                      type="button"
                      onClick={() => setSelectedPeriod({ ...PREDEFINED_PERIODS['30days'], startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate: new Date(new Date().setHours(23, 59, 59, 999)) })}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors w-full"
                    >
                      <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-700">{t('filters.periodAll')}</span>
                      <ChevronDown className="w-4 h-4 text-gray-500 ml-auto" />
                    </button>
                  ) : (
                    <>
                      <PeriodFilter
                        selectedPeriod={selectedPeriod}
                        onPeriodChange={setSelectedPeriod}
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedPeriod(null)}
                        className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                        title={t('filters.periodAll')}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Board Kanban */}
      <div className="flex-1 overflow-hidden p-6">
        {selectedFunnel ? (
          <FunnelBoard
            funnelId={selectedFunnel.id}
            funnelName={selectedFunnel.name}
            onLeadClick={handleLeadClick}
            visibleFields={visibleFields}
            searchTerm={debouncedSearch}
            selectedOrigin={selectedOrigin}
            selectedPeriod={selectedPeriod}
            selectedTags={selectedTags}
            selectedTagsMode={selectedTagsMode}
          />
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
