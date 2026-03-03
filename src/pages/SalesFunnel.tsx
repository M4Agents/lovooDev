// =====================================================
// PÁGINA: SalesFunnel
// Data: 03/03/2026
// Objetivo: Página principal do funil de vendas
// =====================================================

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Filter, Download, Plus, Sliders } from 'lucide-react'
import { FunnelBoard } from '../components/SalesFunnel/FunnelBoard'
import { FunnelSelector } from '../components/SalesFunnel/FunnelSelector'
import { CreateFunnelModal } from '../components/SalesFunnel/CreateFunnelModal'
import { LeadCardCustomizer } from '../components/SalesFunnel/LeadCardCustomizer'
import { useFunnels } from '../hooks/useFunnels'
import { useAuth } from '../contexts/AuthContext'
import { funnelApi } from '../services/funnelApi'
import type { CreateFunnelForm } from '../types/sales-funnel'
import { FUNNEL_CONSTANTS } from '../types/sales-funnel'

export default function SalesFunnel() {
  const navigate = useNavigate()
  const { user, company } = useAuth()
  const companyId = company?.id

  const {
    funnels,
    loading,
    error,
    selectedFunnel,
    setSelectedFunnel,
    createFunnel,
    refreshFunnels
  } = useFunnels(companyId || '')

  const [showFilters, setShowFilters] = useState(false)
  const [showCreateFunnelModal, setShowCreateFunnelModal] = useState(false)
  const [showCardCustomizer, setShowCardCustomizer] = useState(false)
  const [visibleFields, setVisibleFields] = useState<string[]>([...FUNNEL_CONSTANTS.DEFAULT_VISIBLE_FIELDS])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [selectedOrigin, setSelectedOrigin] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState('')

  // Carregar preferências salvas ao montar componente
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
  }, [companyId])

  const handleLeadClick = (leadId: number) => {
    navigate(`/chat?leadId=${leadId}`)
  }

  const handleCreateFunnel = () => {
    setShowCreateFunnelModal(true)
  }

  const handleSubmitFunnel = async (data: CreateFunnelForm) => {
    if (!companyId) return
    await createFunnel(data)
    await refreshFunnels()
  }

  const handleUpdateCardPreferences = async (fields: string[]) => {
    if (!companyId) return
    try {
      setVisibleFields(fields)
      await funnelApi.updateCardPreferences(companyId, fields)
    } catch (error) {
      console.error('Error saving preferences:', error)
      alert('Erro ao salvar preferências. Tente novamente.')
    }
  }

  const handleExport = async () => {
    if (!selectedFunnel || !companyId) {
      alert('Selecione um funil para exportar')
      return
    }

    try {
      // Buscar todas as posições do funil
      const positions = await funnelApi.getLeadPositions(selectedFunnel.id)
      
      if (!positions || positions.length === 0) {
        alert('Nenhum lead encontrado neste funil')
        return
      }

      // Buscar etapas para mapear nomes
      const stages = await funnelApi.getStages(selectedFunnel.id)
      const stageMap = new Map(stages.map((s: any) => [s.id, s.name]))

      // Preparar dados CSV
      const csvHeaders = [
        'Nome',
        'Email',
        'Telefone',
        'Empresa',
        'Etapa Atual',
        'Valor do Negócio',
        'Origem',
        'Data de Entrada',
        'Dias na Etapa'
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
          new Date(pos.entered_stage_at).toLocaleDateString('pt-BR'),
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
      alert('Erro ao exportar dados. Tente novamente.')
    }
  }

  // Removido: botão de configurações - usuário cria funis direto nesta página

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-gray-600">Empresa não encontrada</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-600">Carregando funis...</p>
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
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900">
              Funil de Vendas
            </h1>
            
            <FunnelSelector
              funnels={funnels}
              selectedFunnel={selectedFunnel}
              onSelectFunnel={setSelectedFunnel}
              onCreateFunnel={handleCreateFunnel}
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
              <span className="text-sm font-medium">Filtros</span>
            </button>

            <button
              onClick={() => setShowCardCustomizer(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              title="Personalizar campos dos cards"
            >
              <Sliders className="w-4 h-4" />
              <span className="text-sm font-medium">Personalizar</span>
            </button>

            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm font-medium">Exportar</span>
            </button>

            <button
              onClick={() => navigate('/leads?action=create')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">Novo Lead</span>
            </button>
          </div>
        </div>

        {/* Filtros (quando ativo) */}
        {showFilters && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Buscar
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Nome, email, telefone..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tags
                </label>
                <select 
                  value={selectedTag}
                  onChange={(e) => setSelectedTag(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Todas as tags</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Origem
                </label>
                <select 
                  value={selectedOrigin}
                  onChange={(e) => setSelectedOrigin(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Todas as origens</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="site">Site</option>
                  <option value="indicacao">Indicação</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Período
                </label>
                <select 
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Todo período</option>
                  <option value="today">Hoje</option>
                  <option value="week">Esta semana</option>
                  <option value="month">Este mês</option>
                </select>
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
            onLeadClick={handleLeadClick}
            visibleFields={visibleFields}
            searchTerm={searchTerm}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Filter className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Selecione um funil
              </h3>
              <p className="text-gray-600 mb-4">
                Escolha um funil de vendas para visualizar os leads
              </p>
              {funnels.length === 0 && (
                <button
                  onClick={handleCreateFunnel}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Criar primeiro funil
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modais */}
      <CreateFunnelModal
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
    </div>
  )
}
