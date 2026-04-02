// =====================================================
// COMPONENTE: OpportunitiesSection (Compacto)
// Data: 04/03/2026
// Objetivo: Seção de oportunidades dentro da aba Informações
// =====================================================

import { useState, useEffect } from 'react'
import { Briefcase, Plus, DollarSign, TrendingUp, Target, MapPin, Trash2, Pencil } from 'lucide-react'
import { useOpportunities } from '../../../hooks/useOpportunities'
import { CreateOpportunityModal } from '../../SalesFunnel/CreateOpportunityModal'
import { formatCurrency } from '../../../types/sales-funnel'
import type { SalesFunnel, FunnelStage, OpportunityFunnelPosition } from '../../../types/sales-funnel'
import { supabase } from '../../../lib/supabase'
import { funnelApi } from '../../../services/funnelApi'
import { triggerManager } from '../../../services/automation/TriggerManager'
import toast from 'react-hot-toast'

interface OpportunitiesSectionProps {
  leadId?: number | null  // ✅ NOVO: lead_id da conversa (à prova de migração WhatsApp username)
  phoneNumber: string
  leadName: string
  companyId: string
  conversationId?: string  // ID da conversa para passar ao trigger
}

export const OpportunitiesSection: React.FC<OpportunitiesSectionProps> = ({
  leadId: propLeadId,  // ✅ NOVO: receber lead_id diretamente
  phoneNumber,
  leadName,
  companyId,
  conversationId
}) => {
  console.log('💼 OpportunitiesSection - Rendered with:', { propLeadId, phoneNumber })
  
  const [leadId, setLeadId] = useState<number | null>(propLeadId || null)
  const [loadingLeadId, setLoadingLeadId] = useState(!propLeadId)
  
  // Estados para funis e etapas
  const [funnels, setFunnels] = useState<SalesFunnel[]>([])
  const [stagesByFunnel, setStagesByFunnel] = useState<Record<string, FunnelStage[]>>({})
  const [positions, setPositions] = useState<Record<string, OpportunityFunnelPosition>>({})
  const [loadingFunnels, setLoadingFunnels] = useState(false)
  const [updatingPosition, setUpdatingPosition] = useState<string | null>(null)
  const [deletingOpportunity, setDeletingOpportunity] = useState<string | null>(null)
  
  // Buscar lead_id a partir do telefone (ou criar se não existir)
  // ✅ NOVO: Se lead_id foi passado como prop, usar diretamente (à prova de migração WhatsApp)
  useEffect(() => {
    // Se lead_id foi passado como prop, usar diretamente
    if (propLeadId) {
      console.log('✅ OpportunitiesSection - lead_id recebido via prop (conversation.lead_id):', propLeadId)
      console.log('🎯 Sistema preparado para migração WhatsApp username - não depende de telefone')
      setLeadId(propLeadId)
      setLoadingLeadId(false)
      return
    }
    
    // Fallback: buscar por telefone (será removido após migração WhatsApp para username)
    const fetchOrCreateLead = async () => {
      try {
        setLoadingLeadId(true)
        console.log('⚠️ OpportunitiesSection - FALLBACK: Buscando lead_id por telefone:', phoneNumber)
        console.log('⚠️ Este método será descontinuado após migração WhatsApp para username')
        
        // Tentar buscar lead existente
        const { data: existingLead, error: searchError } = await supabase
          .from('leads')
          .select('id')
          .eq('company_id', companyId)
          .eq('phone', phoneNumber)
          .maybeSingle()
        
        if (existingLead) {
          console.log('✅ OpportunitiesSection - Lead encontrado, ID:', existingLead.id)
          setLeadId(existingLead.id)
          return
        }
        
        // Se não encontrou, criar novo lead
        console.log('📝 OpportunitiesSection - Lead não encontrado, criando novo...')
        const { data: newLead, error: createError } = await supabase
          .from('leads')
          .insert({
            company_id: companyId,
            phone: phoneNumber,
            name: leadName || phoneNumber,
            lead_status: 'new',
            lead_source: 'chat'
          })
          .select('id')
          .single()
        
        if (createError) {
          console.error('❌ OpportunitiesSection - Erro ao criar lead:', createError)
          setLeadId(null)
        } else if (newLead) {
          console.log('✅ OpportunitiesSection - Lead criado com sucesso, ID:', newLead.id)
          setLeadId(newLead.id)
        }
      } catch (err) {
        console.error('❌ OpportunitiesSection - Erro:', err)
        setLeadId(null)
      } finally {
        setLoadingLeadId(false)
      }
    }
    
    if (phoneNumber && companyId) {
      fetchOrCreateLead()
    }
  }, [propLeadId, phoneNumber, companyId, leadName])
  
  const { opportunities, loading, refreshOpportunities } = useOpportunities(leadId || 0)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingOpportunity, setEditingOpportunity] = useState<any>(null)

  // Buscar funis e posições das oportunidades
  useEffect(() => {
    const fetchFunnelsAndPositions = async () => {
      if (!companyId || opportunities.length === 0) return
      
      try {
        setLoadingFunnels(true)
        
        // Buscar funis da empresa
        const funnelsData = await funnelApi.getFunnels(companyId)
        setFunnels(funnelsData)
        
        // Buscar etapas de cada funil
        const stagesData: Record<string, FunnelStage[]> = {}
        for (const funnel of funnelsData) {
          const stages = await funnelApi.getStages(funnel.id)
          stagesData[funnel.id] = stages
        }
        setStagesByFunnel(stagesData)
        
        // Buscar posições das oportunidades
        const positionsData: Record<string, OpportunityFunnelPosition> = {}
        for (const opp of opportunities) {
          const { data } = await supabase
            .from('opportunity_funnel_positions')
            .select('*')
            .eq('opportunity_id', opp.id)
            .single()
          
          if (data) {
            positionsData[opp.id] = data
          }
        }
        setPositions(positionsData)
        
      } catch (error) {
        console.error('Erro ao buscar funis:', error)
      } finally {
        setLoadingFunnels(false)
      }
    }
    
    fetchFunnelsAndPositions()
  }, [companyId, opportunities])

  // Filtrar apenas oportunidades abertas
  const activeOpportunities = opportunities.filter(opp => opp.status === 'open')

  // Função para abrir modal de edição
  const handleEditOpportunity = (opportunity: any) => {
    setEditingOpportunity(opportunity)
    setShowEditModal(true)
  }

  // Função para excluir oportunidade
  const handleDeleteOpportunity = async (opportunityId: string, opportunityTitle: string) => {
    const confirmed = window.confirm(
      `Tem certeza que deseja excluir a oportunidade "${opportunityTitle}"?\n\nEsta ação não pode ser desfeita.`
    )
    
    if (!confirmed) return
    
    try {
      setDeletingOpportunity(opportunityId)
      
      console.log('🗑️ OpportunitiesSection - Excluindo oportunidade:', opportunityId)
      
      // Remover da posição do funil primeiro (se existir)
      if (positions[opportunityId]) {
        await funnelApi.removeOpportunityFromFunnel(opportunityId, positions[opportunityId].funnel_id)
      }
      
      // Excluir a oportunidade
      const { error } = await supabase
        .from('opportunities')
        .delete()
        .eq('id', opportunityId)
      
      if (error) throw error
      
      console.log('✅ OpportunitiesSection - Oportunidade excluída com sucesso')
      
      // Atualizar lista
      refreshOpportunities()
      
    } catch (error) {
      console.error('❌ OpportunitiesSection - Erro ao excluir oportunidade:', error)
      alert('Erro ao excluir oportunidade. Tente novamente.')
    } finally {
      setDeletingOpportunity(null)
    }
  }

  // Função para atualizar posição da oportunidade
  const handleUpdatePosition = async (
    opportunityId: string,
    newFunnelId: string,
    newStageId: string
  ) => {
    try {
      setUpdatingPosition(opportunityId)
      
      const currentPosition = positions[opportunityId]
      const oldStageId = currentPosition?.stage_id
      
      // Se mudou de funil, precisa remover do antigo e adicionar no novo
      if (currentPosition && currentPosition.funnel_id !== newFunnelId) {
        // Remover do funil antigo
        await funnelApi.removeOpportunityFromFunnel(opportunityId, currentPosition.funnel_id)
        
        // Adicionar no novo funil
        await funnelApi.addOpportunityToFunnel(opportunityId, newFunnelId, newStageId, leadId || undefined)
      } else if (currentPosition) {
        // Apenas mudou de etapa no mesmo funil
        await funnelApi.moveOpportunityToStage({
          opportunity_id: opportunityId,
          funnel_id: newFunnelId,
          from_stage_id: currentPosition.stage_id,
          to_stage_id: newStageId,
          position_in_stage: 0
        })
        
        // Disparar trigger de automação se mudou de etapa
        if (oldStageId && oldStageId !== newStageId) {
          try {
            // Buscar dados completos da oportunidade
            const { data: opportunity } = await supabase
              .from('opportunities')
              .select('*')
              .eq('id', opportunityId)
              .single()
            
            // Tentar buscar dados do lead (pode falhar por RLS)
            const { data: lead, error: leadError } = await supabase
              .from('leads')
              .select('phone, name, email, company, city, state')
              .eq('id', leadId)
              .single()
            
            let leadData: any = null
            if (leadError || !lead) {
              console.warn('⚠️ Não foi possível buscar dados do lead, usando dados disponíveis do componente:', leadError?.message)
              // Usar dados disponíveis do componente
              leadData = {
                phone: phoneNumber,
                name: leadName,
                email: null,
                company: null,
                city: null,
                state: null
              }
            } else {
              leadData = lead
            }
            
            console.log('🔔 Disparando trigger de automação:', {
              opportunityId,
              oldStage: oldStageId,
              newStage: newStageId,
              funnel: newFunnelId
            })
            
            // Disparar trigger de automação
            await triggerManager.onOpportunityStageChanged(
              companyId,
              opportunityId,
              oldStageId,
              newStageId,
              {
                ...opportunity,
                funnel_id: newFunnelId,
                lead_id: leadId,
                lead: leadData,  // Incluir dados do lead no triggerData
                conversation_id: conversationId  // Incluir conversationId para envio eficiente
              }
            )
          } catch (automationError) {
            console.error('❌ Erro ao disparar automação:', automationError)
            // Não bloquear movimentação se automação falhar
          }
        }
      } else {
        // Primeira vez adicionando ao funil
        await funnelApi.addOpportunityToFunnel(opportunityId, newFunnelId, newStageId, leadId || undefined)
      }
      
      // Atualizar estado local
      const { data } = await supabase
        .from('opportunity_funnel_positions')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .single()
      
      if (data) {
        setPositions(prev => ({ ...prev, [opportunityId]: data }))
      }
      
    } catch (error) {
      console.error('Erro ao atualizar posição:', error)
      alert('Erro ao atualizar posição da oportunidade')
    } finally {
      setUpdatingPosition(null)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-700'
      case 'won': return 'bg-green-100 text-green-700'
      case 'lost': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'open': return 'Aberta'
      case 'won':  return 'Ganha'
      case 'lost': return 'Perdida'
      default:     return status
    }
  }

  if (loadingLeadId || loading) {
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-gray-900">Oportunidades</h3>
          </div>
        </div>
        <div className="text-center py-4">
          <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-purple-600" />
          <h3 className="text-sm font-semibold text-gray-900">Oportunidades</h3>
          {activeOpportunities.length > 0 && (
            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
              {activeOpportunities.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Nova
        </button>
      </div>

      {/* Lista de Oportunidades */}
      {activeOpportunities.length === 0 ? (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
          <Briefcase className="w-8 h-8 text-purple-400 mx-auto mb-2" />
          <p className="text-xs text-purple-600 mb-2">Nenhuma oportunidade ativa</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-xs text-purple-700 hover:text-purple-800 font-medium"
          >
            Criar primeira oportunidade
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {activeOpportunities.map((opportunity) => (
            <div
              key={opportunity.id}
              className="bg-white border border-gray-200 rounded-lg p-3 hover:border-purple-300 transition-colors"
            >
              {/* Título e Status */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-900 truncate">
                    {opportunity.title}
                  </h4>
                  {opportunity.description && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {opportunity.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(opportunity.status)}`}>
                    {getStatusLabel(opportunity.status)}
                  </span>
                  <button
                    onClick={() => handleEditOpportunity(opportunity)}
                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="Editar oportunidade"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteOpportunity(opportunity.id, opportunity.title)}
                    disabled={deletingOpportunity === opportunity.id}
                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Excluir oportunidade"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Informações Compactas */}
              <div className="flex items-center gap-4 text-xs">
                {/* Valor */}
                {opportunity.value > 0 && (
                  <div className="flex items-center gap-1 text-green-600">
                    <DollarSign className="w-3 h-3" />
                    <span className="font-semibold">{formatCurrency(opportunity.value)}</span>
                  </div>
                )}

                {/* Probabilidade */}
                <div className="flex items-center gap-1 text-blue-600">
                  <TrendingUp className="w-3 h-3" />
                  <span className="font-medium">{opportunity.probability}%</span>
                </div>

                {/* Data Prevista */}
                {opportunity.expected_close_date && (
                  <div className="text-gray-500">
                    Prev: {new Date(opportunity.expected_close_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </div>
                )}
              </div>

              {/* Seletores de Funil e Etapa */}
              {!loadingFunnels && funnels.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                  {/* Seletor de Funil */}
                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
                      <Target className="w-3 h-3" />
                      Funil
                    </label>
                    <select
                      value={positions[opportunity.id]?.funnel_id || ''}
                      onChange={(e) => {
                        const newFunnelId = e.target.value
                        const firstStage = stagesByFunnel[newFunnelId]?.[0]
                        if (firstStage) {
                          handleUpdatePosition(opportunity.id, newFunnelId, firstStage.id)
                        }
                      }}
                      disabled={updatingPosition === opportunity.id}
                      className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">Selecione um funil</option>
                      {funnels.map(funnel => (
                        <option key={funnel.id} value={funnel.id}>
                          {funnel.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Seletor de Etapa */}
                  {positions[opportunity.id]?.funnel_id && stagesByFunnel[positions[opportunity.id].funnel_id] && (
                    <div>
                      <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
                        <MapPin className="w-3 h-3" />
                        Etapa
                      </label>
                      <select
                        value={positions[opportunity.id]?.stage_id || ''}
                        onChange={(e) => {
                          const newStageId = e.target.value
                          const funnelId = positions[opportunity.id].funnel_id
                          handleUpdatePosition(opportunity.id, funnelId, newStageId)
                        }}
                        disabled={updatingPosition === opportunity.id}
                        className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-purple-500 focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Selecione uma etapa</option>
                        {stagesByFunnel[positions[opportunity.id].funnel_id]?.map(stage => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Indicador de loading */}
                  {updatingPosition === opportunity.id && (
                    <div className="flex items-center gap-2 text-xs text-purple-600">
                      <div className="w-3 h-3 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                      Atualizando...
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Link para ver todas */}
          {opportunities.length > 3 && (
            <button
              className="w-full text-xs text-purple-600 hover:text-purple-700 font-medium py-2"
            >
              Ver todas ({opportunities.length})
            </button>
          )}
        </div>
      )}

      {/* Modal de Criação */}
      {leadId && (
        <CreateOpportunityModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          leadId={leadId}
          leadName={leadName}
          onSuccess={() => {
            refreshOpportunities()
            setShowCreateModal(false)
          }}
        />
      )}

      {/* Modal de Edição */}
      {leadId && editingOpportunity && (
        <CreateOpportunityModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false)
            setEditingOpportunity(null)
          }}
          leadId={leadId}
          leadName={leadName}
          opportunityData={editingOpportunity}
          onSuccess={() => {
            refreshOpportunities()
            setShowEditModal(false)
            setEditingOpportunity(null)
          }}
        />
      )}
    </div>
  )
}
