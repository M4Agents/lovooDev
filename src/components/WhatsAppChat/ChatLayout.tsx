// =====================================================
// CHAT LAYOUT - COMPONENTE PRINCIPAL ISOLADO
// =====================================================
// Layout principal do chat com 3 colunas.
// Suporta canal WhatsApp (comportamento original) e Instagram.
// NÃO refatora lógica WhatsApp existente.

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useChatData } from '../../hooks/chat/useChatData'
import { useInstagramChatData } from '../../hooks/chat/useInstagramChatData'
import { useInstagramCommentsData } from '../../hooks/instagram/useInstagramCommentsData'
import { useMetaWhatsAppInstances } from '../../hooks/useMetaWhatsAppInstances'
import { useMetaChatData } from '../../hooks/chat/useMetaChatData'
import { useAuth } from '../../contexts/AuthContext'
import { ConversationSidebar } from './ConversationSidebar/ConversationSidebar'
import { ChatArea } from './ChatArea/ChatArea'
import { LeadPanel } from './LeadPanel/LeadPanel'
import { LockedChatPanel } from './LockedChatPanel'
import { InstagramMainArea, InstagramRightPanel } from './InstagramAreaRenderer'
import { MetaChatArea } from './MetaChatArea/MetaChatArea'
import type { ChatConversation, ChatLayoutProps } from '../../types/whatsapp-chat'
import type { ChatChannel } from '../../types/instagram-chat'
import type { InstagramCommentsFilter } from '../../types/instagram-comments'
import type { InstagramSidebarData, MetaSidebarData } from './ConversationSidebar/ConversationSidebar'
import type { WhatsAppProvider } from '../../types/meta-whatsapp'

// =====================================================
// MVP3C.3 — TIPO DE SELEÇÃO UNIFICADA WHATSAPP
// =====================================================
// ChatLayout é o dono explícito desta seleção.
// provider é parte da identidade — nunca inferido de estado derivado.
// ID Meta NUNCA entra em useChatData/Uazapi.

type SelectedWhatsAppInstance =
  | { provider: 'uazapi'; id: string  }
  | { provider: 'meta';   id: string  }
  | { provider: undefined; id: 'all'  }

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const ChatLayout: React.FC<ChatLayoutProps> = ({
  companyId,
  userId,
  initialConversationId,
  hideConversationSidebar = false
}) => {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const { company, currentRole } = useAuth()

  const visibilityContext = useMemo(() => ({
    flag: company?.chat_visibility_by_assigned_to ?? false,
    role: currentRole,
    userId,
  }), [company?.chat_visibility_by_assigned_to, currentRole, userId])

  const chatData = useChatData(companyId, userId, initialConversationId, visibilityContext)

  // =====================================================
  // MVP3C.3 — SELEÇÃO UNIFICADA WHATSAPP (desktop apenas)
  // =====================================================

  // Estado explícito com provider discriminado.
  // Derivado de chatData.selectedInstance — que já leu localStorage internamente.
  // useChatData é a única fonte de persistência Uazapi; ChatLayout não lê localStorage diretamente.
  // IDs Meta nunca persistem: quando Meta é selecionado, chatData recebe 'all', que é o que persiste.
  const [selectedWAInstance, setSelectedWAInstance] = useState<SelectedWhatsAppInstance>(() => {
    const initial = chatData.selectedInstance  // 'all' ou ID Uazapi (nunca Meta)
    if (initial === 'all') return { provider: undefined, id: 'all' }
    return { provider: 'uazapi', id: initial }
  })

  // Hook Meta — instâncias conectadas da empresa
  const metaInstances = useMetaWhatsAppInstances(companyId)

  // ID Meta para useMetaChatData — undefined quando Uazapi ou 'all'
  // garante que useMetaChatData não seja ativado para seleções Uazapi
  const metaInstanceId: string | undefined =
    selectedWAInstance.provider === 'meta' ? selectedWAInstance.id : undefined

  // Hook Meta conversas — inativo enquanto provider !== 'meta'
  const metaChatData = useMetaChatData(companyId, metaInstanceId)

  // Adapter Uazapi → shape unificado (adiciona provider: 'uazapi')
  // Preserva todos os campos visuais existentes sem alterar chatData.instances
  const uazapiInstancesAdapted = useMemo(
    () => (chatData.instances as Record<string, unknown>[]).map(i => ({
      ...i,
      provider: 'uazapi' as WhatsAppProvider,
    })),
    [chatData.instances]
  )

  // Adapter Meta → shape visual compatível com InstanceSelector
  // Fallback para instance_name: display_name → phone_number → verified_name → id
  const metaInstancesAdapted = useMemo(
    () => metaInstances.instances.map(m => ({
      id:                  m.id,
      instance_name:       m.display_name || m.phone_number || m.verified_name || m.id,
      phone_number:        m.phone_number  ?? undefined,
      profile_name:        m.verified_name ?? undefined,
      profile_picture_url: undefined as string | undefined,
      status:              m.status,
      provider:            'meta' as WhatsAppProvider,
    })),
    [metaInstances.instances]
  )

  // Lista unificada: Uazapi primeiro, Meta após — preserva ordem visual
  const unifiedInstances = useMemo(
    () => [...uazapiInstancesAdapted, ...metaInstancesAdapted],
    [uazapiInstancesAdapted, metaInstancesAdapted]
  )

  // Handler unificado de seleção de instância.
  // Provider viaja explicitamente desde o clique no InstanceSelector — zero lookup.
  // ID Meta NUNCA é passado para chatData.setSelectedInstance.
  const handleSelectInstance = useCallback((id: string, provider?: WhatsAppProvider) => {
    if (id === 'all') {
      setSelectedWAInstance({ provider: undefined, id: 'all' })
      chatData.setSelectedInstance('all')
      return
    }
    if (provider === 'meta') {
      setSelectedWAInstance({ provider: 'meta', id })
      chatData.setSelectedInstance('all')   // ← ID Meta NUNCA vai para useChatData
    } else {
      // provider === 'uazapi' ou undefined (compatibilidade com legado sem provider)
      setSelectedWAInstance({ provider: 'uazapi', id })
      chatData.setSelectedInstance(id)      // ← apenas IDs Uazapi
    }
  }, [chatData])

  // Canal ativo — persiste entre sessões com fallback seguro
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel>(() => {
    const saved = localStorage.getItem(`chat_channel_${userId}`)
    return saved === 'instagram' || saved === 'whatsapp' ? saved : 'whatsapp'
  })

  const handleChannelChange = useCallback((channel: ChatChannel) => {
    setSelectedChannel(channel)
    localStorage.setItem(`chat_channel_${userId}`, channel)
  }, [userId])

  // Derivados estáveis — primitivos booleanos para uso seguro em useEffect (evita arrays nas deps)
  // G3: considera ambos os providers — Meta-only NÃO deve ativar a guarda de "sem WhatsApp"
  const hasNoWhatsAppInstances =
    !chatData.instancesLoading        &&
    !metaInstances.loading            &&
    chatData.instances.length === 0   &&
    metaInstances.instances.length === 0

  // igEnabled: ativa o hook IG quando canal = instagram OU quando WA está vazio
  // (necessário para verificar conexões IG antes de exibir o gate correto)
  const igEnabled = selectedChannel === 'instagram' || hasNoWhatsAppInstances

  // Hook Instagram — sempre chamado (regra dos hooks)
  const igChatData = useInstagramChatData(companyId, userId, igEnabled)

  // Derivado estável — evita passar igChatData.connections (array) no dep array do useEffect
  const hasActiveInstagramConnection =
    igChatData.connections.some(c => c.status === 'active')

  // Hook de Comentários — enabled somente quando instagram + tab de comentários
  const [commentsFilter, setCommentsFilter] = useState<InstagramCommentsFilter>({ tab: 'comments' })
  const activeIgTab = igChatData.filter.type
  const commentsEnabled = selectedChannel === 'instagram' && (activeIgTab === 'comments' || activeIgTab === 'pending')

  const igCommentsData = useInstagramCommentsData(
    companyId,
    igChatData.selectedConnectionId,
    commentsFilter,
    commentsEnabled,
  )

  // igSidebarData memoizado para evitar re-render do Sidebar a cada render do ChatLayout
  const igSidebarData: InstagramSidebarData = useMemo(() => ({
    connections:            igChatData.connections,
    conversations:          igChatData.conversations,
    filteredConversations:  igChatData.filteredConversations,
    selectedConnectionId:   igChatData.selectedConnectionId,
    selectedConversationId: igChatData.selectedConversationId,
    filter:                 igChatData.filter,
    loading:                igChatData.conversationsLoading,
    onSelectConnection:     igChatData.setSelectedConnection,
    onSelectConversation:   igChatData.setSelectedConversation,
    onFilterChange:         igChatData.setFilter,
    onRefresh:              igChatData.refreshConversations,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    igChatData.connections,
    igChatData.conversations,
    igChatData.filteredConversations,
    igChatData.selectedConnectionId,
    igChatData.selectedConversationId,
    igChatData.filter,
    igChatData.conversationsLoading,
  ])

  // MVP3C.3 — metaSidebarData construído exclusivamente a partir de metaChatData
  // NÃO cria novo fetch; NÃO chama metaWhatsAppApi diretamente.
  const metaSidebarData: MetaSidebarData = useMemo(() => ({
    conversations:          metaChatData.conversations,
    selectedConversationId: metaChatData.selectedConversationId,
    loading:                metaChatData.loading,
    error:                  metaChatData.error,
    onSelectConversation:   metaChatData.setSelectedConversation,
    onRefresh:              metaChatData.refresh,
  }), [
    metaChatData.conversations,
    metaChatData.selectedConversationId,
    metaChatData.loading,
    metaChatData.error,
    metaChatData.setSelectedConversation,
    metaChatData.refresh,
  ])

  // MVP3C.4 — Conversa Meta selecionada derivada exclusivamente de metaChatData.
  // NÃO faz fetch adicional; NÃO usa instance ID para inferir provider.
  // undefined quando nenhuma conversa estiver selecionada ou ID não encontrado.
  const selectedMetaConversation = useMemo(
    () =>
      metaChatData.selectedConversationId
        ? metaChatData.conversations.find(
            c => c.id === metaChatData.selectedConversationId
          )
        : undefined,
    [metaChatData.conversations, metaChatData.selectedConversationId]
  )

  // Conversa clicada que está bloqueada (lead is_over_plan = true) — apenas WhatsApp
  const [lockedConversation, setLockedConversation] = useState<ChatConversation | null>(null)

  const handleSelectConversation = useCallback((conversationId: string) => {
    const conversation = chatData.conversations.find(c => c.id === conversationId)
    if (conversation?.is_lead_over_plan) {
      setLockedConversation(conversation)
      return
    }
    setLockedConversation(null)
    chatData.setSelectedConversation(conversationId)
  }, [chatData])

  // Auto-switch: se WA não tem instâncias mas IG tem conexão ativa,
  // redireciona automaticamente para o canal Instagram
  useEffect(() => {
    if (
      selectedChannel === 'whatsapp' &&
      hasNoWhatsAppInstances &&
      !igChatData.connectionsLoading &&
      hasActiveInstagramConnection
    ) {
      handleChannelChange('instagram')
    }
  }, [
    selectedChannel,
    hasNoWhatsAppInstances,
    igChatData.connectionsLoading,
    hasActiveInstagramConnection,
    handleChannelChange,
  ])

  // =====================================================
  // LOADING STATE — apenas para WhatsApp (Instagram não bloqueia o layout)
  // =====================================================

  if (selectedChannel === 'whatsapp' && chatData.instancesLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-slate-600 mx-auto mb-6"></div>
            <div className="absolute inset-0 rounded-full h-10 w-10 border-2 border-transparent border-t-blue-500 animate-pulse mx-auto"></div>
          </div>
          <p className="text-slate-600 font-medium">{t('layout.loadingInstances')}</p>
          <p className="text-slate-400 text-sm mt-1">{t('layout.loadingInstancesHint')}</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // NO CHANNEL STATE — verifica WA + IG antes de bloquear
  // =====================================================

  if (selectedChannel === 'whatsapp' && hasNoWhatsAppInstances) {
    // IG ainda carregando: aguarda para decidir qual tela mostrar
    if (igChatData.connectionsLoading) {
      return (
        <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-50 to-gray-100">
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-slate-600 mx-auto mb-6"></div>
              <div className="absolute inset-0 rounded-full h-10 w-10 border-2 border-transparent border-t-blue-500 animate-pulse mx-auto"></div>
            </div>
            <p className="text-slate-600 font-medium">{t('layout.loadingChannels')}</p>
          </div>
        </div>
      )
    }

    // IG ativo: auto-switch em andamento via useEffect — spinner de transição
    if (hasActiveInstagramConnection) {
      return (
        <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-50 to-gray-100">
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-slate-600 mx-auto mb-6"></div>
              <div className="absolute inset-0 rounded-full h-10 w-10 border-2 border-transparent border-t-blue-500 animate-pulse mx-auto"></div>
            </div>
            <p className="text-slate-600 font-medium">{t('layout.loadingChannels')}</p>
          </div>
        </div>
      )
    }

    // Nenhum canal conectado: tela com opção para conectar WA ou Instagram
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center max-w-md p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20">
          <div className="mb-6">
            <div className="mx-auto h-16 w-16 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
              <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
              </svg>
            </div>
          </div>
          <h3 className="text-xl font-semibold text-slate-800 mb-3">
            {t('layout.noChannelTitle')}
          </h3>
          <p className="text-slate-600 mb-6 leading-relaxed">
            {t('layout.noChannelBody')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate('/settings/whatsapp-life')}
              className="inline-flex items-center justify-center px-5 py-3 bg-gradient-to-r from-emerald-500 to-blue-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              {t('layout.connectWhatsApp')}
            </button>
            <button
              onClick={() => navigate('/settings?tab=integracoes&integration=instagram')}
              className="inline-flex items-center justify-center px-5 py-3 bg-gradient-to-r from-purple-500 to-pink-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              {t('layout.connectInstagram')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // =====================================================
  // LAYOUT PRINCIPAL — Instagram ou WhatsApp
  // =====================================================

  return (
    <div className="flex h-full bg-gradient-to-br from-slate-50 to-gray-100">
      {/* Sidebar Conversas - 25% */}
      {!hideConversationSidebar && (
        <div className="w-1/4 min-w-[320px] bg-white/80 backdrop-blur-sm border-r border-slate-200/60 shadow-sm">
          <ConversationSidebar
            companyId={companyId}
            userId={userId}
            instances={unifiedInstances}
            conversations={chatData.conversations}
            selectedInstance={selectedWAInstance.id}
            selectedConversation={chatData.selectedConversation}
            filter={chatData.filter}
            loading={chatData.conversationsLoading}
            onSelectInstance={handleSelectInstance}
            onSelectConversation={handleSelectConversation}
            onFilterChange={chatData.setFilter}
            onRefresh={chatData.refreshConversations}
            hasMoreConversations={chatData.hasMoreConversations}
            loadMoreConversations={chatData.loadMoreConversations}
            loadingMoreConversations={chatData.loadingMoreConversations}
            selectedChannel={selectedChannel}
            onChannelChange={handleChannelChange}
            igData={igSidebarData}
            igCommentsData={igCommentsData}
            metaData={metaSidebarData}
            selectedProvider={selectedWAInstance.provider}
          />
        </div>
      )}

      {/* Área Chat - 50% */}
      <div className={`${hideConversationSidebar ? 'flex-[3]' : 'flex-1'} flex flex-col bg-white/60 backdrop-blur-sm`}>
        {selectedChannel === 'instagram' ? (
          <InstagramMainArea
            companyId={companyId}
            igSidebarData={igSidebarData}
            igChatDataRaw={igChatData}
            igCommentsData={igCommentsData}
            activeTab={activeIgTab}
          />
        ) : selectedWAInstance.provider === 'meta' ? (
          /* MVP3C.4 — MetaChatArea read-only.
             Monta somente quando há conversationId selecionado.
             ChatArea Uazapi nunca monta neste branch. */
          metaChatData.selectedConversationId ? (
            <MetaChatArea
              companyId={companyId}
              conversationId={metaChatData.selectedConversationId}
              conversation={selectedMetaConversation}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 max-w-md">
                <div className="mb-6">
                  <div className="mx-auto h-20 w-20 bg-gradient-to-br from-blue-400 to-blue-600 rounded-3xl flex items-center justify-center shadow-lg">
                    <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
                    </svg>
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-slate-800 mb-3">
                  {t('layout.selectConversationTitle')}
                </h3>
                <p className="text-slate-600 leading-relaxed text-sm">
                  Selecione uma conversa Meta WhatsApp para visualizar as mensagens.
                </p>
              </div>
            </div>
          )
        ) : (
          /* Uazapi / 'all' — fluxo original intacto */
          lockedConversation ? (
            <LockedChatPanel contactName={lockedConversation.contact_name} />
          ) : chatData.selectedConversation ? (
            <ChatArea
              conversationId={chatData.selectedConversation}
              companyId={companyId}
              userId={userId}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center p-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 max-w-md">
                <div className="mb-6">
                  <div className="mx-auto h-20 w-20 bg-gradient-to-br from-slate-400 to-slate-600 rounded-3xl flex items-center justify-center shadow-lg">
                    <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
                    </svg>
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-slate-800 mb-3">
                  {t('layout.selectConversationTitle')}
                </h3>
                <p className="text-slate-600 leading-relaxed">
                  {t('layout.selectConversationBody')}
                </p>
              </div>
            </div>
          )
        )}
      </div>

      {/* Painel Lead - 25% */}
      <div className={`${hideConversationSidebar ? 'flex-[2] h-full' : 'w-1/4 min-w-[320px]'} bg-white/80 backdrop-blur-sm border-l border-slate-200/60 shadow-sm`}>
        {selectedChannel === 'instagram' ? (
          <InstagramRightPanel
            companyId={companyId}
            igSidebarData={igSidebarData}
            igChatDataRaw={igChatData}
            igCommentsData={igCommentsData}
            activeTab={activeIgTab}
          />
        ) : selectedWAInstance.provider === 'meta' ? (
          /* MVP3C.3 — Meta selecionado: LeadPanel Uazapi NÃO renderiza.
             Integração de lead Meta será implementada em etapa futura. */
          <div className="flex items-center justify-center h-full p-6">
            <div className="text-center">
              <div className="mb-4">
                <div className="mx-auto h-14 w-14 bg-gradient-to-br from-blue-100 to-blue-200 rounded-xl flex items-center justify-center">
                  <svg className="h-7 w-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                Painel de lead disponível em breve para Meta WhatsApp.
              </p>
            </div>
          </div>
        ) : (
          /* Uazapi / 'all' — fluxo original intacto */
          selectedChannel === 'whatsapp' && !lockedConversation && chatData.selectedConversation ? (
            <LeadPanel
              conversationId={chatData.selectedConversation}
              companyId={companyId}
              userId={userId}
              onLeadSaved={chatData.refreshConversations}
            />
          ) : (
            <div className="flex items-center justify-center h-full p-6">
              <div className="text-center">
                <div className="mb-6">
                  <div className="mx-auto h-16 w-16 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
                    <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                </div>
                <h4 className="text-lg font-semibold text-slate-800 mb-2">
                  {t('layout.leadPanelTitle')}
                </h4>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {t('layout.leadPanelBody')}
                </p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE RESPONSIVO PARA MOBILE
// =====================================================

export const ChatLayoutMobile: React.FC<ChatLayoutProps> = ({
  companyId,
  userId
}) => {
  const { t } = useTranslation('chat')
  const { company, currentRole } = useAuth()

  const visibilityContext = useMemo(() => ({
    flag: company?.chat_visibility_by_assigned_to ?? false,
    role: currentRole,
    userId,
  }), [company?.chat_visibility_by_assigned_to, currentRole, userId])

  const chatData = useChatData(companyId, userId, undefined, visibilityContext)
  const [activeView, setActiveView] = React.useState<'conversations' | 'chat' | 'lead'>('conversations')
  const [lockedConversation, setLockedConversation] = React.useState<ChatConversation | null>(null)

  const handleSelectConversationMobile = useCallback((conversationId: string) => {
    const conversation = chatData.conversations.find(c => c.id === conversationId)
    if (conversation?.is_lead_over_plan) {
      setLockedConversation(conversation)
      setActiveView('chat')
      return
    }
    setLockedConversation(null)
    chatData.setSelectedConversation(conversationId)
    setActiveView('chat')
  }, [chatData])

  if (chatData.instancesLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('mobile.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header Mobile */}
      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setActiveView('conversations')}
          className={`flex-1 py-3 px-4 text-sm font-medium ${
            activeView === 'conversations'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600'
          }`}
        >
          {t('mobile.conversations')}
        </button>
        {chatData.selectedConversation && (
          <>
            <button
              onClick={() => setActiveView('chat')}
              className={`flex-1 py-3 px-4 text-sm font-medium ${
                activeView === 'chat'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600'
              }`}
            >
              {t('mobile.chat')}
            </button>
            <button
              onClick={() => setActiveView('lead')}
              className={`flex-1 py-3 px-4 text-sm font-medium ${
                activeView === 'lead'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600'
              }`}
            >
              {t('mobile.lead')}
            </button>
          </>
        )}
      </div>

      {/* Content Mobile */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'conversations' && (
          <ConversationSidebar
            companyId={companyId}
            userId={userId}
            instances={chatData.instances}
            conversations={chatData.conversations}
            selectedInstance={chatData.selectedInstance}
            selectedConversation={chatData.selectedConversation}
            filter={chatData.filter}
            loading={chatData.conversationsLoading}
            onSelectInstance={chatData.setSelectedInstance}
            onSelectConversation={handleSelectConversationMobile}
            onFilterChange={chatData.setFilter}
            onRefresh={chatData.refreshConversations}
            hasMoreConversations={chatData.hasMoreConversations}
            loadMoreConversations={chatData.loadMoreConversations}
            loadingMoreConversations={chatData.loadingMoreConversations}
          />
        )}

        {activeView === 'chat' && (
          lockedConversation
            ? <LockedChatPanel contactName={lockedConversation.contact_name} />
            : chatData.selectedConversation
              ? <ChatArea
                  conversationId={chatData.selectedConversation}
                  companyId={companyId}
                  userId={userId}
                />
              : null
        )}

        {activeView === 'lead' && chatData.selectedConversation && (
          <LeadPanel
            conversationId={chatData.selectedConversation}
            companyId={companyId}
            userId={userId}
            onLeadSaved={chatData.refreshConversations}
          />
        )}
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE ADAPTATIVO
// =====================================================

export const AdaptiveChatLayout: React.FC<ChatLayoutProps> = (props) => {
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return isMobile ? (
    <ChatLayoutMobile {...props} />
  ) : (
    <ChatLayout {...props} />
  )
}

export default AdaptiveChatLayout
