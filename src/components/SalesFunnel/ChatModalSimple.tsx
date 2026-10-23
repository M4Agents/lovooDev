import { useEffect, useState } from 'react'
import { X, MessageSquarePlus, WifiOff } from 'lucide-react'
import ChatArea from '../WhatsAppChat/ChatArea/ChatArea'
import LeadPanel from '../WhatsAppChat/LeadPanel/LeadPanel'
import { InstanceSelector } from '../WhatsAppChat/InstanceSelector'
import { chatApi } from '../../services/chat/chatApi'
import { supabase } from '../../lib/supabase'
import { api } from '../../services/api'
import { crmService } from '../../services/automation/CRMService'
import { useAuth } from '../../contexts/AuthContext'
import {
  instancesVisibleInChat,
  leadInstanceOptions,
  type LeadChatInstance,
  type LeadInstanceOption,
} from '../../utils/leadChatInstances'

interface ConnectedInstance {
  id: string
  instance_name: string
  phone_number: string | null
}

interface ChatModalSimpleProps {
  isOpen: boolean
  onClose: () => void
  leadId: number
  companyId: string
  userId: string
  closeLabel?: string
}

export default function ChatModalSimple({
  isOpen,
  onClose,
  leadId,
  companyId,
  userId,
  closeLabel = 'Voltar ao Funil'
}: ChatModalSimpleProps) {
  const { company, currentRole } = useAuth()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noConversation, setNoConversation] = useState(false)
  const [connectedInstances, setConnectedInstances] = useState<ConnectedInstance[]>([])
  const [instanceOptions, setInstanceOptions] = useState<LeadInstanceOption[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('')
  const [leadPhone, setLeadPhone] = useState<string>('')
  const [leadName, setLeadName] = useState<string>('')
  const [startingConversation, setStartingConversation] = useState(false)

  const resetState = () => {
    setConversationId(null)
    setError(null)
    setNoConversation(false)
    setConnectedInstances([])
    setInstanceOptions([])
    setSelectedInstanceId('')
    setLeadPhone('')
    setLeadName('')
    setStartingConversation(false)
  }

  const visibility = {
    flag: company?.id === companyId ? (company.chat_visibility_by_assigned_to ?? false) : false,
    role: company?.id === companyId ? currentRole : null,
    userId,
  }

  const loadInstancesAndLead = async (isActive: () => boolean) => {
    const [instancesResult, leadResult] = await Promise.all([
      supabase
        .from('whatsapp_life_instances')
        .select('id, instance_name, phone_number, status, assigned_user_id, available_to_all')
        .eq('company_id', companyId)
        .eq('status', 'connected')
        .is('deleted_at', null)
        .order('instance_name'),
      supabase
        .from('leads')
        .select('name, phone')
        .eq('id', leadId)
        .eq('company_id', companyId)
        .single()
    ])

    if (!isActive()) return

    if (!instancesResult.error && instancesResult.data) {
      const visible = instancesVisibleInChat(
        instancesResult.data as LeadChatInstance[],
        visibility
      )
      setConnectedInstances(visible.map(instance => ({
        id: instance.id,
        instance_name: instance.instance_name,
        phone_number: instance.phone_number ?? null,
      })))
      if (visible.length === 1) {
        setSelectedInstanceId(visible[0].id)
      }
    }

    if (!leadResult.error && leadResult.data) {
      setLeadPhone(leadResult.data.phone?.replace(/\D/g, '') || '')
      setLeadName(leadResult.data.name || '')
    }
  }

  const loadConversation = async (isActive: () => boolean) => {
    try {
      setLoading(true)
      const sameCompany = company?.id === companyId

      if (!sameCompany) {
        const convId = await chatApi.getConversationByLeadId(leadId, companyId)
        if (!isActive()) return
        if (convId) {
          setConversationId(convId)
        } else {
          await loadInstancesAndLead(isActive)
          if (isActive()) setNoConversation(true)
        }
        return
      }

      const { conversations, instances } = await chatApi.listLeadChatsByInstance(leadId, companyId)
      if (!isActive()) return
      const options = leadInstanceOptions(conversations, instances, visibility)
      setInstanceOptions(options)

      if (options.length === 0) {
        await loadInstancesAndLead(isActive)
        if (isActive()) setNoConversation(true)
        return
      }

      setConversationId(options[0].conversationId)
      setSelectedInstanceId(options[0].instance.id)
    } catch (err) {
      console.error('Erro ao buscar conversa:', err)
      if (isActive()) setError('Erro ao carregar conversa do lead')
    } finally {
      if (isActive()) setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen || !leadId) return
    let cancelled = false

    resetState()
    setLoading(true)
    void loadConversation(() => !cancelled)

    return () => {
      cancelled = true
    }
    // A busca usa a empresa e o papel ativos. loadConversation lê o estado mais recente desse render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, leadId, companyId, userId, company?.id, company?.chat_visibility_by_assigned_to, currentRole])

  const handleSelectLeadInstance = (instanceId: string) => {
    const option = instanceOptions.find(item => item.instance.id === instanceId)
    if (!option) return
    setSelectedInstanceId(instanceId)
    setConversationId(option.conversationId)
  }

  const ensureLeadAndOpportunity = async (conversationId: string) => {
    try {
      // 1. Verificar se já existe lead com este telefone na empresa
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone', leadPhone)
        .limit(1)
        .maybeSingle()

      let leadId: number

      if (existingLead) {
        leadId = existingLead.id
      } else {
        // 2. Criar lead automaticamente
        const newLead = await api.createLead({
          company_id: companyId,
          name: leadName || leadPhone,
          phone: leadPhone,
          origin: 'whatsapp',
        })
        leadId = newLead.id
      }

      // 3. Vincular lead_id à conversa
      await supabase
        .from('chat_conversations')
        .update({ lead_id: leadId })
        .eq('id', conversationId)

      // 4. Criar oportunidade no funil padrão (apenas se não existir)
      const { data: existingOpp } = await supabase
        .from('opportunities')
        .select('id')
        .eq('company_id', companyId)
        .eq('lead_id', leadId)
        .limit(1)
        .maybeSingle()

      if (!existingOpp) {
        const createdOpp = await crmService.createOpportunity({ leadId, companyId })

        // Disparar automação (fire-and-forget — nunca bloqueia a UI)
        if (createdOpp?.opportunityId) {
          supabase.auth.getSession().then(({ data: sessionData }) => {
            const token = sessionData.session?.access_token
            if (!token) return
            fetch('/api/automation/trigger-event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                event_type: 'opportunity.created',
                company_id: companyId,
                data: {
                  opportunity_id: createdOpp.opportunityId,
                  lead_id:        leadId ?? null,
                  opportunity:    {},
                },
              }),
            }).catch(err => console.error('[ChatModalSimple] opportunity.created trigger failed:', err))
          }).catch(() => { /* sem sessão — ignora silenciosamente */ })
        }
      }
    } catch (err) {
      console.error('Erro ao criar lead/oportunidade automaticamente:', err)
    }
  }

  const handleStartConversation = async () => {
    if (!selectedInstanceId || !leadPhone) return

    try {
      setStartingConversation(true)
      const conversation = await chatApi.createOrGetConversation(
        companyId,
        selectedInstanceId,
        leadPhone,
        leadName || undefined
      )

      // Criar lead + oportunidade automaticamente se contato for novo
      if (!conversation.lead_id) {
        await ensureLeadAndOpportunity(conversation.id)
      }

      setConversationId(conversation.id)
      setNoConversation(false)
    } catch (err) {
      console.error('Erro ao iniciar conversa:', err)
      setError('Não foi possível iniciar a conversa. Verifique se a instância está conectada.')
    } finally {
      setStartingConversation(false)
    }
  }

  const renderNoConversationState = () => {
    if (connectedInstances.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md p-8">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <WifiOff className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Nenhuma instância WhatsApp conectada
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              É necessário ter pelo menos uma instância WhatsApp conectada para iniciar uma conversa com este lead.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {closeLabel}
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm p-8">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <MessageSquarePlus className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Iniciar conversa
          </h3>
          <p className="text-sm text-gray-600 mb-6">
            Este lead ainda não possui conversa no WhatsApp. Selecione a instância para iniciar o contato.
          </p>

          <div className="mb-6 text-left">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Instância WhatsApp
            </label>
            <select
              value={selectedInstanceId}
              onChange={e => setSelectedInstanceId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Selecione uma instância...</option>
              {connectedInstances.map(instance => (
                <option key={instance.id} value={instance.id}>
                  {instance.instance_name}{instance.phone_number ? ` (${instance.phone_number})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 justify-center">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
            >
              {closeLabel}
            </button>
            <button
              onClick={handleStartConversation}
              disabled={!selectedInstanceId || !leadPhone || startingConversation}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {startingConversation ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Iniciando...
                </>
              ) : (
                <>
                  <MessageSquarePlus className="w-4 h-4" />
                  Iniciar Conversa
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-lg shadow-2xl flex flex-col w-[min(70vw,calc(100vw-2rem))] h-[min(80dvh,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)]">
        {/* Header */}
        <div className="relative z-20 flex items-center justify-between gap-4 rounded-t-lg px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-xl font-semibold text-gray-900 shrink-0">Chat do Lead</h2>
            {instanceOptions.length > 1 && conversationId && (
              <div className="min-w-0 w-72 max-w-[18rem]">
                <InstanceSelector
                  instances={instanceOptions.map(option => ({
                    ...option.instance,
                    phone_number: option.instance.phone_number || undefined,
                    profile_name: option.instance.profile_name || undefined,
                    profile_picture_url: option.instance.profile_picture_url || undefined,
                  }))}
                  selectedInstance={selectedInstanceId}
                  onSelectInstance={handleSelectLeadInstance}
                  showAllOption={false}
                />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors shrink-0"
            title="Fechar"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden min-h-0 rounded-b-lg">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Carregando conversa...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md p-8">
                <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{error}</h3>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {closeLabel}
                </button>
              </div>
            </div>
          ) : noConversation ? (
            renderNoConversationState()
          ) : conversationId ? (
            <>
              {/* ChatArea - 60% */}
              <div className="flex h-full min-h-0 min-w-0 flex-col bg-white" style={{ width: '60%' }}>
                <ChatArea
                  key={conversationId}
                  conversationId={conversationId}
                  companyId={companyId}
                  userId={userId}
                />
              </div>

              {/* LeadPanel - 40% */}
              <div className="h-full min-h-0 overflow-hidden bg-white border-l border-gray-200" style={{ width: '40%' }}>
                <LeadPanel
                  key={conversationId}
                  conversationId={conversationId}
                  companyId={companyId}
                  userId={userId}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
