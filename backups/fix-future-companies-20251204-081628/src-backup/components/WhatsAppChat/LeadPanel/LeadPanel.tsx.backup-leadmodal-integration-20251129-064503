// =====================================================
// LEAD PANEL - COMPONENTE ISOLADO
// =====================================================
// Painel com informações do lead e agendamento
// NÃO MODIFICA componentes existentes

import React, { useState, useEffect } from 'react'
import { chatApi } from '../../../services/chat/chatApi'
import type { 
  ChatContact, 
  ChatScheduledMessage, 
  LeadPanelProps,
  ContactInfoForm,
  ScheduleMessageForm
} from '../../../types/whatsapp-chat'

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const LeadPanel: React.FC<LeadPanelProps> = ({
  conversationId,
  companyId,
  userId
}) => {
  const [contact, setContact] = useState<ChatContact | null>(null)
  const [scheduledMessages, setScheduledMessages] = useState<ChatScheduledMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'schedule'>('info')
  const [conversation, setConversation] = useState<any>(null)

  // =====================================================
  // BUSCAR DADOS
  // =====================================================

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
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'info'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Informações
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'schedule'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Agendar
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
          />
        ) : (
          <ScheduleMessages
            conversationId={conversationId}
            companyId={companyId}
            instanceId={conversation?.instance_id}
            scheduledMessages={scheduledMessages}
            onUpdate={fetchData}
          />
        )}
      </div>
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
}

const ContactInfo: React.FC<ContactInfoProps> = ({
  contact,
  conversation,
  companyId,
  onUpdate
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

  const formatPhone = (phone: string) => {
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length === 11) {
      return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`
    }
    return phone
  }

  const getStatusColor = (status: string) => {
    const colors = {
      new: 'bg-blue-100 text-blue-800',
      contacted: 'bg-yellow-100 text-yellow-800',
      qualified: 'bg-green-100 text-green-800',
      proposal: 'bg-purple-100 text-purple-800',
      negotiation: 'bg-orange-100 text-orange-800',
      closed: 'bg-green-100 text-green-800',
      lost: 'bg-red-100 text-red-800'
    }
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'
  }

  const getStatusLabel = (status: string) => {
    const labels = {
      new: 'Novo',
      contacted: 'Contatado',
      qualified: 'Qualificado',
      proposal: 'Proposta',
      negotiation: 'Negociação',
      closed: 'Fechado',
      lost: 'Perdido'
    }
    return labels[status as keyof typeof labels] || status
  }

  return (
    <div className="p-4 space-y-6">
      {/* Avatar e Info Básica */}
      <div className="text-center">
        <div className="w-16 h-16 rounded-full mx-auto mb-3 overflow-hidden bg-gray-300 flex items-center justify-center">
          {contact?.profile_picture_url ? (
            <img
              src={contact.profile_picture_url}
              alt={contact.name || conversation?.contact_name || 'Foto do lead'}
              className="w-full h-full object-cover"
            />
          ) : (
            <svg className="w-8 h-8 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
          )}
        </div>
        
        <h3 className="text-lg font-medium text-gray-900">
          {contact?.name || conversation?.contact_name || 'Sem nome'}
        </h3>
        
        {/* NOVO: Nome da Empresa (sutil e delicado) */}
        {conversation?.company_name && conversation.company_name.trim() !== '' && (
          <p className="text-xs text-slate-400 font-normal mt-1">
            {conversation.company_name}
          </p>
        )}
        
        <p className="text-sm text-gray-600">
          {formatPhone(conversation?.contact_phone || '')}
        </p>

        {contact?.lead_status && (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-2 ${getStatusColor(contact.lead_status)}`}>
            {getStatusLabel(contact.lead_status)}
          </span>
        )}
      </div>

      {/* Ações */}
      <div className="flex space-x-2">
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
          >
            Editar
          </button>
        ) : (
          <>
            <button
              onClick={handleSave}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Salvar
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex-1 px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancelar
            </button>
          </>
        )}
      </div>

      {/* Informações Detalhadas */}
      <div className="space-y-4">
        {editing ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status do Lead</label>
              <select
                value={formData.lead_status}
                onChange={(e) => setFormData(prev => ({ ...prev, lead_status: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="new">Novo</option>
                <option value="contacted">Contatado</option>
                <option value="qualified">Qualificado</option>
                <option value="proposal">Proposta</option>
                <option value="negotiation">Negociação</option>
                <option value="closed">Fechado</option>
                <option value="lost">Perdido</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor do Negócio</label>
              <input
                type="number"
                value={formData.deal_value}
                onChange={(e) => setFormData(prev => ({ ...prev, deal_value: parseFloat(e.target.value) || 0 }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="0,00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Anotações</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Adicione suas anotações..."
              />
            </div>
          </>
        ) : (
          <>
            {contact?.email && (
              <div>
                <label className="block text-sm font-medium text-gray-700">E-mail</label>
                <p className="text-sm text-gray-900">{contact.email}</p>
              </div>
            )}

            {contact?.deal_value && contact.deal_value > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Valor do Negócio</label>
                <p className="text-sm text-gray-900">
                  {new Intl.NumberFormat('pt-BR', { 
                    style: 'currency', 
                    currency: 'BRL' 
                  }).format(contact.deal_value)}
                </p>
              </div>
            )}

            {contact?.notes && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Anotações</label>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{contact.notes}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">Estatísticas</label>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <div className="text-lg font-semibold text-gray-900">
                    {contact?.total_messages || 0}
                  </div>
                  <div className="text-xs text-gray-600">Mensagens</div>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <div className="text-lg font-semibold text-gray-900">
                    {contact?.first_contact_at ? 
                      Math.floor((Date.now() - new Date(contact.first_contact_at).getTime()) / (1000 * 60 * 60 * 24))
                      : 0
                    }
                  </div>
                  <div className="text-xs text-gray-600">Dias</div>
                </div>
              </div>
            </div>
          </>
        )}
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
    recurring_type: 'none'
  })

  const handleSchedule = async () => {
    if (!instanceId || !formData.content.trim() || !formData.scheduled_date || !formData.scheduled_time) {
      return
    }

    try {
      await chatApi.scheduleMessage(
        conversationId,
        companyId,
        instanceId,
        '', // userId será obtido do contexto
        formData
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
      onUpdate()
    } catch (error) {
      console.error('Error scheduling message:', error)
    }
  }

  const handleCancel = async (messageId: string) => {
    try {
      await chatApi.cancelScheduledMessage(messageId, companyId)
      onUpdate()
    } catch (error) {
      console.error('Error cancelling message:', error)
    }
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Digite a mensagem..."
            />
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

          <button
            onClick={handleSchedule}
            disabled={!formData.content.trim() || !formData.scheduled_date || !formData.scheduled_time}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirmar Agendamento
          </button>
        </div>
      )}

      {/* Lista de Mensagens Agendadas */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">
          Mensagens Agendadas ({scheduledMessages.length})
        </h4>

        {scheduledMessages.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <svg className="mx-auto h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">Nenhuma mensagem agendada</p>
          </div>
        ) : (
          <div className="space-y-3">
            {scheduledMessages.map(message => (
              <div key={message.id} className="p-3 border border-gray-200 rounded-lg">
                <div className="flex items-start justify-between mb-2">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(message.status)}`}>
                    {message.status === 'pending' ? 'Pendente' : 
                     message.status === 'sent' ? 'Enviada' :
                     message.status === 'failed' ? 'Falhou' : 'Cancelada'}
                  </span>
                  
                  {message.status === 'pending' && (
                    <button
                      onClick={() => handleCancel(message.id)}
                      className="text-red-600 hover:text-red-800 text-xs"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
                
                <p className="text-sm text-gray-900 mb-2">{message.content}</p>
                
                <p className="text-xs text-gray-600">
                  {formatDateTime(message.scheduled_for)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default LeadPanel
