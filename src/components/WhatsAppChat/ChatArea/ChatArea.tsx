// =====================================================
// CHAT AREA - COMPONENTE ISOLADO
// =====================================================
// Área principal do chat com mensagens e input
// NÃO MODIFICA componentes existentes

import React, { useState, useEffect, useRef } from 'react'
import { chatApi } from '../../../services/chat/chatApi'
import { ChatEventBus, useChatEvent } from '../../../services/chat/chatEventBus'
import { ChatFeatureManager } from '../../../config/chatFeatures'
import { useConversationRealtime } from '../../../hooks/chat/useChatRealtime'
import type { ChatMessage, SendMessageForm, ChatAreaProps, ChatConversation } from '../../../types/whatsapp-chat'
import data from '@emoji-mart/data'
// @ts-ignore - tipos de emoji-mart podem não estar instalados
import Picker from '@emoji-mart/react'

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversationId,
  companyId,
  userId
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [sending, setSending] = useState(false)
  const [isUserAtBottom, setIsUserAtBottom] = useState(true)
  const [currentVisibleDate, setCurrentVisibleDate] = useState<string | null>(null)
  const [showDateIndicator, setShowDateIndicator] = useState(false)
  const [conversation, setConversation] = useState<ChatConversation | null>(null)
  const [contactPhotoUrl, setContactPhotoUrl] = useState<string | null>(null)
  // 🚨 EMERGÊNCIA: Cache desabilitado temporariamente para resolver tela branca
  const [sentMessages, setSentMessages] = useState<ChatMessage[]>([])
  
  // Estado para Drag & Drop (movido para componente principal)
  const [isDragOver, setIsDragOver] = useState(false)
  
  // Estados para Modal de Preview (como WhatsApp Web)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewFile, setPreviewFile] = useState<{
    file: File,
    url: string,
    name: string,
    size: number,
    type: string
  } | null>(null)
  const [captionMessage, setCaptionMessage] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null)
  const [videoErrors, setVideoErrors] = useState<Set<string>>(new Set())
  
  // Limpar qualquer cache existente que possa estar corrompido
  useEffect(() => {
    if (conversationId) {
      try {
        localStorage.removeItem(`sentMessages_${conversationId}`)
        console.log('🧹 Cache limpo para resolver tela branca')
      } catch (error) {
        console.warn('Erro ao limpar cache:', error)
      }
    }
  }, [conversationId])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // 🚨 EMERGÊNCIA: Persistência desabilitada temporariamente
  // useEffect para cache desabilitado até resolver tela branca

  // =====================================================
  // BUSCAR MENSAGENS
  // =====================================================

  const fetchMessages = async () => {
    try {
      setLoading(true)
      // Carregando mensagens...
      
      // NOVO: Carregar mensagens recentes (aumentado para 50 para garantir mídia recente)
      const messagesData = await chatApi.getRecentMessages(conversationId, companyId, 50)
      
      // Logs removidos por segurança
      
      // Merge inteligente: preservar mensagens locais temporárias
      setMessages(prev => {
        // Processando estado do chat...
        
        // Mensagens temporárias (ainda não confirmadas no banco)
        const tempMessages = prev.filter(msg => msg.id.startsWith('temp-'))
        
        // Mensagens do banco
        const bankMessages = messagesData || []
        
        // Combinar sem duplicatas
        const allMessages = [...bankMessages, ...tempMessages]
        
        // Ordenar por timestamp
        const sortedMessages = allMessages.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        
        // Merge de mensagens concluído
        
        // Processando mensagens de mídia...  
        
        return sortedMessages
      })
      
    } catch (error) {
      console.error('Erro ao carregar mensagens')
      // Em caso de erro, manter mensagens existentes
    } finally {
      setLoading(false)
    }
  }

  // =====================================================
  // CARREGAR MENSAGENS ANTIGAS (BOTÃO "CARREGAR MAIS")
  // =====================================================

  // Função para formatação de data do indicador flutuante
  const formatDateSeparator = (timestamp: string | Date) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return "Hoje";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Ontem";
    } else {
      return date.toLocaleDateString('pt-BR'); // DD/MM/AAAA
    }
  };

  // Função para detectar data visível durante scroll
  const detectVisibleDate = () => {
    const container = messagesContainerRef.current;
    
    if (!container || messages.length === 0) {
      return;
    }

    // Encontrar primeira mensagem visível no topo do viewport
    const containerRect = container.getBoundingClientRect();
    const messageElements = container.querySelectorAll('[data-message-date]');
    
    for (const element of messageElements) {
      const rect = element.getBoundingClientRect();
      
      // Se a mensagem está visível no topo do container (com margem de 100px)
      if (rect.top >= containerRect.top && rect.top <= containerRect.top + 100) {
        const messageDate = element.getAttribute('data-message-date');
        
        if (messageDate) {
          const messageDateTime = new Date(messageDate);
          const today = new Date();
          const yesterday = new Date(today);
          yesterday.setDate(today.getDate() - 1);
          
          // Só mostrar indicador se a mensagem for de ontem ou anterior
          // (não mostrar para mensagens de hoje)
          const isToday = messageDateTime.toDateString() === today.toDateString();
          
          if (!isToday) {
            const formattedDate = formatDateSeparator(messageDate);
            setCurrentVisibleDate(formattedDate);
            setShowDateIndicator(true);
            return;
          } else {
            // Se é de hoje, esconder indicador
            setShowDateIndicator(false);
            return;
          }
        }
      }
    }
    
    // Se não encontrou nenhuma mensagem visível, esconder indicador
    setShowDateIndicator(false);
  };

  // Função para detectar se usuário está no final do chat
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    
    // Considera "no final" se está a menos de 50px do fim
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 50;
    setIsUserAtBottom(isAtBottom);
    
    // Só executar detecção se não estiver no final
    if (!isAtBottom) {
      // Detectando data visível durante scroll
      
      // Detectar data visível durante scroll
      try {
        detectVisibleDate();
      } catch (error) {
        // Erro na detecção de data
      }
    } else {
      // Esconder indicador se estiver no final
      setShowDateIndicator(false);
    }
  };

  // Função loadOlderMessages mantida para o botão "Carregar Mais"
  const loadOlderMessages = async () => {
    if (loadingOlder || !hasMoreMessages || messages.length === 0) {
      return
    }

    const container = messagesContainerRef.current;
    if (!container) return;

    try {
      setLoadingOlder(true)
      // Carregando mensagens antigas...

      // Salvar posição atual ANTES de carregar
      const scrollHeight = container.scrollHeight;
      const scrollTop = container.scrollTop;
      
      // Salvando posição do scroll...

      // Pegar timestamp da mensagem mais antiga
      const oldestTimestamp = new Date(messages[0].timestamp)
      
      // Carregar mensagens anteriores
      const olderMessages = await chatApi.getOlderMessages(
        conversationId, 
        companyId, 
        oldestTimestamp, 
        20
      )

      if (olderMessages.length === 0) {
        setHasMoreMessages(false)
        // Não há mais mensagens antigas
        return
      }

      // Adicionar mensagens antigas no início da lista
      setMessages(prev => {
        const newMessages = [...olderMessages, ...prev]
        // Mensagens antigas adicionadas
        return newMessages
      })

      // Restaurar posição APÓS DOM atualizar
      requestAnimationFrame(() => {
        const newScrollHeight = container.scrollHeight;
        const heightDifference = newScrollHeight - scrollHeight;
        const newScrollTop = scrollTop + heightDifference;
        
        container.scrollTop = newScrollTop;
        
        // Posição do scroll restaurada
      });

    } catch (error) {
      console.error('Erro ao carregar histórico')
    } finally {
      setLoadingOlder(false)
    }
  }

  // =====================================================
  // BUSCAR DADOS DA CONVERSA
  // =====================================================

  const fetchConversation = async () => {
    try {
      // Carregando conversa...
      const conversations = await chatApi.getConversations(companyId, userId, { type: 'all' })
      const conv = conversations.find(c => c.id === conversationId)
      setConversation(conv || null)

      // Carregar foto do contato a partir das informações detalhadas do contato
      if (conv) {
        try {
          const contactInfo = await chatApi.getContactInfo(companyId, conv.contact_phone)
          setContactPhotoUrl(contactInfo?.profile_picture_url || null)
        } catch (error) {
          console.error('Erro ao carregar foto')
          setContactPhotoUrl(null)
        }
      } else {
        setContactPhotoUrl(null)
      }
    } catch (error) {
      console.error('Erro ao carregar conversa')
    }
  }

  // =====================================================
  // ENVIAR MENSAGEM
  // =====================================================

  const handleSendMessage = async (messageForm: SendMessageForm) => {
    if (!messageForm.content.trim() && !messageForm.media_url) return

    // 1. Criar mensagem local imediatamente (UX instantâneo)
    const tempMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      company_id: companyId,
      instance_id: conversation?.instance_id || '',
      message_type: messageForm.message_type,
      content: messageForm.content,
      media_url: messageForm.media_url,
      direction: 'outbound',
      status: 'sending',
      is_scheduled: false,
      sent_by: userId,
      timestamp: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    }

    try {
      setSending(true)
      // Enviando mensagem...
      
      // Adicionar mensagem local imediatamente
      setMessages(prev => {
        // Adicionando mensagem temporária...
        return [...prev, tempMessage]
      })
      
      // 2. Enviar para o banco
      const messageId = await chatApi.sendMessage(conversationId, companyId, messageForm, userId)
      // Mensagem enviada com sucesso
      
      // 3. Atualizar mensagem local com ID real (manter status 'sending')
      setMessages(prev => {
        const updated = prev.map(msg => 
          msg.id === tempMessage.id 
            ? { ...msg, id: messageId } // Não mudar status ainda, aguardar confirmação
            : msg
        )
        // Mensagem atualizada com ID real
        return updated
      })
      
      // 4. Monitorar status da mensagem em tempo real
      const checkStatusInterval = setInterval(async () => {
        try {
          // Verificando status...
          
          // Buscar apenas a mensagem específica para verificar status (usando mensagens recentes)
          const messagesData = await chatApi.getRecentMessages(conversationId, companyId, 50)
          const sentMessage = messagesData?.find(m => m.id === messageId)
          
          if (sentMessage) {
            // Atualizando status...
            
            // Atualizar status na UI se mudou
            setMessages(prev => prev.map(msg => 
              msg.id === messageId 
                ? { ...msg, status: sentMessage.status }
                : msg
            ))
            
            // Se status foi atualizado para 'sent' ou 'failed', parar monitoramento
            if (sentMessage.status === 'sent' || sentMessage.status === 'failed') {
              // Parando monitoramento
              clearInterval(checkStatusInterval)
            }
          }
        } catch (error) {
          console.warn('Erro ao verificar status:', error)
        }
      }, 1000) // Verificar a cada 1 segundo
      
      // Limpar interval após 30 segundos (timeout)
      setTimeout(() => {
        clearInterval(checkStatusInterval)
        // Timeout do monitoramento
      }, 30000)
      
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error)
      // Remover mensagem local em caso de erro
      setMessages(prev => prev.filter(msg => msg.id !== tempMessage.id))
      throw error
    } finally {
      setSending(false)
    }
  }

  // =====================================================
  // EFEITOS
  // =====================================================

  useEffect(() => {
    if (conversationId && companyId) {
      fetchMessages()
      fetchConversation() // CORREÇÃO: Adicionar busca dos dados da conversa para o header
      
      // NOVO: Auto-marcar conversa como lida quando aberta
      // 1. Primeiro: Notificar lista para atualização local otimista (instantânea)
      ChatEventBus.emit('chat:conversation:mark-as-read', {
        conversationId,
        companyId,
        timestamp: new Date()
      })
      
      // 2. Depois: Confirmar no servidor (background)
      chatApi.markConversationAsRead(conversationId, companyId)
        .catch(error => console.warn('Erro ao marcar conversa como lida:', error))
    }
  }, [conversationId, companyId]) // CORREÇÃO: Removido fetchMessages para evitar loop infinito

  // Auto-scroll inteligente: só quando usuário está no final
  useEffect(() => {
    if (isUserAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isUserAtBottom])

  // 🔧 BACKUP: Polling para mensagens recebidas (fallback do realtime)
  useEffect(() => {
    if (!conversationId || !companyId) return

    // Iniciando polling backup...
    
    const pollInterval = setInterval(async () => {
      try {
        // Usar nova API de mensagens recentes para detectar novas mensagens
        const messagesData = await chatApi.getRecentMessages(conversationId, companyId, 10)
        
        setMessages(prev => {
          // Verificar se há mensagens novas
          const newMessages = messagesData?.filter(msg => 
            !prev.some(prevMsg => prevMsg.id === msg.id)
          ) || []
          
          if (newMessages.length > 0) {
            // Novas mensagens detectadas
            
            // Combinar e ordenar
            const allMessages = [...prev, ...newMessages].sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            )
            
            return allMessages
          }
          
          return prev
        })
      } catch (error) {
        console.warn('Erro no polling backup:', error)
      }
    }, 3000) // Polling a cada 3 segundos

    // Cleanup
    return () => {
      // Parando polling backup
      clearInterval(pollInterval)
    }
  }, [conversationId, companyId])

  // ✅ CORREÇÃO: Removido listener de refreshMessages que causava loop
  // O sistema de cache + tempo real agora garante atualizações sem auto-refresh

  // =====================================================
  // SUBSCRIPTION TEMPO REAL OTIMIZADA
  // =====================================================

  // Hook para receber mensagens em tempo real desta conversa
  useConversationRealtime(
    conversationId,
    // Callback para nova mensagem recebida
    (message) => {
      // Nova mensagem recebida
      
      setMessages(prev => {
        // Evitar duplicatas
        if (prev.some(m => m.id === message.id)) {
          // Mensagem duplicada ignorada
          return prev
        }
        
        // Adicionando nova mensagem...
        
        const newMessages = [...prev, message].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        
        return newMessages
      })
    },
    // Callback para status de mensagem atualizado
    (statusUpdate) => {
      // Status atualizado
      
      setMessages(prev => 
        prev.map(m => {
          // Atualizar por ID ou por tempId (para mensagens otimísticas)
          const msg = m as any
          if (m.id === statusUpdate.messageId || msg._tempId === statusUpdate.messageId) {
            return { ...m, status: statusUpdate.status }
          }
          return m
        })
      )
    }
  )

  // ✅ NOVO: Listener para eventos do chat via Event Bus
  useChatEvent(`chat:conversation:${conversationId}:message`, (payload: any) => {
    // Evento de mensagem recebido
    
    if (payload.action === 'insert' && payload.data) {
      setMessages(prev => {
        // Evitar duplicatas
        if (prev.some(m => m.id === payload.data.id)) {
          // Mensagem duplicada ignorada
          return prev
        }
        
        // Adicionando mensagem via EventBus...
        const newMessages = [...prev, payload.data].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        
        return newMessages
      })
    }
  }, [conversationId])

  // ✅ NOVO: Listener para atualizações de status via Event Bus
  useChatEvent(`chat:conversation:${conversationId}:status`, (payload: any) => {
    // Evento de status recebido
    
    if (payload.action === 'update' && payload.data) {
      const { messageId, status } = payload.data
      setMessages(prev => 
        prev.map(m => {
          const msg = m as any
          if (m.id === messageId || msg._tempId === messageId) {
            return { ...m, status }
          }
          return m
        })
      )
    }
  }, [conversationId])

  // Fechar modal com ESC
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showPreviewModal) {
        closePreviewModal()
      }
    }

    if (showPreviewModal) {
      document.addEventListener('keydown', handleEscKey)
      return () => {
        document.removeEventListener('keydown', handleEscKey)
      }
    }
  }, [showPreviewModal])

  // =====================================================
  // DRAG & DROP - IMPLEMENTAÇÃO SEGURA (COMPONENTE PRINCIPAL)
  // =====================================================
  
  // Limites de arquivo (seguros e testados)
  const FILE_LIMITS = {
    image: 5 * 1024 * 1024,    // 5MB
    video: 25 * 1024 * 1024,   // 25MB  
    document: 10 * 1024 * 1024, // 10MB
    audio: 15 * 1024 * 1024     // 15MB
  }
  
  // Função para determinar tipo de arquivo
  const getFileType = (file: File): keyof typeof FILE_LIMITS => {
    const mimeType = file.type.toLowerCase()
    
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    return 'document'
  }
  
  // Validação segura de arquivo
  const validateDroppedFile = (file: File): { valid: boolean; error?: string } => {
    try {
      // Verificar se é realmente um arquivo
      if (!file || !file.name) {
        return { valid: false, error: 'Arquivo inválido' }
      }
      
      // Verificar tamanho
      const fileType = getFileType(file)
      const limit = FILE_LIMITS[fileType]
      
      if (file.size > limit) {
        const limitMB = Math.round(limit / (1024 * 1024))
        return { valid: false, error: `Arquivo muito grande. Limite: ${limitMB}MB` }
      }
      
      return { valid: true }
    } catch (error) {
      console.error('Erro na validação do arquivo:', error)
      return { valid: false, error: 'Erro ao validar arquivo' }
    }
  }
  
  // Event handlers para drag & drop (melhorados)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Verificar se tem arquivos sendo arrastados (detecção melhorada)
    const hasFiles = e.dataTransfer.types.some(type => 
      type === 'Files' || type === 'application/x-moz-file'
    )
    
    if (hasFiles) {
      setIsDragOver(true)
    }
  }
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Só remover se realmente saiu da área (melhorado)
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false)
    }
  }
  
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    
    try {
      const files = Array.from(e.dataTransfer.files)
      
      // Abrir modal para o primeiro arquivo (como WhatsApp Web)
      if (files.length > 0) {
        openPreviewModal(files[0])
      }
    } catch (error) {
      console.error('Erro no drop de arquivos:', error)
    }
  }

  // =====================================================
  // MODAL DE PREVIEW - COMO WHATSAPP WEB
  // =====================================================
  
  // Função para formatar tamanho do arquivo
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
  
  // Fechar modal de preview
  const closePreviewModal = () => {
    setShowPreviewModal(false)
    setCaptionMessage('')
    if (previewFile?.url) {
      URL.revokeObjectURL(previewFile.url) // Limpar memória
    }
    setPreviewFile(null)
  }
  
  // Enviar arquivo com legenda
  const handleSendWithCaption = async () => {
    if (!previewFile || isUploading) return // Prevenir múltiplos cliques
    
    setIsUploading(true) // Ativar loading
    
    try {
      // Upload do arquivo usando a API existente
      const mediaUrl = await chatApi.uploadMedia(previewFile.file, companyId, conversationId)
      
      const mimeType = previewFile.type || ''
      const isImage = mimeType.startsWith('image/')
      const isVideo = mimeType.startsWith('video/')
      
      // Enviar mensagem com legenda usando função existente
      handleSendMessage({
        content: captionMessage.trim() || previewFile.name,
        message_type: isVideo ? 'video' : (isImage ? 'image' : 'document'),
        media_url: mediaUrl
      })
      
      // Fechar modal após sucesso
      closePreviewModal()
    } catch (error) {
      console.error('Erro ao enviar arquivo com legenda:', error)
      alert('Erro ao enviar arquivo. Tente novamente.')
    } finally {
      setIsUploading(false) // Desativar loading
    }
  }
  
  // Modificar processDroppedFile para abrir modal ao invés de enviar diretamente
  const openPreviewModal = (file: File) => {
    // Validar arquivo primeiro
    const validation = validateDroppedFile(file)
    if (!validation.valid) {
      alert(validation.error)
      return
    }
    
    try {
      // Criar URL para preview
      const fileUrl = URL.createObjectURL(file)
      
      // Configurar preview
      // Enviando arquivo...  })
      
      // Abrir modal
      setShowPreviewModal(true)
      setPreviewFile({
        file,
        url: fileUrl,
        name: file.name,
        size: file.size,
        type: file.type
      })
    } catch (error) {
      console.error('Erro ao abrir preview:', error)
      alert('Erro ao processar arquivo.')
    }
  }

  // =====================================================
  // REPRODUÇÃO INLINE DE VÍDEOS
  // =====================================================
  
  // Função para expandir/contrair vídeo no chat
  const toggleVideoExpansion = (messageId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    
    if (expandedVideoId === messageId) {
      // Contrair vídeo
      setExpandedVideoId(null)
    } else {
      // Expandir vídeo (e contrair outros)
      setExpandedVideoId(messageId)
    }
  }

  // =====================================================
  // DETECÇÃO INTELIGENTE DE TIPOS DE MÍDIA
  // =====================================================
  
  // Detectar vídeo por URL (para vídeos recebidos que podem ter tipo incorreto)
  const isVideoUrl = (url: string): boolean => {
    if (!url) return false
    return /\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv)(?:$|[?#])/i.test(url)
  }

  // Detectar imagem por URL
  const isImageUrl = (url: string): boolean => {
    if (!url) return false
    return /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff|ico|heic|heif)(?:$|[?#])/i.test(url)
  }

  // Normalizar tipo de mensagem (unificar enviados e recebidos)
  const getActualMessageType = (message: ChatMessage): string => {
    // Priorizar tipo definido corretamente
    if (message.message_type === 'video' || message.message_type === 'image') {
      return message.message_type
    }
    
    // Detectar por URL se necessário (principalmente para mensagens recebidas)
    if (message.media_url) {
      if (isVideoUrl(message.media_url)) return 'video'
      if (isImageUrl(message.media_url)) return 'image'
    }
    
    return message.message_type
  }

  // Função para obter URL segura de vídeo
  const getSafeVideoUrl = (url: string): string | null => {
    if (!url) return null
    
    try {
      // Validar se é uma URL válida
      new URL(url)
      return url
    } catch (error) {
      console.error('URL de vídeo inválida:', url, error)
      return null
    }
  }

  // Função para tratar erro de vídeo
  const handleVideoError = (messageId: string, error: any) => {
    console.error('Erro ao carregar vídeo:', messageId, error)
    setVideoErrors(prev => new Set(prev).add(messageId))
  }

  // Função para resetar erro de vídeo (quando tentar novamente)
  const resetVideoError = (messageId: string) => {
    setVideoErrors(prev => {
      const newSet = new Set(prev)
      newSet.delete(messageId)
      return newSet
    })
  }

  // =====================================================
  // LOADING STATE
  // =====================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando mensagens...</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div 
      className="flex flex-col h-full relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-300 flex items-center justify-center">
              {contactPhotoUrl ? (
                <img
                  src={contactPhotoUrl}
                  alt={conversation?.contact_name || conversation?.contact_phone || 'Contato'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900 truncate">
                {conversation?.contact_name || conversation?.contact_phone || 'Conversa'}
                {/* NOVO: Empresa na mesma linha com tracinho */}
                {conversation?.company_name && conversation.company_name.trim() !== '' && (
                  <span className="text-sm text-slate-500 font-normal"> - {conversation.company_name}</span>
                )}
              </h3>
              
              {conversation?.contact_name && (
                <p className="text-sm text-gray-600">{conversation.contact_phone}</p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {conversation?.assigned_to && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Atribuída
              </span>
            )}
            
            {/* Botão de Reload para Mensagens */}
            <button 
              onClick={fetchMessages}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
              title="Recarregar mensagens"
            >
              <svg 
                className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            
            <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Overlay de Drag & Drop - Cobertura total como WhatsApp Web */}
      {isDragOver && (
        <div className="absolute inset-0 bg-green-50 bg-opacity-95 border-4 border-dashed border-green-400 flex items-center justify-center z-[9999]">
          <div className="text-center bg-white p-8 rounded-xl shadow-lg border border-green-200">
            <div className="text-6xl mb-4">📎</div>
            <div className="text-green-700 text-2xl font-semibold mb-2">Arraste arquivo aqui</div>
            <div className="text-green-600 text-lg">Imagens, vídeos, documentos e áudios</div>
            <div className="text-green-500 text-sm mt-3">
              Imagens até 5MB • Vídeos até 25MB • Documentos até 10MB
            </div>
          </div>
        </div>
      )}

      {/* Modal de Preview - Como WhatsApp Web */}
      {showPreviewModal && previewFile && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[10000]">
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
            
            {/* Header com botão fechar */}
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-semibold">Enviar arquivo</h3>
              <button 
                onClick={closePreviewModal}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ✕
              </button>
            </div>
            
            {/* Preview da imagem/arquivo */}
            <div className="flex-1 p-4 flex items-center justify-center bg-gray-50 min-h-[300px]">
              {previewFile.type.startsWith('image/') ? (
                <img 
                  src={previewFile.url} 
                  alt="Preview" 
                  className="max-w-full max-h-96 object-contain rounded shadow-lg"
                />
              ) : previewFile.type.startsWith('video/') ? (
                <div className="text-center">
                  <video 
                    src={previewFile.url}
                    controls
                    className="max-w-full max-h-96 rounded shadow-lg bg-black"
                    preload="metadata"
                    style={{ maxHeight: '400px' }}
                  >
                    <p>Seu navegador não suporta reprodução de vídeo.</p>
                  </video>
                  <div className="mt-3">
                    <p className="text-gray-700 font-medium">{previewFile.name}</p>
                    <p className="text-sm text-gray-500">{formatFileSize(previewFile.size)}</p>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-6xl mb-4">📄</div>
                  <p className="text-gray-700 font-medium">{previewFile.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{formatFileSize(previewFile.size)}</p>
                </div>
              )}
            </div>
            
            {/* Campo de mensagem e botão enviar */}
            <div className="p-4 border-t bg-white">
              <div className="flex items-end space-x-3">
                <div className="flex-1">
                  <textarea
                    value={captionMessage}
                    onChange={(e) => setCaptionMessage(e.target.value)}
                    placeholder="Digite uma mensagem"
                    disabled={isUploading}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-green-500 focus:border-green-500 ${
                      isUploading ? 'bg-gray-100 cursor-not-allowed' : ''
                    }`}
                    rows={3}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !isUploading) {
                        e.preventDefault()
                        handleSendWithCaption()
                      }
                    }}
                  />
                </div>
                <button
                  onClick={handleSendWithCaption}
                  disabled={isUploading}
                  className={`p-3 rounded-full transition-colors ${
                    isUploading 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-green-500 hover:bg-green-600 text-white'
                  }`}
                >
                  {isUploading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            
          </div>
        </div>
      )}

      {/* Mensagens */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f5f2eb] relative"
        onScroll={handleScroll}
      >
        {/* Indicador de data flutuante */}
        <DateIndicator date={currentVisibleDate || ''} visible={showDateIndicator} />
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
            </svg>
            <p className="text-gray-600">Nenhuma mensagem ainda</p>
            <p className="text-sm text-gray-500 mt-1">Envie a primeira mensagem para começar a conversa</p>
          </div>
        ) : (
          <>
            {/* Botão "Carregar Mais" no topo */}
            {hasMoreMessages && (
              <div className="text-center py-3 border-b border-gray-200 mb-4">
                <button
                  onClick={loadOlderMessages}
                  disabled={loadingOlder}
                  className="inline-flex items-center px-4 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingOlder ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                      Carregando mensagens...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      Carregar mensagens anteriores
                    </>
                  )}
                </button>
              </div>
            )}
            
            {messages.map((message, index) => (
              <React.Fragment key={message.id}>
                {/* Mensagem com data-attribute para detecção */}
                <div data-message-date={message.timestamp}>
                  <MessageBubble
                    message={message}
                    isOwn={message.direction === 'outbound'}
                    expandedVideoId={expandedVideoId}
                    onToggleVideoExpansion={toggleVideoExpansion}
                    getActualMessageType={getActualMessageType}
                    videoErrors={videoErrors}
                    getSafeVideoUrl={getSafeVideoUrl}
                    onVideoError={handleVideoError}
                    onResetVideoError={resetVideoError}
                    showTimestamp={
                      index === 0 ||
                      (messages[index - 1] && (() => {
                        try {
                          const currentTime = message.timestamp instanceof Date ? 
                            message.timestamp.getTime() : new Date(message.timestamp).getTime()
                          const prevTime = messages[index - 1].timestamp instanceof Date ? 
                            messages[index - 1].timestamp.getTime() : new Date(messages[index - 1].timestamp).getTime()
                          return Math.abs(currentTime - prevTime) > 300000 // 5 minutos
                        } catch (error) {
                          console.warn('⚠️ Erro ao calcular timestamp, mostrando sempre:', error)
                          return true // Mostrar timestamp em caso de erro
                        }
                      })())
                    }
                  />
                </div>
              </React.Fragment>
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white p-4">
        <MessageInput
          onSendMessage={handleSendMessage}
          onPreviewFile={openPreviewModal}
          disabled={sending}
          placeholder="Digite sua mensagem..."
          companyId={companyId}
          conversationId={conversationId}
        />
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE BOLHA DE MENSAGEM
// =====================================================

interface MessageBubbleProps {
  message: ChatMessage
  isOwn: boolean
  showTimestamp?: boolean
  expandedVideoId: string | null
  onToggleVideoExpansion: (messageId: string, event: React.MouseEvent) => void
  getActualMessageType: (message: ChatMessage) => string
  videoErrors: Set<string>
  getSafeVideoUrl: (url: string) => string | null
  onVideoError: (messageId: string, error: any) => void
  onResetVideoError: (messageId: string) => void
}

// Componente para indicador de data flutuante (durante scroll)
const DateIndicator: React.FC<{ date: string; visible: boolean }> = ({ date, visible }) => (
  <div 
    className={`
      absolute top-4 left-1/2 transform -translate-x-1/2 z-10
      bg-black bg-opacity-75 text-white text-xs px-3 py-1 rounded-full
      transition-all duration-200 ease-in-out pointer-events-none
      ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
    `}
  >
    {date}
  </div>
);

// =====================================================
// COMPONENTE PLAYER DE ÁUDIO ESTILO WHATSAPP WEB
// =====================================================

interface AudioWhatsAppPlayerProps {
  message: ChatMessage
  isOwn: boolean
  formatDateTime: (date: Date) => string
  getStatusIcon: (status: ChatMessage['status']) => React.ReactNode
}

const AudioWhatsAppPlayer: React.FC<AudioWhatsAppPlayerProps> = ({
  message,
  isOwn,
  formatDateTime,
  getStatusIcon
}) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Waveform visual - barras com alturas diferentes
  const waveformBars = [3, 6, 4, 8, 5, 7, 3, 6, 4, 8, 5, 7, 4, 6, 3, 5, 8, 4, 6, 2]

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleEnded = () => {
    setIsPlaying(false)
    setCurrentTime(0)
  }

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`rounded-lg p-3 max-w-sm shadow-sm ${
      isOwn ? 'bg-[#dcf8c6]' : 'bg-white border border-gray-200'
    }`}>
      <div className="flex items-center space-x-3">
        {/* Player Controls */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            {/* Play/Pause Button */}
            <button 
              onClick={handlePlayPause}
              className="w-8 h-8 bg-[#34b7f1] hover:bg-[#2da5e0] rounded-full flex items-center justify-center transition-colors"
            >
              {isPlaying ? (
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5.5 3.5A1.5 1.5 0 017 2h6a1.5 1.5 0 011.5 1.5v13a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 16.5v-13z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                </svg>
              )}
            </button>
            
            {/* Waveform Visual */}
            <div className="flex-1 flex items-center space-x-0.5 relative">
              {waveformBars.map((height, index) => {
                const barProgress = (index / waveformBars.length) * 100
                const isActive = barProgress <= progress
                return (
                  <div 
                    key={index}
                    className={`rounded-full transition-colors duration-150 ${
                      isActive ? 'bg-[#34b7f1]' : 'bg-gray-300'
                    }`}
                    style={{
                      width: '3px',
                      height: `${height * 2}px`
                    }}
                  />
                )
              })}
            </div>
          </div>
          
          {/* Duration */}
          <div className="text-xs text-gray-600 mt-1">
            {duration > 0 ? formatTime(duration) : '0:00'}
          </div>
        </div>
        
        {/* Timestamp + Status */}
        <div className="text-xs text-gray-500 text-right flex flex-col items-end">
          <span className="text-[11px]">
            {formatDateTime(message.timestamp)}
          </span>
          {isOwn && (
            <div className="mt-1">
              {getStatusIcon(
                (message.media_url || message.uazapi_message_id) && message.status === 'failed'
                  ? 'sent'
                  : message.status
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Audio element oculto */}
      <audio
        ref={audioRef}
        src={message.media_url}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        preload="metadata"
      />
    </div>
  )
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOwn,
  showTimestamp,
  expandedVideoId,
  onToggleVideoExpansion,
  getActualMessageType,
  videoErrors,
  getSafeVideoUrl,
  onVideoError,
  onResetVideoError
}) => {
  const formatDateTime = (date: Date) => {
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric'
    }) + ' ' + date.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  // Detectar tipo real da mensagem (unificar enviados e recebidos)
  const actualMessageType = getActualMessageType(message)

  const getStatusIcon = (status: ChatMessage['status']) => {
    switch (status) {
      case 'sending':
        return <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
      case 'sent':
        return (
          <div className="flex items-center">
            <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <svg className="w-4 h-4 text-gray-400 -ml-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        )
      case 'delivered':
        return (
          <div className="flex items-center">
            <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <svg className="w-4 h-4 text-blue-500 -ml-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        )
      case 'read':
        return (
          <div className="flex items-center">
            <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <svg className="w-4 h-4 text-green-500 -ml-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        )
      case 'failed':
        return <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      default:
        return null
    }
  }

  const isAudioMessage = (() => {
    if (message.message_type === 'audio') return true
    if (!message.media_url) return false
    return /\.(ogg|mp3|wav)(?:$|[?#])/i.test(message.media_url)
  })()

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-xs lg:max-w-md ${isOwn ? 'order-2' : 'order-1'}`}>
        {showTimestamp && (
          <div className="text-center text-[11px] text-gray-500 mb-2">
            {formatDateTime(message.timestamp)}
          </div>
        )}
        
        {/* Layout especial para mensagens de áudio - Estilo WhatsApp Web */}
        {message.media_url && isAudioMessage ? (
          <AudioWhatsAppPlayer 
            message={message}
            isOwn={isOwn}
            formatDateTime={formatDateTime}
            getStatusIcon={getStatusIcon}
          />
        ) : (
          /* Layout normal para outras mensagens */
          <div
            className={`px-4 py-2 rounded-lg ${
              isOwn
                ? 'bg-[#dcf8c6] text-gray-900'
                : 'bg-white text-gray-900'
            }`}
          >

          {message.media_url && actualMessageType === 'image' && (
            <div className="mb-1">
              <img
                src={`/api/s3-media/${message.media_url.split('/').pop()}`}
                alt={message.content || 'Imagem'}
                className="max-w-xs max-h-64 rounded-md object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => window.open(`/api/s3-media/${message.media_url.split('/').pop()}`, '_blank')}
                onLoad={() => {}}
                onError={() => console.error('Erro ao carregar imagem')}
              />
            </div>
          )}

          {message.media_url && actualMessageType === 'video' && (
            <div className={`mb-1 relative transition-all duration-300 ${
              expandedVideoId === message.id ? 'max-w-md' : 'max-w-xs'
            }`}>
              {!videoErrors.has(message.id) ? (
                <>
                  <video 
                    src={`/api/s3-media/${message.media_url.split('/').pop()}`}
                    className="w-full h-auto rounded-md"
                    preload="metadata"
                    controls={expandedVideoId === message.id}
                    muted={expandedVideoId !== message.id}
                    crossOrigin="anonymous"
                    style={{ 
                      maxHeight: expandedVideoId === message.id ? '300px' : '200px' 
                    }}
                    onError={(e) => onVideoError(message.id, e)}
                    onLoadedMetadata={() => onResetVideoError(message.id)}
                  />
                  
                  {expandedVideoId !== message.id ? (
                    // Overlay de play quando não expandido
                    <div 
                      className="absolute inset-0 flex items-center justify-center cursor-pointer"
                      onClick={(e) => onToggleVideoExpansion(message.id, e)}
                    >
                      <div className="bg-black bg-opacity-50 rounded-full p-3 hover:bg-opacity-70 transition-opacity">
                        <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                        </svg>
                      </div>
                    </div>
                  ) : (
                    // Botão para contrair quando expandido
                    <button
                      onClick={(e) => onToggleVideoExpansion(message.id, e)}
                      className="absolute top-2 right-2 bg-black bg-opacity-50 text-white p-1 rounded-full hover:bg-opacity-70 z-10"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  )}
                </>
              ) : (
                // Placeholder para vídeos com erro
                <div className="w-full h-48 bg-gray-100 rounded-md flex flex-col items-center justify-center border-2 border-dashed border-gray-300">
                  <svg className="w-12 h-12 text-gray-400 mb-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 6a2 2 0 012-2h6l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 11V6m0 8l.01-8M8 8l4-4 4 4"/>
                  </svg>
                  <p className="text-sm text-gray-500 mb-2">Vídeo indisponível</p>
                  <button
                    onClick={() => onResetVideoError(message.id)}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}
            </div>
          )}

          {message.media_url && !isAudioMessage && actualMessageType !== 'image' && actualMessageType !== 'video' && (
            <div className="mb-1">
              <a
                href={`/api/s3-media/${message.media_url.split('/').pop()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 underline"
              >
                {message.content || 'Abrir arquivo'}
              </a>
            </div>
          )}

          {message.content && !isAudioMessage && actualMessageType !== 'image' && actualMessageType !== 'video' && (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          )}
          
          {/* Timestamp para todas as mensagens, layout diferente por tipo */}
          <div className={`flex items-center mt-1 space-x-1 ${
            isOwn ? 'justify-end' : 'justify-start'
          }`}>
            <span className="text-[11px] opacity-75">
              {formatDateTime(message.timestamp)}
            </span>
            {/* Status apenas para mensagens enviadas */}
            {isOwn && getStatusIcon(
              // Tratamento visual: se houver media_url ou uazapi_message_id
              // e o status estiver como failed, exibir como 'sent' em vez de X
              (message.media_url || message.uazapi_message_id) && message.status === 'failed'
                ? 'sent'
                : message.status
            )}
          </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE INPUT DE MENSAGEM
// =====================================================

interface MessageInputProps {
  onSendMessage: (message: SendMessageForm) => void
  onPreviewFile: (file: File) => void
  disabled?: boolean
  placeholder?: string
  companyId: string
  conversationId: string
}

const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  onPreviewFile,
  disabled,
  placeholder = 'Digite sua mensagem...',
  companyId,
  conversationId
}) => {
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const recordingTimerRef = useRef<number | null>(null)
  const shouldSendRef = useRef(true)
  const [isEmojiOpen, setIsEmojiOpen] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!message.trim() || disabled) return

    onSendMessage({
      content: message.trim(),
      message_type: 'text'
    })

    setMessage('')
    setIsEmojiOpen(false)
    
    // Reset textarea height after sending message
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px'
      textareaRef.current.style.overflowY = 'hidden'
    }
  }

  const handleAttachClick = () => {
    if (disabled) return
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      // Usar modal de preview ao invés de enviar diretamente
      onPreviewFile(file)
    } catch (error) {
      console.error('Erro ao processar arquivo:', error)
    } finally {
      // Limpar input para permitir selecionar o mesmo arquivo novamente
      e.target.value = ''
    }
  }

  const handleSelectEmoji = (emoji: string) => {
    if (disabled) return

    const el = textareaRef.current
    const value = message

    if (!el) {
      setMessage(value + emoji)
      return
    }

    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length

    const newValue = value.slice(0, start) + emoji + value.slice(end)
    setMessage(newValue)

    // Reposicionar o cursor após o emoji
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

  const handleToggleRecord = async () => {
    if (disabled) return

    // Iniciar gravação
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)

        recordedChunksRef.current = []
        shouldSendRef.current = true

        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) {
            recordedChunksRef.current.push(event.data)
          }
        }

        recorder.onstop = async () => {
          try {
            if (!shouldSendRef.current) {
              // Cancelado: apenas descartar
              return
            }

            if (recordedChunksRef.current.length === 0) return

            const blob = new Blob(recordedChunksRef.current, { type: 'audio/ogg' })
            const file = new File([blob], `gravacao-${Date.now()}.ogg`, { type: 'audio/ogg' })

            const mediaUrl = await chatApi.uploadMedia(file, companyId, conversationId)

            onSendMessage({
              content: '[áudio]',
              message_type: 'audio',
              media_url: mediaUrl
            })
          } catch (error) {
            console.error('Erro ao processar gravação de áudio:', error)
          } finally {
            // Encerrar uso do microfone
            stream.getTracks().forEach(track => track.stop())
            if (recordingTimerRef.current) {
              window.clearInterval(recordingTimerRef.current)
              recordingTimerRef.current = null
            }
            setIsRecording(false)
          }
        }

        mediaRecorderRef.current = recorder
        recorder.start()
        setIsRecording(true)

        // Iniciar timer de gravação
        setRecordingSeconds(0)
        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current)
        }
        recordingTimerRef.current = window.setInterval(() => {
          setRecordingSeconds((prev) => prev + 1)
        }, 1000)
      } catch (error) {
        console.error('Erro ao acessar microfone:', error)
        setIsRecording(false)
      }
    } else {
      // Parar gravação manualmente (enviar)
      try {
        mediaRecorderRef.current?.stop()
      } catch (error) {
        console.error('Erro ao parar gravação:', error)
      }
    }
  }

  // Função para auto-resize do textarea
  const handleAutoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target
    setMessage(textarea.value)
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto'
    
    // Calculate new height based on content
    const minHeight = 40 // 1 linha
    const maxHeight = 120 // ~6 linhas (como WhatsApp)
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
    
    // Apply new height
    textarea.style.height = `${newHeight}px`
    
    // Show/hide scrollbar based on content
    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflowY = 'auto'
    } else {
      textarea.style.overflowY = 'hidden'
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // Fechar painel de emoji se clicar fora
  useEffect(() => {
    if (!isEmojiOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const pickerEl = emojiPickerRef.current
      if (!pickerEl) return
      if (!pickerEl.contains(event.target as Node)) {
        setIsEmojiOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isEmojiOpen])

  return (
    <form 
      onSubmit={handleSubmit} 
      className="flex items-end space-x-3 relative"
    >
      <div className="flex-1">
        {isRecording && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-gray-100 flex items-center space-x-3">
            {/* Botão cancelar gravação */}
            <button
              type="button"
              onClick={() => {
                shouldSendRef.current = false
                try {
                  mediaRecorderRef.current?.stop()
                } catch (error) {
                  console.error('Erro ao cancelar gravação:', error)
                }
              }}
              className="p-1 rounded-full border border-gray-400 text-gray-600 hover:bg-red-50 hover:text-red-600 hover:border-red-400"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>

            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-medium text-gray-700 min-w-[2.5rem]">
              {`${Math.floor(recordingSeconds / 60)}:${(recordingSeconds % 60)
                .toString()
                .padStart(2, '0')}`}
            </span>
            <div className="flex-1 flex items-end space-x-0.5 h-6">
              {[2,4,1,5,3,6,2,4,5,3,4,2,5,1,3].map((h, i) => (
                <span
                  key={i}
                  className="w-0.5 bg-gray-500 rounded-sm animate-pulse"
                  style={{ height: `${4 + h * 3}px` }}
                />
              ))}
            </div>
          </div>
        )}
        <textarea
          value={message}
          onChange={handleAutoResize}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          ref={textareaRef}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none disabled:opacity-50 overflow-hidden"
          style={{ minHeight: '40px', maxHeight: '120px', height: '40px' }}
        />

        {isEmojiOpen && !disabled && (
          <div
            ref={emojiPickerRef}
            className="absolute bottom-14 left-0 z-40"
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
      {/* Botão de microfone */}
      <button
        type="button"
        onClick={() => !disabled && setIsEmojiOpen((prev) => !prev)}
        className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
        disabled={disabled}
      >
        <span role="img" aria-label="Emoji" className="text-xl">
          😊
        </span>
      </button>

      <button
        type="button"
        onClick={handleToggleRecord}
        disabled={disabled}
        className={`p-2 rounded-lg ${
          isRecording
            ? 'text-red-600 bg-red-50'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
        }`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a2 2 0 00-2 2v5a2 2 0 104 0V4a2 2 0 00-2-2z" />
          <path d="M5 9a5 5 0 0010 0h-1.5a3.5 3.5 0 01-7 0H5z" />
          <path d="M8.5 14h3v2h-3z" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleAttachClick}
        className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        type="submit"
        disabled={!message.trim() || disabled}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  )
}

export default ChatArea
