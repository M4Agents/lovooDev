// =====================================================
// LEAD PANEL - COMPONENTE ISOLADO
// =====================================================
// Painel com informações do lead e agendamento
// NÃO MODIFICA componentes existentes

import React, { useState, useEffect, useRef } from 'react'
import { chatApi } from '../../../services/chat/chatApi'
import { LeadModal } from '../../LeadModal'
import { BibliotecaV2 } from './BibliotecaV2'
import { OpportunitiesSection } from './OpportunitiesSection'
import { InstanceSelector } from '../InstanceSelector'
import { UserSelector } from '../UserSelector'
import { supabase } from '../../../lib/supabase'
import { useLeadPermissions } from '../../../hooks/useLeadPermissions'
import { api } from '../../../services/api'
import data from '@emoji-mart/data'
// @ts-ignore - tipos de emoji-mart podem não estar instalados
import Picker from '@emoji-mart/react'
import type { 
  ChatContact, 
  ChatScheduledMessage, 
  LeadPanelProps,
  ContactInfoForm,
  ScheduleMessageForm
} from '../../../types/whatsapp-chat'

// =====================================================
// INTERFACE LEAD PARA COMPATIBILIDADE
// =====================================================

interface Lead {
  id?: number;
  name: string;
  email?: string;
  phone?: string;
  origin: string;
  status: string;
  interest?: string;
  responsible_user_id?: string;
  visitor_id?: string;
  record_type?: string;
  
  // Redes Sociais
  instagram?: string;
  linkedin?: string;
  tiktok?: string;
  
  // Informações Profissionais
  cargo?: string;
  poder_investimento?: string;
  
  // Dados Pessoais
  data_nascimento?: string;
  cep?: string;
  estado?: string;
  cidade?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  
  // Dados de Anúncios
  campanha?: string;
  conjunto_anuncio?: string;
  anuncio?: string;
  
  // Campos da empresa
  company_name?: string;
  company_cnpj?: string;
  company_razao_social?: string;
  company_nome_fantasia?: string;
  company_cep?: string;
  company_cidade?: string;
  company_estado?: string;
  company_endereco?: string;
  company_telefone?: string;
  company_email?: string;
  company_site?: string;
  lead_custom_values?: Array<{
    field_id: string;
    value: string;
    lead_custom_fields: {
      field_name: string;
      field_label: string;
      field_type: string;
    };
  }>;
}

// =====================================================
// FUNÇÃO DE CONVERSÃO CHATCONTACT -> LEAD
// =====================================================

const convertChatContactToLead = (
  contact: ChatContact | null, 
  phoneNumber: string,
  conversationData?: any
): Lead => {
  // Mapear status do chat para status do lead
  const statusMapping = {
    'new': 'novo',
    'contacted': 'contatado', 
    'qualified': 'qualificado',
    'proposal': 'proposta',
    'negotiation': 'negociacao',
    'closed': 'fechado',
    'lost': 'perdido'
  };

  return {
    id: contact?.id ? parseInt(contact.id) : undefined,
    name: contact?.name || conversationData?.contact_name || '',
    email: contact?.email || '',
    phone: phoneNumber || contact?.phone_number || '',
    origin: 'whatsapp',
    status: statusMapping[contact?.lead_status as keyof typeof statusMapping] || 'novo',
    interest: '',
    responsible_user_id: '',
    visitor_id: '',
    record_type: 'Lead',
    
    // Campos vazios para serem preenchidos no modal
    instagram: '',
    linkedin: '',
    tiktok: '',
    cargo: '',
    poder_investimento: '',
    data_nascimento: '',
    cep: '',
    estado: '',
    cidade: '',
    endereco: '',
    numero: '',
    bairro: '',
    complemento: '',
    campanha: '',
    conjunto_anuncio: '',
    anuncio: '',
    
    // Dados da empresa se disponíveis
    company_name: conversationData?.company_name || '',
    company_cnpj: '',
    company_razao_social: '',
    company_nome_fantasia: '',
    company_cep: '',
    company_cidade: '',
    company_estado: '',
    company_endereco: '',
    company_telefone: '',
    company_email: '',
    company_site: '',
    lead_custom_values: []
  };
};

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const LeadPanel: React.FC<LeadPanelProps> = ({
  conversationId,
  companyId,
  userId
}) => {
  console.log('🔥🔥🔥 LEADPANEL - VERSÃO COM BIBLIOTECA V2 - 2026-02-20 22:31 🔥🔥🔥')
  
  const [contact, setContact] = useState<ChatContact | null>(null)
  const [scheduledMessages, setScheduledMessages] = useState<ChatScheduledMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'schedule' | 'biblioteca'>('info')
  const [conversation, setConversation] = useState<any>(null)
  const [averageResponseTime, setAverageResponseTime] = useState<string>('--')
  
  console.log('📊 LeadPanel - activeTab atual:', activeTab)
  
  // Estados para o LeadModal
  const [showLeadModal, setShowLeadModal] = useState(false)
  const [leadForEdit, setLeadForEdit] = useState<Lead | null>(null)

  // =====================================================
  // BUSCAR DADOS
  // =====================================================

  // Função para calcular tempo médio de resposta
  const calculateAverageResponseTime = async (conversationId: string) => {
    try {
      const { data: messages, error } = await supabase
        .from('chat_messages')
        .select('timestamp, direction')
        .eq('conversation_id', conversationId)
        .order('timestamp', { ascending: true })
      
      if (error || !messages || messages.length < 2) {
        return '--'
      }
      
      const responseTimes: number[] = []
      
      // Calcular tempo entre mensagem inbound e próxima outbound
      for (let i = 0; i < messages.length - 1; i++) {
        if (messages[i].direction === 'inbound') {
          // Buscar próxima mensagem outbound
          for (let j = i + 1; j < messages.length; j++) {
            if (messages[j].direction === 'outbound') {
              const inboundTime = new Date(messages[i].timestamp).getTime()
              const outboundTime = new Date(messages[j].timestamp).getTime()
              const diffMs = outboundTime - inboundTime
              
              if (diffMs > 0) {
                responseTimes.push(diffMs)
              }
              break
            }
          }
        }
      }
      
      if (responseTimes.length === 0) {
        return '--'
      }
      
      // Calcular média
      const avgMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      
      // Formatar tempo
      const minutes = Math.floor(avgMs / (1000 * 60))
      const hours = Math.floor(minutes / 60)
      const days = Math.floor(hours / 24)
      
      if (days > 0) {
        return `${days}d`
      } else if (hours > 0) {
        return `${hours}h`
      } else if (minutes > 0) {
        return `${minutes}m`
      } else {
        return '<1m'
      }
    } catch (error) {
      console.error('Erro ao calcular tempo médio de resposta:', error)
      return '--'
    }
  }

  const fetchData = async () => {
    try {
      setLoading(true)
      
      // Buscar conversa para pegar telefone
      const conversations = await chatApi.getConversations(companyId, userId, { type: 'all' })
      const conv = conversations.find(c => c.id === conversationId)
      setConversation(conv)
      
      if (conv) {
        // Buscar informações do contato
        const contactData = await chatApi.getContactInfo(companyId, conv.contact_phone)
        setContact(contactData)
        
        // Calcular tempo médio de resposta
        const avgTime = await calculateAverageResponseTime(conversationId)
        setAverageResponseTime(avgTime)
        
        // Buscar mensagens agendadas
        const scheduledData = await chatApi.getScheduledMessages(companyId, conversationId)
        setScheduledMessages(scheduledData)
      }
    } catch (error) {
      console.error('Error fetching lead data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (conversationId && companyId) {
      fetchData()
    }
  }, [conversationId, companyId])

  // =====================================================
  // LOADING STATE
  // =====================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Carregando...</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex space-x-1">
          <button
            onClick={() => setActiveTab('info')}
            className={`flex-1 px-2 py-2 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'info'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Informações
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 px-2 py-2 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'schedule'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Agendar
          </button>
          <button
            onClick={() => setActiveTab('biblioteca')}
            className={`flex-1 px-2 py-2 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'biblioteca'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            📚 Biblioteca
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'info' ? (
          <ContactInfo
            contact={contact}
            conversation={conversation}
            companyId={companyId}
            onUpdate={fetchData}
            onOpenLeadModal={(leadData) => {
              setLeadForEdit(leadData)
              setShowLeadModal(true)
            }}
            averageResponseTime={averageResponseTime}
          />
        ) : activeTab === 'schedule' ? (
          conversation?.instance_id ? (
            <ScheduleMessages
              conversationId={conversationId}
              companyId={companyId}
              instanceId={conversation.instance_id}
              scheduledMessages={scheduledMessages}
              onUpdate={fetchData}
            />
          ) : (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-blue-100">
                <svg className="w-8 h-8 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <p className="text-sm text-gray-600">Carregando informações da conversa...</p>
            </div>
          )
        ) : activeTab === 'biblioteca' ? (
          <BibliotecaV2
            conversationId={conversationId}
            companyId={companyId}
            leadId={contact?.id}
          />
        ) : null}
      </div>

      {/* LeadModal */}
      {showLeadModal && (
        <LeadModal
          isOpen={showLeadModal}
          onClose={() => {
            setShowLeadModal(false)
            setLeadForEdit(null)
          }}
          lead={leadForEdit}
          onSave={() => {
            fetchData() // Recarregar dados do chat
            setShowLeadModal(false)
            setLeadForEdit(null)
          }}
        />
      )}
    </div>
  )
}

// =====================================================
// COMPONENTE INFORMAÇÕES DO CONTATO
// =====================================================

interface ContactInfoProps {
  contact: ChatContact | null
  conversation: any
  companyId: string
  onUpdate: () => void
  onOpenLeadModal: (leadData: Lead) => void
  averageResponseTime: string
}

const ContactInfo: React.FC<ContactInfoProps> = ({
  contact,
  conversation,
  companyId,
  onUpdate,
  onOpenLeadModal,
  averageResponseTime
}) => {
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState<ContactInfoForm>({
    name: '',
    email: '',
    lead_source: '',
    lead_status: 'new',
    deal_value: 0,
    notes: '',
    tags: [],
    custom_fields: {}
  })

  // Estados para seletor de instância
  const [availableInstances, setAvailableInstances] = useState<any[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('')
  const [loadingInstances, setLoadingInstances] = useState(false)
  const [changingInstance, setChangingInstance] = useState(false)

  // Estados para seletor de responsável
  const [companyUsers, setCompanyUsers] = useState<any[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [changingResponsible, setChangingResponsible] = useState(false)
  const [originalResponsibleId, setOriginalResponsibleId] = useState<string | null>(null)
  const [responsibleChangeSuccess, setResponsibleChangeSuccess] = useState(false)
  const [currentLeadId, setCurrentLeadId] = useState<number | null>(null)
  const [currentResponsibleId, setCurrentResponsibleId] = useState<string>('')
  
  // Hook de permissões
  const { canEditLead } = useLeadPermissions()

  useEffect(() => {
    if (contact) {
      setFormData({
        name: contact.name || '',
        email: contact.email || '',
        lead_source: contact.lead_source || '',
        lead_status: contact.lead_status,
        deal_value: contact.deal_value || 0,
        notes: contact.notes || '',
        tags: contact.tags || [],
        custom_fields: contact.custom_fields || {}
      })
    }
  }, [contact])

  // Carregar instâncias disponíveis
  useEffect(() => {
    const loadInstances = async () => {
      if (!companyId) return
      
      try {
        setLoadingInstances(true)
        const instances = await chatApi.getCompanyInstances(companyId)
        setAvailableInstances(instances)
        
        // Pré-selecionar instância atual da conversa
        if (conversation?.instance_id) {
          setSelectedInstanceId(conversation.instance_id)
        } else if (instances.length > 0) {
          setSelectedInstanceId(instances[0].id)
        }
      } catch (error) {
        console.error('Error loading instances:', error)
      } finally {
        setLoadingInstances(false)
      }
    }
    
    loadInstances()
  }, [companyId, conversation?.instance_id])

  // Carregar usuários da empresa
  useEffect(() => {
    const loadCompanyUsers = async () => {
      if (!companyId) return
      
      try {
        setLoadingUsers(true)
        const { data, error } = await supabase
          .rpc('get_company_users_with_details', {
            p_company_id: companyId
          })
        
        if (error) throw error
        setCompanyUsers(data || [])
      } catch (error) {
        console.error('Error loading company users:', error)
        setCompanyUsers([])
      } finally {
        setLoadingUsers(false)
      }
    }
    
    loadCompanyUsers()
  }, [companyId])

  // Buscar informações do lead atual
  useEffect(() => {
    const loadLeadInfo = async () => {
      if (!conversation?.contact_phone || !companyId) return
      
      try {
        // Normalizar telefone (remover caracteres especiais)
        const normalizedPhone = conversation.contact_phone.replace(/\D/g, '')
        
        // Buscar lead pelo telefone normalizado
        const { data: leads, error } = await supabase
          .from('leads')
          .select('id, responsible_user_id, phone')
          .eq('company_id', companyId)
          .is('deleted_at', null)
        
        if (error) throw error
        
        // Filtrar leads que tenham telefone correspondente (normalizado)
        const matchingLead = leads?.find(lead => {
          if (!lead.phone) return false
          const leadPhone = lead.phone.replace(/\D/g, '')
          return leadPhone === normalizedPhone
        })
        
        if (matchingLead) {
          setCurrentLeadId(matchingLead.id)
          setCurrentResponsibleId(matchingLead.responsible_user_id || '')
          setOriginalResponsibleId(matchingLead.responsible_user_id || null)
          console.log('✅ Lead encontrado:', matchingLead.id, 'Responsável:', matchingLead.responsible_user_id)
        } else {
          console.warn('⚠️ Lead não encontrado para telefone:', normalizedPhone)
          // Resetar estados se não encontrar lead
          setCurrentLeadId(null)
          setCurrentResponsibleId('')
          setOriginalResponsibleId(null)
        }
      } catch (error) {
        console.error('Error loading lead info:', error)
      }
    }
    
    loadLeadInfo()
  }, [conversation?.contact_phone, companyId])

  const handleSave = async () => {
    if (!conversation) return

    try {
      await chatApi.updateContactInfo(companyId, conversation.contact_phone, formData)
      setEditing(false)
      onUpdate()
    } catch (error) {
      console.error('Error updating contact:', error)
    }
  }

  // Função para trocar instância
  const handleChangeInstance = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newInstanceId = e.target.value
    
    if (!conversation?.id || !companyId) return
    
    // Se for a mesma instância, apenas atualizar estado
    if (newInstanceId === conversation.instance_id) {
      setSelectedInstanceId(newInstanceId)
      return
    }
    
    // Buscar nome da nova instância
    const newInstance = availableInstances.find(i => i.id === newInstanceId)
    if (!newInstance) return
    
    // Confirmar mudança
    const confirmed = window.confirm(
      `Deseja trocar para a instância "${newInstance.instance_name}"?\n\nPróximas mensagens serão enviadas por esta instância.`
    )
    
    if (!confirmed) {
      return
    }
    
    try {
      setChangingInstance(true)
      
      // Chamar função SQL para atualizar
      const { data, error } = await chatApi.supabase.rpc('change_conversation_instance', {
        p_conversation_id: conversation.id,
        p_new_instance_id: newInstanceId,
        p_company_id: companyId
      })
      
      if (error) throw error
      
      if (data?.success) {
        setSelectedInstanceId(newInstanceId)
        alert('✅ Instância alterada com sucesso!')
        
        // Recarregar dados
        await onUpdate()
      } else {
        throw new Error(data?.error || 'Erro ao trocar instância')
      }
    } catch (error: any) {
      console.error('Error changing instance:', error)
      alert('❌ Erro ao trocar instância: ' + (error.message || 'Erro desconhecido'))
      
      // Reverter seleção
      if (conversation?.instance_id) {
        setSelectedInstanceId(conversation.instance_id)
      }
    } finally {
      setChangingInstance(false)
    }
  }

  // Função para trocar responsável
  const handleChangeResponsible = async (newResponsibleId: string) => {
    console.log('🔵 INÍCIO handleChangeResponsible', {
      newResponsibleId,
      currentLeadId,
      companyId,
      contactPhone: conversation?.contact_phone,
      contactName: contact?.name || conversation?.contact_name
    })
    
    if (!companyId || !conversation?.contact_phone) {
      console.warn('⚠️ Dados faltando:', { companyId, contactPhone: conversation?.contact_phone })
      return
    }
    
    setChangingResponsible(true)
    setResponsibleChangeSuccess(false)
    
    try {
      // Se não tem lead, criar um novo
      if (!currentLeadId) {
        console.log('🆕 Criando novo lead para atribuir responsável...')
        
        const leadData: any = {
          company_id: companyId,
          name: contact?.name || conversation?.contact_name || 'Lead sem nome',
          phone: conversation.contact_phone,
          origin: 'whatsapp',
          status: 'novo',
          responsible_user_id: newResponsibleId || null
        }
        
        // Só adicionar email se existir (evitar constraint valid_email)
        if (contact?.email && contact.email.trim() !== '') {
          leadData.email = contact.email
        }
        
        console.log('📋 Dados do novo lead:', leadData)
        
        const newLead = await api.createLead(leadData)
        
        console.log('✅ Lead criado:', newLead)
        
        if (newLead && newLead.id) {
          setCurrentLeadId(newLead.id)
          setCurrentResponsibleId(newResponsibleId)
          setOriginalResponsibleId(newResponsibleId)
          
          console.log('✅ Lead criado e responsável atribuído:', newLead.id)
          
          // Feedback de sucesso
          setResponsibleChangeSuccess(true)
          setTimeout(() => setResponsibleChangeSuccess(false), 3000)
          
          // Recarregar dados
          console.log('🔄 Chamando onUpdate...')
          await onUpdate()
          console.log('✅ onUpdate concluído')
        }
      } else {
        // Lead já existe, apenas atualizar
        console.log('🔄 Atualizando lead existente:', currentLeadId)
        
        const leadData = { id: currentLeadId, responsible_user_id: currentResponsibleId, company_id: companyId }
        
        console.log('🔐 Verificando permissões...', leadData)
        
        if (!canEditLead(leadData)) {
          console.warn('❌ Sem permissão para editar')
          alert('Você não tem permissão para alterar o responsável deste lead')
          return
        }
        
        const updateData = {
          responsible_user_id: newResponsibleId || null,
          company_id: companyId
        }
        
        console.log('📋 Dados de atualização:', updateData)
        
        await api.updateLead(currentLeadId, updateData)
        
        console.log('✅ Lead atualizado com sucesso')
        
        // Atualizar estado local
        setCurrentResponsibleId(newResponsibleId)
        
        // Feedback de sucesso
        setResponsibleChangeSuccess(true)
        setTimeout(() => setResponsibleChangeSuccess(false), 3000)
      }
    } catch (error: any) {
      console.error('❌ ERRO DETALHADO:', {
        message: error?.message,
        stack: error?.stack,
        response: error?.response,
        data: error?.response?.data,
        error: error
      })
      alert('Erro ao atualizar responsável. Tente novamente.')
      
      // Reverter seleção
      setCurrentResponsibleId(originalResponsibleId || '')
    } finally {
      setChangingResponsible(false)
      console.log('🔵 FIM handleChangeResponsible')
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Seção de Oportunidades - Scroll Inteligente */}
      {conversation?.contact_phone && (
        <div className="flex-shrink-0 overflow-y-auto max-h-[40vh] px-4 pt-4">
          <OpportunitiesSection
            phoneNumber={conversation.contact_phone}
            leadName={contact?.name || conversation?.contact_name || 'Lead'}
            companyId={companyId}
          />
        </div>
      )}

      {/* Divisor visual */}
      {conversation?.contact_phone && (
        <div className="border-t border-gray-200 mx-4 my-4" />
      )}

      {/* Campos Fixos - Sempre Visíveis */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
        {/* Seletor de Instância de Envio - MODERNIZADO */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <img src="https://lovoocrm.com/images/wpp.png" alt="WhatsApp" className="w-4 h-4" />
            Instância de Envio
          </label>
          
          {loadingInstances ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : availableInstances.length === 0 ? (
            <div className="text-sm text-gray-500">Nenhuma instância disponível</div>
          ) : (
            <>
              <InstanceSelector
                instances={availableInstances}
                selectedInstance={selectedInstanceId}
                onSelectInstance={(id) => {
                  const event = { target: { value: id } } as React.ChangeEvent<HTMLSelectElement>
                  handleChangeInstance(event)
                }}
                showAllOption={false}
                className={changingInstance ? 'opacity-50 pointer-events-none' : ''}
              />
              
              {/* Apenas aviso se instância foi alterada */}
              {selectedInstanceId && selectedInstanceId !== conversation?.instance_id && (
                <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50/50 px-2 py-1.5 rounded">
                  <span>⚠️</span>
                  <p>Instância alterada</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Seletor de Responsável pelo Lead - MODERNIZADO */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Responsável pelo Lead
          </label>
          
          {loadingUsers ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : (
            <>
              <UserSelector
                users={companyUsers}
                selectedUser={currentResponsibleId}
                onSelectUser={(userId) => handleChangeResponsible(userId)}
                showNoneOption={true}
                disabled={changingResponsible}
                className={changingResponsible ? 'opacity-50 pointer-events-none' : ''}
              />
              
              {/* Aviso se responsável foi alterado */}
              {currentResponsibleId && currentResponsibleId !== originalResponsibleId && (
                <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50/50 px-2 py-1.5 rounded">
                  <span>⚠️</span>
                  <p>Responsável alterado</p>
                </div>
              )}
              
              {/* Feedback de sucesso */}
              {responsibleChangeSuccess && (
                <div className="flex items-start gap-2 text-xs text-green-600 bg-green-50/50 px-2 py-1.5 rounded">
                  <span>✓</span>
                  <p>Responsável atualizado com sucesso</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Botão Editar Lead - MODERNIZADO */}
        <div className="space-y-2">
          <button
            onClick={() => {
              if (contact && conversation) {
                const leadData = convertChatContactToLead(contact, conversation.contact_phone, conversation)
                onOpenLeadModal(leadData)
              }
            }}
            className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2 font-medium"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Editar Lead Completo
          </button>
        </div>

        {/* Estatísticas do Lead - MODERNIZADO */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Estatísticas do Lead
          </label>
          
          <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-xl p-4 border border-slate-200/60 shadow-sm">
            <div className="grid grid-cols-3 gap-3">
              {/* Dias no Sistema */}
              <div className="text-center">
                <div className="text-xl font-bold text-blue-600">
                  {contact?.first_contact_at || contact?.created_at
                    ? Math.floor((Date.now() - new Date(contact.first_contact_at || contact.created_at).getTime()) / (1000 * 60 * 60 * 24))
                    : 0
                  }
                </div>
                <div className="text-xs text-gray-600 mt-1 font-medium">Dias</div>
                <div className="text-[10px] text-gray-400">no sistema</div>
              </div>
              
              {/* Mensagens Trocadas */}
              <div className="text-center border-x border-slate-200">
                <div className="text-xl font-bold text-green-600">
                  {contact?.total_messages || 0}
                </div>
                <div className="text-xs text-gray-600 mt-1 font-medium">Mensagens</div>
                <div className="text-[10px] text-gray-400">trocadas</div>
              </div>
              
              {/* Tempo Médio de Resposta */}
              <div className="text-center">
                <div className="text-xl font-bold text-purple-600">
                  {averageResponseTime}
                </div>
                <div className="text-xs text-gray-600 mt-1 font-medium">Tempo</div>
                <div className="text-[10px] text-gray-400">médio resp.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE AGENDAMENTO DE MENSAGENS
// =====================================================

interface ScheduleMessagesProps {
  conversationId: string
  companyId: string
  instanceId?: string
  scheduledMessages: ChatScheduledMessage[]
  onUpdate: () => void
}

const ScheduleMessages: React.FC<ScheduleMessagesProps> = ({
  conversationId,
  companyId,
  instanceId,
  scheduledMessages,
  onUpdate
}) => {
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<ScheduleMessageForm>({
    content: '',
    message_type: 'text',
    scheduled_date: '',
    scheduled_time: '',
    timezone: 'America/Sao_Paulo',
    recurring_type: 'none',
    cancel_if_lead_replies: false,
    cancel_scope: 'next_only'
  })
  
  // Novos estados
  const [editingMessage, setEditingMessage] = useState<ChatScheduledMessage | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'sent' | 'failed' | 'cancelled'>('all')
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [messageToCancel, setMessageToCancel] = useState<ChatScheduledMessage | null>(null)
  const [mediaSource, setMediaSource] = useState<'none' | 'upload'>('none')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isScheduling, setIsScheduling] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  
  // Estados para seleção de instância
  const [availableInstances, setAvailableInstances] = useState<any[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(instanceId || '')
  const [loadingInstances, setLoadingInstances] = useState(false)
  
  // Estados para seletor de emojis
  const [isEmojiOpen, setIsEmojiOpen] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Carregar instâncias disponíveis
  useEffect(() => {
    async function loadInstances() {
      try {
        setLoadingInstances(true)
        const instances = await chatApi.getCompanyInstances(companyId)
        setAvailableInstances(instances)
        
        // Pré-selecionar instância da conversa se disponível
        if (instanceId && instances.some((i: any) => i.id === instanceId)) {
          setSelectedInstanceId(instanceId)
        } else if (instances.length > 0) {
          // Se instância da conversa não disponível, selecionar primeira
          setSelectedInstanceId(instances[0].id)
        }
      } catch (error) {
        console.error('Error loading instances:', error)
      } finally {
        setLoadingInstances(false)
      }
    }
    
    loadInstances()
  }, [companyId, instanceId])

  // Função para selecionar emoji
  const handleSelectEmoji = (emoji: string) => {
    const el = textareaRef.current
    const value = formData.content

    if (!el) {
      setFormData(prev => ({ ...prev, content: value + emoji }))
      return
    }

    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length

    const newValue = value.slice(0, start) + emoji + value.slice(end)
    setFormData(prev => ({ ...prev, content: newValue }))

    // Reposicionar cursor após o emoji
    requestAnimationFrame(() => {
      try {
        el.focus()
        const caret = start + emoji.length
        el.setSelectionRange(caret, caret)
      } catch (error) {
        console.warn('Erro ao reposicionar cursor após emoji:', error)
      }
    })
  }

  // Click outside para fechar o picker de emoji
  useEffect(() => {
    if (!isEmojiOpen) return

    function handleClickOutside(event: MouseEvent) {
      const pickerEl = emojiPickerRef.current
      if (pickerEl && !pickerEl.contains(event.target as Node)) {
        setIsEmojiOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isEmojiOpen])

  const handleSchedule = async () => {
    const hasContent = formData.content.trim()
    const hasMedia = selectedFile || formData.media_url
    
    if (!selectedInstanceId || (!hasContent && !hasMedia) || !formData.scheduled_date || !formData.scheduled_time) {
      alert('Por favor, preencha todos os campos obrigatórios e selecione uma instância')
      return
    }

    try {
      setIsScheduling(true)
      setUploadProgress(0)
      
      let mediaUrl = formData.media_url
      
      // Upload de arquivo se selecionado com callback de progresso
      if (selectedFile) {
        mediaUrl = await chatApi.uploadMedia(
          selectedFile, 
          companyId, 
          conversationId,
          (progress) => setUploadProgress(progress)
        )
      }
      
      await chatApi.scheduleMessage(
        conversationId,
        companyId,
        selectedInstanceId, // Usar instância selecionada pelo usuário
        null as any, // userId será obtido automaticamente via auth.uid()
        { ...formData, media_url: mediaUrl }
      )
      
      setShowForm(false)
      setFormData({
        content: '',
        message_type: 'text',
        scheduled_date: '',
        scheduled_time: '',
        timezone: 'America/Sao_Paulo',
        recurring_type: 'none'
      })
      setMediaSource('none')
      setSelectedFile(null)
      setUploadProgress(0)
      onUpdate()
    } catch (error) {
      console.error('Error scheduling message:', error)
      alert('Erro ao agendar mensagem')
    } finally {
      setIsScheduling(false)
      setUploadProgress(0)
    }
  }

  const handleCancelClick = (message: ChatScheduledMessage) => {
    setMessageToCancel(message)
    setShowCancelModal(true)
  }
  
  const handleConfirmCancel = async () => {
    if (!messageToCancel) return
    
    try {
      await chatApi.cancelScheduledMessage(messageToCancel.id, companyId)
      setShowCancelModal(false)
      setMessageToCancel(null)
      onUpdate()
    } catch (error) {
      console.error('Error cancelling message:', error)
    }
  }
  
  const handleEdit = (message: ChatScheduledMessage) => {
    setEditingMessage(message)
    const scheduledDate = new Date(message.scheduled_for)
    setFormData({
      content: message.content,
      message_type: message.message_type,
      media_url: message.media_url,
      scheduled_date: scheduledDate.toISOString().split('T')[0],
      scheduled_time: scheduledDate.toTimeString().slice(0, 5),
      timezone: 'America/Sao_Paulo',
      recurring_type: message.recurring_type,
      recurring_config: message.recurring_config
    })
    setShowForm(true)
  }
  
  const handleUpdate = async () => {
    if (!editingMessage || !instanceId) return
    
    try {
      const scheduledDateTime = new Date(`${formData.scheduled_date}T${formData.scheduled_time}`)
      
      const { supabase } = await import('../../../lib/supabase')
      const { error } = await supabase
        .from('chat_scheduled_messages')
        .update({
          content: formData.content,
          message_type: formData.message_type,
          media_url: formData.media_url,
          scheduled_for: scheduledDateTime.toISOString(),
          recurring_type: formData.recurring_type,
          recurring_config: formData.recurring_config || {},
          updated_at: new Date().toISOString()
        })
        .eq('id', editingMessage.id)
        .eq('company_id', companyId)
        .eq('status', 'pending')
      
      if (error) throw error
      
      setShowForm(false)
      setEditingMessage(null)
      setFormData({
        content: '',
        message_type: 'text',
        scheduled_date: '',
        scheduled_time: '',
        timezone: 'America/Sao_Paulo',
        recurring_type: 'none'
      })
      setMediaSource('none')
      setSelectedFile(null)
      onUpdate()
    } catch (error) {
      console.error('Error updating message:', error)
      alert('Erro ao atualizar mensagem')
    }
  }
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Detectar tipo automaticamente
    let messageType: 'image' | 'video' | 'audio' | 'document' = 'document'
    if (file.type.startsWith('image/')) messageType = 'image'
    else if (file.type.startsWith('video/')) messageType = 'video'
    else if (file.type.startsWith('audio/')) messageType = 'audio'
    
    const FILE_LIMITS = {
      image: 10 * 1024 * 1024,
      video: 25 * 1024 * 1024,
      audio: 25 * 1024 * 1024,
      document: 25 * 1024 * 1024
    }
    
    const limit = FILE_LIMITS[messageType]
    if (file.size > limit) {
      alert(`Arquivo muito grande! Máximo: ${limit / (1024 * 1024)}MB`)
      return
    }
    
    setSelectedFile(file)
    setFormData(prev => ({ ...prev, media_file: file, message_type: messageType }))
  }
  
  const toggleDayOfWeek = (day: number) => {
    const currentDays = formData.recurring_config?.days_of_week || []
    const newDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day]
    
    setFormData(prev => ({
      ...prev,
      recurring_config: { ...prev.recurring_config, days_of_week: newDays }
    }))
  }

  const formatDateTime = (date: Date) => {
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusColor = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      sent: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800'
    }
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'
  }
  
  const filteredMessages = scheduledMessages.filter(msg => 
    statusFilter === 'all' || msg.status === statusFilter
  )

  return (
    <div className="p-4 space-y-4">
      {/* Botão Agendar */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
      >
        {showForm ? 'Cancelar' : 'Agendar Mensagem'}
      </button>

      {/* Formulário */}
      {showForm && (
        <div className="space-y-4 p-4 border border-gray-200 rounded-lg">
          <h4 className="text-sm font-medium text-gray-700">
            {editingMessage ? '✏️ Editar Mensagem Agendada' : '📅 Agendar Nova Mensagem'}
          </h4>
          
          {/* Seleção de Instância WhatsApp */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              📱 Instância WhatsApp *
            </label>
            {loadingInstances ? (
              <div className="px-3 py-2 text-sm text-gray-500">Carregando instâncias...</div>
            ) : availableInstances.length === 0 ? (
              <div className="px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg">
                ⚠️ Nenhuma instância conectada disponível
              </div>
            ) : (
              <>
                <select
                  value={selectedInstanceId}
                  onChange={(e) => setSelectedInstanceId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="">Selecione a instância...</option>
                  {availableInstances.map((inst: any) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.instance_name}
                      {inst.phone_number ? ` (${inst.phone_number})` : ''}
                      {inst.id === instanceId ? ' - Conversa atual' : ''}
                    </option>
                  ))}
                </select>
                
                {/* Aviso quando instância diferente da conversa */}
                {selectedInstanceId && selectedInstanceId !== instanceId && (
                  <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <span className="text-yellow-600 text-lg">⚠️</span>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-yellow-800">Atenção: Instância diferente selecionada</p>
                        <p className="text-xs text-yellow-700 mt-1">
                          A mensagem será enviada de um número diferente do usado nesta conversa. 
                          O cliente pode não reconhecer o remetente.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem</label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={formData.content}
                onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Digite a mensagem..."
              />
              
              {/* Botão Emoji */}
              <button
                type="button"
                onClick={() => setIsEmojiOpen((prev) => !prev)}
                className="absolute right-2 top-2 p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                title="Adicionar emoji"
              >
                <span role="img" aria-label="Emoji" className="text-xl">
                  😊
                </span>
              </button>
              
              {/* Picker de Emoji */}
              {isEmojiOpen && (
                <div
                  ref={emojiPickerRef}
                  className="absolute bottom-full mb-2 left-0 z-50 shadow-lg"
                >
                  <Picker
                    data={data}
                    onEmojiSelect={(emoji: any) => handleSelectEmoji(emoji.native)}
                    locale="pt"
                    theme="light"
                  />
                </div>
              )}
            </div>
          </div>
          
          {/* Tipo de Mídia */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Adicionar Mídia</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setMediaSource('none')}
                className={`px-3 py-1 text-xs rounded ${mediaSource === 'none' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
              >
                Apenas Texto
              </button>
              <button
                type="button"
                onClick={() => setMediaSource('upload')}
                className={`px-3 py-1 text-xs rounded ${mediaSource === 'upload' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
              >
                📤 Upload
              </button>
            </div>
            
            {mediaSource === 'upload' && (
              <div className="space-y-2">
                <div className="text-xs text-gray-500 mb-2">
                  ℹ️ O tipo de arquivo será detectado automaticamente
                </div>
                
                <input
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                  onChange={handleFileSelect}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                
                {selectedFile && (
                  <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded text-sm">
                    <span className="text-green-700">✅ {selectedFile.name}</span>
                    <span className="text-xs text-green-600 ml-auto">({formData.message_type})</span>
                    <button onClick={() => { setSelectedFile(null); setFormData(prev => ({ ...prev, media_file: undefined, message_type: 'text' })) }} className="text-red-600 ml-2">✕</button>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Recorrência */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recorrência</label>
            <select
              value={formData.recurring_type}
              onChange={(e) => setFormData(prev => ({ ...prev, recurring_type: e.target.value as any }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="none">Não repetir</option>
              <option value="daily">Diariamente</option>
              <option value="weekly">Semanalmente</option>
              <option value="monthly">Mensalmente</option>
            </select>
            
            {formData.recurring_type === 'weekly' && (
              <div className="mt-2">
                <label className="block text-xs text-gray-600 mb-1">Dias da Semana</label>
                <div className="grid grid-cols-7 gap-1">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((day, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => toggleDayOfWeek(index)}
                      className={`px-2 py-1 text-xs rounded ${
                        formData.recurring_config?.days_of_week?.includes(index)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {formData.recurring_type === 'monthly' && (
              <div className="mt-2">
                <label className="block text-xs text-gray-600 mb-1">Dia do Mês</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={formData.recurring_config?.day_of_month || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    recurring_config: { ...prev.recurring_config, day_of_month: parseInt(e.target.value) }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="Ex: 15"
                />
              </div>
            )}
            
            {formData.recurring_type !== 'none' && (
              <div className="mt-2">
                <label className="block text-xs text-gray-600 mb-1">Repetir até (opcional)</label>
                <input
                  type="date"
                  value={formData.recurring_config?.end_date || ''}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    recurring_config: { ...prev.recurring_config, end_date: e.target.value }
                  }))}
                  min={formData.scheduled_date}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            )}
          </div>

          {/* Cancelamento Automático */}
          <div className="space-y-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.cancel_if_lead_replies || false}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  cancel_if_lead_replies: e.target.checked
                }))}
                className="w-4 h-4 text-yellow-600 border-gray-300 rounded focus:ring-yellow-500"
              />
              <span className="text-sm font-medium text-gray-700">
                🔔 Cancelar automaticamente se o lead responder
              </span>
            </label>

            {formData.cancel_if_lead_replies && (
              <div className="ml-6 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.cancel_scope === 'next_only'}
                    onChange={() => setFormData(prev => ({
                      ...prev,
                      cancel_scope: 'next_only'
                    }))}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Cancelar apenas a próxima mensagem agendada</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.cancel_scope === 'all_future'}
                    onChange={() => setFormData(prev => ({
                      ...prev,
                      cancel_scope: 'all_future'
                    }))}
                    className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-700">Cancelar TODAS as mensagens futuras agendadas</span>
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data</label>
              <input
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hora</label>
              <input
                type="time"
                value={formData.scheduled_time}
                onChange={(e) => setFormData(prev => ({ ...prev, scheduled_time: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Barra de progresso durante upload */}
          {isScheduling && uploadProgress > 0 && uploadProgress < 100 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">Enviando arquivo...</span>
                <span className="text-sm font-medium text-blue-600">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={editingMessage ? handleUpdate : handleSchedule}
            disabled={
              isScheduling ||
              !selectedInstanceId || 
              (!formData.content.trim() && !selectedFile && !formData.media_url) || 
              !formData.scheduled_date || 
              !formData.scheduled_time
            }
            className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isScheduling 
              ? uploadProgress > 0 && uploadProgress < 100 
                ? `⏳ Enviando ${uploadProgress}%...` 
                : '⏳ Processando...'
              : (editingMessage ? 'Atualizar Mensagem' : 'Confirmar Agendamento')
            }
          </button>
        </div>
      )}

      {/* Lista de Mensagens Agendadas */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">
          Mensagens Agendadas ({scheduledMessages.length})
        </h4>
        
        {/* Filtros de Status */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 text-xs rounded whitespace-nowrap ${
              statusFilter === 'all' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'
            }`}
          >
            Todas ({scheduledMessages.length})
          </button>
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1 text-xs rounded whitespace-nowrap ${
              statusFilter === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100'
            }`}
          >
            🟡 Pendentes ({scheduledMessages.filter(m => m.status === 'pending').length})
          </button>
          <button
            onClick={() => setStatusFilter('sent')}
            className={`px-3 py-1 text-xs rounded whitespace-nowrap ${
              statusFilter === 'sent' ? 'bg-green-100 text-green-700' : 'bg-gray-100'
            }`}
          >
            🟢 Enviadas ({scheduledMessages.filter(m => m.status === 'sent').length})
          </button>
          <button
            onClick={() => setStatusFilter('failed')}
            className={`px-3 py-1 text-xs rounded whitespace-nowrap ${
              statusFilter === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100'
            }`}
          >
            🔴 Falhadas ({scheduledMessages.filter(m => m.status === 'failed').length})
          </button>
          <button
            onClick={() => setStatusFilter('cancelled')}
            className={`px-3 py-1 text-xs rounded whitespace-nowrap ${
              statusFilter === 'cancelled' ? 'bg-gray-200 text-gray-700' : 'bg-gray-100'
            }`}
          >
            ⚪ Canceladas ({scheduledMessages.filter(m => m.status === 'cancelled').length})
          </button>
        </div>

        {filteredMessages.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <svg className="mx-auto h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">Nenhuma mensagem {statusFilter !== 'all' ? statusFilter : 'agendada'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMessages.map(message => (
              <div key={message.id} className="p-3 border border-gray-200 rounded-lg">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex gap-2">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(message.status)}`}>
                      {message.status === 'pending' ? 'Pendente' : 
                       message.status === 'sent' ? 'Enviada' :
                       message.status === 'failed' ? 'Falhou' : 'Cancelada'}
                    </span>
                    {message.instance_name && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-indigo-100 text-indigo-800">
                        📱 {message.instance_name}
                      </span>
                    )}
                    {message.recurring_type !== 'none' && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-800">
                        🔄 {message.recurring_type === 'daily' ? 'Diário' : 
                            message.recurring_type === 'weekly' ? 'Semanal' : 'Mensal'}
                      </span>
                    )}
                    {message.cancel_if_lead_replies && (
                      <>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
                          🔔 Auto-Cancel
                        </span>
                        {message.cancel_scope === 'all_future' && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">
                            🚫 Todas futuras
                          </span>
                        )}
                      </>
                    )}
                    {message.media_url && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                        📎 Mídia
                      </span>
                    )}
                  </div>
                  
                  {message.status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(message)}
                        className="text-blue-600 hover:text-blue-800 text-xs"
                      >
                        ✏️ Editar
                      </button>
                      <button
                        onClick={() => handleCancelClick(message)}
                        className="text-red-600 hover:text-red-800 text-xs"
                      >
                        ✕ Cancelar
                      </button>
                    </div>
                  )}
                </div>
                
                <p className="text-sm text-gray-900 mb-2">{message.content}</p>
                
                <p className="text-xs text-gray-600">
                  {formatDateTime(message.scheduled_for)}
                </p>

                {message.status === 'cancelled' && message.error_message?.includes('lead respondeu') && (
                  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                    ℹ️ {message.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Modal de Confirmação de Cancelamento */}
      {showCancelModal && messageToCancel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              ⚠️ Cancelar Mensagem Agendada?
            </h3>
            <p className="text-gray-600 mb-4">
              Você está prestes a cancelar a seguinte mensagem:
            </p>
            <div className="p-3 bg-gray-50 rounded-lg mb-4">
              <p className="text-sm text-gray-900 mb-2">{messageToCancel.content}</p>
              <p className="text-xs text-gray-600">
                Agendada para: {formatDateTime(messageToCancel.scheduled_for)}
              </p>
            </div>
            <p className="text-sm text-red-600 mb-6">
              Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Voltar
              </button>
              <button
                onClick={handleConfirmCancel}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Sim, Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LeadPanel
