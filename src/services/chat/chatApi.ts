// =====================================================
// CHAT API - SERVIÇOS ISOLADOS
// =====================================================
// Serviços de API isolados para o sistema de chat
// NÃO MODIFICA api.ts existente

import { supabase } from '../../lib/supabase'
import type {
  ChatConversation,
  ChatMessage,
  ChatContact,
  ChatScheduledMessage,
  ConversationFilter,
  SendMessageForm,
  ScheduleMessageForm,
  ContactInfoForm
} from '../../types/whatsapp-chat'

// =====================================================
// CLASSE PRINCIPAL DA API DO CHAT
// =====================================================

export class ChatApi {
  // =====================================================
  // CONVERSAS
  // =====================================================

  static async getConversations(
    companyId: string,
    userId: string,
    filter: ConversationFilter,
    instanceId?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ChatConversation[]> {
    try {
      const { data, error } = await supabase.rpc('chat_get_conversations', {
        p_company_id: companyId,
        p_user_id: userId,
        p_filter_type: filter.type,
        p_instance_id: instanceId || null,
        p_limit: limit,
        p_offset: offset
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao buscar conversas')
      }

      return (data.data || []).map(this.mapConversation)
    } catch (error) {
      console.error('Error fetching conversations:', error)
      throw error
    }
  }

  static async createOrGetConversation(
    companyId: string,
    instanceId: string,
    contactPhone: string,
    contactName?: string
  ): Promise<ChatConversation> {
    try {
      const { data, error } = await supabase.rpc('chat_create_or_get_conversation', {
        p_company_id: companyId,
        p_instance_id: instanceId,
        p_contact_phone: contactPhone,
        p_contact_name: contactName || null
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao criar/buscar conversa')
      }

      return this.mapConversation(data.data)
    } catch (error) {
      console.error('Error creating/getting conversation:', error)
      throw error
    }
  }

  static async assignConversation(
    conversationId: string,
    assignedTo: string,
    assignedBy: string
  ): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('chat_assign_conversation', {
        p_conversation_id: conversationId,
        p_assigned_to: assignedTo,
        p_assigned_by: assignedBy
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao atribuir conversa')
      }
    } catch (error) {
      console.error('Error assigning conversation:', error)
      throw error
    }
  }

  static async markConversationAsRead(
    conversationId: string,
    companyId: string
  ): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('chat_mark_conversation_as_read', {
        p_conversation_id: conversationId,
        p_company_id: companyId
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao marcar conversa como lida')
      }
    } catch (error) {
      console.error('Error marking conversation as read:', error)
      throw error
    }
  }

  // =====================================================
  // MENSAGENS
  // =====================================================

  static async getMessages(
    conversationId: string,
    companyId: string,
    limit: number = 0, // 0 = sem limite por padrão
    offset: number = 0,
    reverseOrder: boolean = false // NOVO: ordenação reversa
  ): Promise<ChatMessage[]> {
    try {
      // Se limit for 0, usar um número muito alto para "sem limite"
      const effectiveLimit = limit === 0 ? 999999 : limit
      
      // Buscando mensagens...

      const { data, error } = await supabase.rpc('chat_get_messages', {
        p_conversation_id: conversationId,
        p_company_id: companyId,
        p_limit: effectiveLimit,
        p_offset: offset,
        p_reverse_order: reverseOrder
      })

      // Processando resultado...

      if (error) {
        console.error('Erro na consulta')
        throw error
      }

      if (!data.success) {
        throw new Error(data.error || 'Erro ao buscar mensagens')
      }

      const rawMessages = data.data || []
      const mappedMessages = rawMessages.map(this.mapMessage)
      
      // Mensagens processadas com sucesso

      return mappedMessages
    } catch (error) {
      console.error('Erro ao buscar mensagens')
      throw error
    }
  }

  // =====================================================
  // MÉTODOS DE PAGINAÇÃO PARA CHAT MODERNO
  // =====================================================

  static async getRecentMessages(
    conversationId: string,
    companyId: string,
    limit: number = 30
  ): Promise<ChatMessage[]> {
    // Carregando mensagens recentes...

    // Buscar mensagens mais recentes (ordenação reversa)
    const messages = await this.getMessages(conversationId, companyId, limit, 0, true)
    
    // Reverter ordem para exibir cronologicamente (mais antigas no topo)
    const sortedMessages = messages.reverse()
    
    // Mensagens recentes carregadas

    return sortedMessages
  }

  static async getOlderMessages(
    conversationId: string,
    companyId: string,
    beforeTimestamp: Date,
    limit: number = 20
  ): Promise<ChatMessage[]> {
    // Carregando mensagens antigas...

    try {
      // Buscar mensagens anteriores ao timestamp fornecido
      const { data, error } = await supabase.rpc('chat_get_messages_before_timestamp', {
        p_conversation_id: conversationId,
        p_company_id: companyId,
        p_before_timestamp: beforeTimestamp.toISOString(),
        p_limit: limit
      })

      if (error) {
        console.error('Erro na consulta de histórico')
        throw error
      }

      if (!data.success) {
        throw new Error(data.error || 'Erro ao buscar mensagens antigas')
      }

      const rawMessages = data.data || []
      const mappedMessages = rawMessages.map(this.mapMessage)
      
      // Mensagens antigas carregadas

      return mappedMessages
    } catch (error) {
      console.error('Erro ao carregar histórico')
      throw error
    }
  }

  static async sendMessage(
    conversationId: string,
    companyId: string,
    message: SendMessageForm,
    userId: string
  ): Promise<string> {
    try {
      // Enviando mensagem...

      // PASSO 1: Criar mensagem no banco (status: 'sending')
      const { data, error } = await supabase.rpc('chat_create_message', {
        p_conversation_id: conversationId,
        p_company_id: companyId,
        p_content: message.content,
        p_message_type: message.message_type,
        p_direction: 'outbound',
        p_sent_by: userId,
        p_media_url: message.media_url || null
      })

      // Processando envio...

      if (error) {
        console.error('Erro no envio')
        throw error
      }

      if (!data.success) {
        throw new Error(data.error || 'Erro ao criar mensagem')
      }

      const messageId = data.message_id
      // Mensagem criada no banco

      // PASSO 2: Enviar via Uazapi de forma assíncrona (não bloqueia UI)
      this.sendViaUazapiAsync(messageId, companyId).catch(error => {
        console.error('Erro no envio via WhatsApp')
        // Erro será tratado pela função SQL que atualiza status para 'failed'
      })

      // ✅ CORREÇÃO: Removido auto-refresh que causava loop e experiência ruim
      // O sistema de cache agora garante que mensagens permaneçam visíveis

      // Envio concluído
      return messageId
    } catch (error) {
      console.error('Erro no envio da mensagem')
      throw error
    }
  }

  /**
   * FUNÇÃO ISOLADA: Envio via Uazapi de forma assíncrona
   * Não afeta o fluxo principal do sistema
   */
  private static async sendViaUazapiAsync(messageId: string, companyId: string): Promise<void> {
    try {
      // Enviando via WhatsApp...

      const payload = {
        message_id: messageId,
        company_id: companyId
      }
      // Preparando envio...

      // Conectando com API...
      const response = await fetch('/api/uazapi-send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      })

      // Processando resposta...

      const result = await response.json()
      // Analisando resultado...

      if (!response.ok || !result.success) {
        console.error('Falha no envio via WhatsApp')
        throw new Error(result.error || 'Falha no envio')
      }

      // Mensagem enviada com sucesso
      
      // 🔧 CORREÇÃO: Atualizar status no banco para 'sent'
      try {
        // Atualizando status para enviado...
        const { error: updateError } = await supabase
          .from('chat_messages')
          .update({ 
            status: 'sent',
            updated_at: new Date().toISOString()
          })
          .eq('id', messageId)
          .eq('company_id', companyId)
        
        if (updateError) {
          console.error('Erro ao atualizar status')
        } else {
          // Status atualizado para enviado
        }
      } catch (updateError) {
        console.error('Erro ao atualizar status')
      }
      
    } catch (error) {
      console.error('Erro no envio via WhatsApp')
      
      // 🔧 CORREÇÃO: Atualizar status no banco para 'failed' em caso de erro
      try {
        // Atualizando status para falha...
        await supabase
          .from('chat_messages')
          .update({ 
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', messageId)
          .eq('company_id', companyId)
        
        // Status atualizado para falha
      } catch (updateError) {
        console.error('Erro ao atualizar status de falha')
      }
      
      throw error
    }
  }

  static async receiveMessage(
    conversationId: string,
    companyId: string,
    content: string,
    messageType: string = 'text',
    mediaUrl?: string,
    uazapiMessageId?: string
  ): Promise<string> {
    try {
      const { data, error } = await supabase.rpc('chat_create_message', {
        p_conversation_id: conversationId,
        p_company_id: companyId,
        p_content: content,
        p_message_type: messageType,
        p_direction: 'inbound',
        p_sent_by: null,
        p_media_url: mediaUrl || null
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao receber mensagem')
      }

      // Atualizar com ID do Uazapi se fornecido
      if (uazapiMessageId && data.message_id) {
        await supabase
          .from('chat_messages')
          .update({ uazapi_message_id: uazapiMessageId })
          .eq('id', data.message_id)
      }

      return data.message_id
    } catch (error) {
      console.error('Error receiving message:', error)
      throw error
    }
  }

  // =====================================================
  // MENSAGENS AGENDADAS
  // =====================================================

  static async scheduleMessage(
    conversationId: string,
    companyId: string,
    instanceId: string,
    userId: string,
    message: ScheduleMessageForm
  ): Promise<string> {
    try {
      // Combinar data e hora
      const scheduledDateTime = new Date(`${message.scheduled_date}T${message.scheduled_time}`)

      const { data, error } = await supabase.rpc('chat_schedule_message', {
        p_conversation_id: conversationId,
        p_company_id: companyId,
        p_instance_id: instanceId,
        p_created_by: userId,
        p_content: message.content,
        p_scheduled_for: scheduledDateTime.toISOString(),
        p_message_type: message.message_type,
        p_media_url: message.media_url || null,
        p_recurring_type: message.recurring_type,
        p_recurring_config: message.recurring_config || {}
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao agendar mensagem')
      }

      return data.scheduled_id
    } catch (error) {
      console.error('Error scheduling message:', error)
      throw error
    }
  }

  static async getScheduledMessages(
    companyId: string,
    conversationId?: string,
    status?: string
  ): Promise<ChatScheduledMessage[]> {
    try {
      const { data, error } = await supabase.rpc('chat_get_scheduled_messages', {
        p_company_id: companyId,
        p_conversation_id: conversationId || null,
        p_status: status || null
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao buscar mensagens agendadas')
      }

      return (data.data || []).map(this.mapScheduledMessage)
    } catch (error) {
      console.error('Error fetching scheduled messages:', error)
      throw error
    }
  }

  static async cancelScheduledMessage(
    messageId: string,
    companyId: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('chat_scheduled_messages')
        .update({ 
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', messageId)
        .eq('company_id', companyId)

      if (error) throw error
    } catch (error) {
      console.error('Error cancelling scheduled message:', error)
      throw error
    }
  }

  // =====================================================
  // CONTATOS/LEADS
  // =====================================================

  static async getContactInfo(
    companyId: string,
    phoneNumber: string
  ): Promise<ChatContact | null> {
    try {
      const { data, error } = await supabase.rpc('chat_get_contact_info', {
        p_company_id: companyId,
        p_phone_number: phoneNumber
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao buscar informações do contato')
      }

      return data.data ? this.mapContact(data.data) : null
    } catch (error) {
      console.error('Error fetching contact info:', error)
      throw error
    }
  }

  static async updateContactInfo(
    companyId: string,
    phoneNumber: string,
    contactData: ContactInfoForm
  ): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('chat_update_contact_info', {
        p_company_id: companyId,
        p_phone_number: phoneNumber,
        p_data: contactData
      })

      if (error) throw error

      if (!data.success) {
        throw new Error(data.error || 'Erro ao atualizar informações do contato')
      }
    } catch (error) {
      console.error('Error updating contact info:', error)
      throw error
    }
  }

  // =====================================================
  // INTEGRAÇÃO COM WHATSAPP LIFE (READ-ONLY)
  // =====================================================

  static async getCompanyInstances(companyId: string) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_life_instances')
        .select('*')
        .eq('company_id', companyId)
        .eq('status', 'connected')
        .order('created_at', { ascending: false })

      if (error) throw error

      return data || []
    } catch (error) {
      console.error('Error fetching company instances:', error)
      throw error
    }
  }

  static async validateInstanceAccess(
    instanceId: string,
    companyId: string
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('whatsapp_life_instances')
        .select('company_id')
        .eq('id', instanceId)
        .single()

      if (error) return false

      return data?.company_id === companyId
    } catch (error) {
      console.error('Error validating instance access:', error)
      return false
    }
  }

  // =====================================================
  // UTILITÁRIOS DE MAPEAMENTO
  // =====================================================

  private static mapConversation(raw: any): ChatConversation {
    return {
      id: raw.id,
      company_id: raw.company_id,
      instance_id: raw.instance_id,
      contact_phone: raw.contact_phone,
      contact_name: raw.contact_name,
      profile_picture_url: raw.profile_picture_url,
      company_name: raw.company_name,  // NOVO: nome da empresa do lead
      assigned_to: raw.assigned_to,
      last_message_at: raw.last_message_at ? new Date(raw.last_message_at) : undefined,
      last_message_content: raw.last_message_content,
      last_message_direction: raw.last_message_direction,
      unread_count: raw.unread_count || 0,
      status: raw.status,
      instance_name: raw.instance_name,
      created_at: new Date(raw.created_at),
      updated_at: new Date(raw.updated_at)
    }
  }

  private static mapMessage(raw: any): ChatMessage {
    return {
      id: raw.id,
      conversation_id: raw.conversation_id,
      company_id: raw.company_id,
      instance_id: raw.instance_id,
      message_type: raw.message_type,
      content: raw.content,
      media_url: raw.media_url,
      direction: raw.direction,
      status: raw.status,
      is_scheduled: raw.is_scheduled,
      scheduled_for: raw.scheduled_for ? new Date(raw.scheduled_for) : undefined,
      sent_by: raw.sent_by,
      uazapi_message_id: raw.uazapi_message_id,
      timestamp: new Date(raw.timestamp),
      created_at: new Date(raw.created_at),
      updated_at: new Date(raw.updated_at)
    }
  }

  private static mapContact(raw: any): ChatContact {
    return {
      id: raw.id,
      company_id: raw.company_id,
      phone_number: raw.phone_number,
      name: raw.name,
      email: raw.email,
      profile_picture_url: raw.profile_picture_url,
      lead_source: raw.lead_source,
      lead_status: raw.lead_status,
      deal_value: raw.deal_value,
      first_contact_at: raw.first_contact_at ? new Date(raw.first_contact_at) : undefined,
      last_activity_at: raw.last_activity_at ? new Date(raw.last_activity_at) : undefined,
      total_messages: raw.total_messages || 0,
      notes: raw.notes,
      tags: raw.tags || [],
      custom_fields: raw.custom_fields || {},
      created_at: new Date(raw.created_at),
      updated_at: new Date(raw.updated_at)
    }
  }

  private static mapScheduledMessage(raw: any): ChatScheduledMessage {
    return {
      id: raw.id,
      conversation_id: raw.conversation_id,
      company_id: raw.company_id,
      instance_id: raw.instance_id,
      created_by: raw.created_by,
      message_type: raw.message_type,
      content: raw.content,
      media_url: raw.media_url,
      scheduled_for: new Date(raw.scheduled_for),
      status: raw.status,
      recurring_type: raw.recurring_type,
      recurring_config: raw.recurring_config || {},
      sent_at: raw.sent_at ? new Date(raw.sent_at) : undefined,
      error_message: raw.error_message,
      created_at: new Date(raw.created_at),
      updated_at: new Date(raw.updated_at),
      contact_phone: raw.contact_phone,
      contact_name: raw.contact_name
    }
  }

  // =====================================================
  // UTILITÁRIOS PARA UPLOAD DE MÍDIA
  // =====================================================

  static async uploadMedia(
    file: File,
    companyId: string,
    conversationId: string
  ): Promise<string> {
    try {
      console.log('🚀 Uploading media via S3 endpoint:', { 
        fileName: file.name, 
        size: file.size,
        companyId,
        conversationId 
      });
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('companyId', companyId);
      formData.append('conversationId', conversationId);
      
      const response = await fetch('/api/upload-media', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ S3 upload failed:', response.status, errorText);
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        console.error('❌ S3 upload error:', result.error);
        throw new Error(result.error || 'Upload failed');
      }
      
      console.log('✅ S3 upload successful:', {
        url: result.url.substring(0, 100) + '...',
        metadata: result.metadata
      });
      
      return result.url;
      
    } catch (error) {
      console.error('❌ S3 upload failed, using fallback:', error);
      
      // FALLBACK: Usar Supabase Storage em caso de erro S3
      try {
        console.log('🔄 Fallback: Usando Supabase Storage');
        
        const fileExt = file.name.split('.').pop();
        const fileName = `${companyId}/${conversationId}/${Date.now()}.${fileExt}`;

        const { error } = await supabase.storage
          .from('chat-media')
          .upload(fileName, file);

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from('chat-media')
          .getPublicUrl(fileName);

        console.log('✅ Fallback Supabase upload successful');
        return publicUrl;
        
      } catch (fallbackError) {
        console.error('❌ Fallback também falhou:', fallbackError);
        throw fallbackError;
      }
    }
  }

  // =====================================================
  // UTILITÁRIOS PARA NOTIFICAÇÕES EM TEMPO REAL
  // =====================================================

  static subscribeToConversations(
    companyId: string,
    callback: (payload: any) => void
  ) {
    return supabase
      .channel(`chat_conversations:${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_conversations',
          filter: `company_id=eq.${companyId}`
        },
        callback
      )
      .subscribe()
  }

  static subscribeToMessages(
    conversationId: string,
    callback: (payload: any) => void
  ) {
    return supabase
      .channel(`chat_messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        callback
      )
      .subscribe()
  }
}

// Exportar instância padrão
export const chatApi = ChatApi
