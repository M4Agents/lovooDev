// =====================================================
// CHAT API - SERVIÇOS ISOLADOS
// =====================================================
// Serviços de API isolados para o sistema de chat
// NÃO MODIFICA api.ts existente

import { supabase } from '../../lib/supabase'
import type {
  ChatConversation,
  ChatMessage,
  MessageReaction,
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
  // Expor cliente Supabase para uso direto quando necessário
  static supabase = supabase

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
  // CONTROLE DE ESTADO IA
  // =====================================================

  static async setAiState(
    conversationId: string,
    companyId: string,
    newState: 'ai_active' | 'ai_paused' | 'ai_inactive'
  ): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Sessão inválida')

    const response = await fetch('/api/chat/set-ai-state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ conversation_id: conversationId, company_id: companyId, new_state: newState })
    })

    const result = await response.json()

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Erro ao alterar estado da IA')
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
    reverseOrder: boolean = false,
    userId?: string
  ): Promise<ChatMessage[]> {
    try {
      // Se limit for 0, usar um número muito alto para "sem limite"
      const effectiveLimit = limit === 0 ? 999999 : limit
      
      // Buscando mensagens...

      const { data, error } = await supabase.rpc('chat_get_messages', {
        p_conversation_id: conversationId,
        p_company_id:      companyId,
        p_limit:           effectiveLimit,
        p_offset:          offset,
        p_reverse_order:   reverseOrder,
        p_user_id:         userId ?? null,
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
    limit: number = 30,
    userId?: string
  ): Promise<ChatMessage[]> {
    // Buscar mensagens mais recentes (ordenação reversa)
    const messages = await this.getMessages(conversationId, companyId, limit, 0, true, userId)
    // Reverter para exibição cronológica (mais antigas no topo)
    return messages.reverse()
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
    userId: string,
    waitForSend: boolean = false  // AUTOMAÇÃO: aguardar envio completo para garantir ordem
  ): Promise<string> {
    const isAutomation = waitForSend;
    try {
      // CORREÇÃO CRÍTICA: Verificar se userId existe na tabela company_users
      const { data: userCheck } = await supabase
        .from('company_users')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

      if (!userCheck) {
        console.error('❌ UserId inválido para esta empresa:', { userId, companyId });
        // Buscar um userId válido como fallback
        const { data: validUsers } = await supabase
          .from('company_users')
          .select('user_id')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .limit(1);
        
        if (!validUsers || validUsers.length === 0) {
          throw new Error('Nenhum usuário válido encontrado para esta empresa');
        }
        
        userId = validUsers[0].user_id;
      }

      // Validação de segurança: conteúdo excessivo seria rejeitado pelo WhatsApp
      // e poderia causar problemas de performance. 5000 chars é bem acima do
      // limite prático do WhatsApp (~4096 chars para texto).
      if (message.content && message.content.length > 5000) {
        throw new Error('Mensagem muito longa. O conteúdo deve ter no máximo 5.000 caracteres.')
      }

      // PASSO 1: Criar mensagem no banco (status: 'sending')
      // chat_messages.content é TEXT (sem limite de chars) após migration 20260523000000.
      const { data, error } = await supabase.rpc('chat_create_message', {
        p_conversation_id:    conversationId,
        p_company_id:         companyId,
        p_content:            message.content,
        p_message_type:       message.message_type,
        p_direction:          'outbound',
        p_sent_by:            userId,
        p_media_url:          message.media_url || null,
        p_reply_to_message_id: message.reply_to_message_id || null,
      })

      if (error) {
        console.error('Erro no envio')
        throw error
      }

      if (!data || !data.success) {
        console.error('❌ RPC falhou:', data);
        throw new Error(data?.error || 'Erro ao criar mensagem')
      }

      // CORREÇÃO CRÍTICA: Retornar message_id do RPC em vez de data vazio
      const messageId = data.message_id || `temp-${Date.now()}`;

      // PASSO 2: Enviar via Uazapi
      if (waitForSend) {
        await this.sendViaUazapiAsync(messageId, companyId, false)
      } else {
        this.sendViaUazapiAsync(messageId, companyId, true).catch(error => {
          console.error('❌ Erro no envio DIRETO via WhatsApp:', {
            message: error.message,
            stack: error.stack,
            messageId
          })
        })
      }

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
   * HÍBRIDO: Suporta envio DIRETO (chat manual) e via ENDPOINT (automação)
   * @param messageId - ID da mensagem
   * @param companyId - ID da empresa
   * @param useDirectSend - true = envio direto (chat manual), false = via endpoint (automação)
   */
  private static async sendViaUazapiAsync(
    messageId: string, 
    companyId: string,
    useDirectSend: boolean = true
  ): Promise<void> {
    try {
      if (useDirectSend) {
        // =====================================================
        // ETAPA 1: Buscar mensagem com RETRY (resolve replication lag)
        // =====================================================
        let messageData = null;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (!messageData && attempts < maxAttempts) {
          attempts++;
          const { data, error } = await supabase
            .from('chat_messages')
            .select(`
              id,
              content,
              message_type,
              media_url,
              conversation_id,
              instance_id,
              reply_to_message_id
            `)
            .eq('id', messageId)
            .eq('company_id', companyId)
            .single();
          
          if (!error && data) {
            messageData = data;
            break;
          }
          
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 50 * attempts));
          }
        }
        
        if (!messageData) {
          console.error('❌ Mensagem não encontrada após 3 tentativas');
          throw new Error('Mensagem não encontrada após múltiplas tentativas');
        }
        
        const { data: conversationData, error: convError } = await supabase
          .from('chat_conversations')
          .select('contact_phone, instance_id')
          .eq('id', messageData.conversation_id)
          .eq('company_id', companyId)
          .single();
        
        if (convError || !conversationData) {
          console.error('❌ Conversa não encontrada:', {
            error: convError,
            errorMessage: convError?.message,
            errorCode: convError?.code,
            conversationId: messageData.conversation_id,
            companyId: companyId
          });
          throw new Error('Conversa não encontrada');
        }
        
        const phone = (conversationData as any).contact_phone;
        const instanceId = (conversationData as any).instance_id;
        
        if (!instanceId) {
          console.error('❌ Conversa sem instância associada');
          throw new Error('Conversa não tem instância associada');
        }
        
        const { data: instance, error: instanceError } = await supabase
          .from('whatsapp_life_instances')
          .select('provider_token, status, deleted_at')
          .eq('id', instanceId)
          .single();
        
        if (instanceError || !instance) {
          console.error('❌ Instância não encontrada:', {
            error: instanceError,
            errorMessage: instanceError?.message,
            errorCode: instanceError?.code,
            instanceId: instanceId
          });
          throw new Error('Instância não encontrada');
        }
        
        // Verificar se instância está ativa
        if (instance.deleted_at !== null) {
          console.error('❌ Instância foi deletada (soft delete):', instance.deleted_at);
          throw new Error('Instância não está mais ativa');
        }
        
        if (instance.status !== 'connected') {
          console.error('❌ Instância não está conectada:', instance.status);
          throw new Error(`Instância não está conectada (status: ${instance.status})`);
        }
        
        const token = instance.provider_token;
        
        if (!token) {
          console.error('❌ Token não encontrado na instância');
          throw new Error('Token da instância não encontrado');
        }

        // Buscar uazapi_message_id da mensagem original para reply (se existir)
        // Filtra por company_id — isolamento multi-tenant obrigatório
        let replyUazapiId: string | null = null;
        if ((messageData as any).reply_to_message_id) {
          try {
            const { data: replyMsg, error: replyErr } = await supabase
              .from('chat_messages')
              .select('uazapi_message_id')
              .eq('id', (messageData as any).reply_to_message_id)
              .eq('company_id', companyId)  // isolamento multi-tenant
              .maybeSingle();               // não lança erro se não encontrar
            if (replyErr) {
              console.warn('[chatApi] Erro ao buscar uazapi_message_id para reply (non-fatal):', replyErr.message);
            } else {
              replyUazapiId = replyMsg?.uazapi_message_id || null;
            }
          } catch (replyLookupErr: any) {
            console.warn('[chatApi] Exceção ao buscar reply uazapi_message_id (non-fatal):', replyLookupErr?.message);
          }
        }

        // 2. Preparar payload para Uazapi
        const endpoint = messageData.message_type === 'text'
          ? 'https://lovoo.uazapi.com/send/text'
          : 'https://lovoo.uazapi.com/send/media';

        const payload = messageData.message_type === 'text'
          ? {
              number: phone,
              text: messageData.content,
              delay: 1000,
              linkPreview: true,
              ...(replyUazapiId ? { replyid: replyUazapiId } : {})
            }
          : {
              number: phone,
              type: messageData.message_type,
              file: messageData.media_url,
              text: messageData.content || '',
              delay: 1000,
              ...(replyUazapiId ? { replyid: replyUazapiId } : {})
            };

        // #region agent log
        if (payload.type && (payload as any).file) {
          console.log('[DBG-56e383][uazapi-media-send]', {
            type:      payload.type,
            fileUrl:   (payload as any).file,
            isDirectS3: String((payload as any).file).includes('.amazonaws.com/') && !String((payload as any).file).includes('X-Amz-Signature'),
            endpoint,
          })
        }
        // #endregion

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'token': token
          },
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        // 4. Atualizar status no banco
        if (response.ok) {
          await supabase
            .from('chat_messages')
            .update({ 
              status: 'sent',
              uazapi_message_id: result.messageid || result.messageId,
              updated_at: new Date().toISOString()
            })
            .eq('id', messageId);
          
        } else {
          console.error('❌ Uazapi rejeitou mensagem:', result);
          await supabase
            .from('chat_messages')
            .update({ 
              status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', messageId);
          
          throw new Error(result.error || 'Falha no envio');
        }
        
        return;
      }

      const payload = {
        message_id: messageId,
        company_id: companyId
      }

      const response = await fetch('/api/uazapi-send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        console.error('❌ Endpoint falhou:', result);
        throw new Error(result.error || 'Falha no envio via endpoint')
      }

    } catch (error) {
      console.error('💥 [sendViaUazapiAsync] Erro no envio:', {
        message: error.message,
        messageId,
        companyId
      });
      
      try {
        await supabase
          .from('chat_messages')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', messageId)
          .eq('company_id', companyId)
      } catch (updateError) {
        console.error('❌ Erro ao atualizar status:', updateError);
      }
      
      throw error;
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
        p_content: message.content,
        p_scheduled_for: scheduledDateTime.toISOString(),
        p_created_by: userId,
        p_message_type: message.message_type || 'text',
        p_media_url: message.media_url || null,
        p_recurring_type: message.recurring_type || 'none',
        p_recurring_config: message.recurring_config ? JSON.stringify(message.recurring_config) : '{}',
        p_cancel_if_lead_replies: message.cancel_if_lead_replies || false,
        p_cancel_scope: message.cancel_scope || 'next_only'
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

      // Sincronizar status em background (não bloqueia)
      this.syncInstancesStatusBackground(companyId)

      return data || []
    } catch (error) {
      console.error('Error fetching company instances:', error)
      throw error
    }
  }

  // =====================================================
  // SINCRONIZAÇÃO DE STATUS EM BACKGROUND
  // =====================================================
  // Data: 24/03/2026
  // Objetivo: Verificar status real das instâncias na uazapi
  // e atualizar banco se houver divergência
  
  private static async syncInstancesStatusBackground(companyId: string): Promise<void> {
    try {
      // Chamar função SQL de sincronização
      const { data, error } = await supabase.rpc('sync_all_instances_status', {
        p_company_id: companyId
      })
      
      if (error) {
        console.warn('[chatApi] Background sync error:', error)
        return
      }

      if (data?.synced_count > 0) {
        // Notificar usuário sobre instâncias desconectadas
        data.updated_instances?.forEach((instance: any) => {
          if (instance.new_status === 'disconnected') {
            // Emitir evento customizado para notificação
            const event = new CustomEvent('whatsapp-instance-disconnected', {
              detail: {
                instanceName: instance.instance_name,
                oldStatus: instance.old_status,
                newStatus: instance.new_status
              }
            })
            window.dispatchEvent(event)
          }
        })
      }
    } catch (error) {
      // Não bloqueia a aplicação se sync falhar
      console.warn('[chatApi] Background sync failed:', error)
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
      lead_id: raw.lead_id,
      assigned_to: raw.assigned_to,
      last_message_at: raw.last_message_at ? new Date(raw.last_message_at) : undefined,
      last_message_content: raw.last_message_content,
      last_message_direction: raw.last_message_direction,
      unread_count: raw.unread_count || 0,
      status: raw.status,
      ai_state: raw.ai_state ?? undefined,
      ai_assignment_id: raw.ai_assignment_id ?? undefined,
      instance_name: raw.instance_name,
      instance_status: raw.instance_status,
      instance_deleted: raw.instance_deleted,
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
      updated_at: new Date(raw.updated_at),
      // Campos de reply
      reply_to_message_id:   raw.reply_to_message_id   || undefined,
      reply_to_content:      raw.reply_to_content       || undefined,
      reply_to_direction:    raw.reply_to_direction     || undefined,
      reply_to_message_type: raw.reply_to_message_type  || undefined,
      // Campos de reação
      reactions:    Array.isArray(raw.reactions) ? (raw.reactions as MessageReaction[]) : undefined,
      my_reaction:  raw.my_reaction  || undefined,
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
      instance_name: raw.instance_name,
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
    conversationId: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    try {
      // Convert File to ArrayBuffer then to Buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      // Import S3Storage statically - dynamic imports don't work well with classes in Vite
      const { S3Storage } = await import('../../services/aws/s3Storage');

      // Detect content type
      const contentType = S3Storage.detectContentType(buffer, file.name);

      // Generate message ID
      const messageId = `frontend-${conversationId}-${Date.now()}`;

      const uploadResult = await S3Storage.uploadToS3({
        companyId: companyId,
        messageId: messageId,
        originalFileName: file.name,
        buffer: buffer,
        contentType: contentType,
        source: 'frontend',
        onProgress: onProgress
      });

      if (!uploadResult.success || !uploadResult.data) {
        console.error('❌ S3 upload failed:', uploadResult.error);
        throw new Error(uploadResult.error || 'S3 upload failed');
      }

      const signedUrlResult = await S3Storage.generateSignedUrl(
        companyId,
        uploadResult.data.s3Key,
        { expiresIn: 7200 } // 2 hours
      );

      if (!signedUrlResult.success || !signedUrlResult.data) {
        console.error('❌ Failed to generate signed URL:', signedUrlResult.error);
        throw new Error(signedUrlResult.error || 'Failed to generate signed URL');
      }

      return signedUrlResult.data;
      
    } catch (error) {
      console.error('❌ S3 upload failed:', error);
      throw new Error(`S3 upload failed: ${error.message}`);
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

  // =====================================================
  // BUSCAR CONVERSA POR LEAD ID
  // =====================================================

  static async getConversationByLeadId(
    leadId: number,
    companyId: string
  ): Promise<string | null> {
    try {
      // 1. Buscar telefone do lead
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('phone')
        .eq('id', leadId)
        .eq('company_id', companyId)
        .single()

      if (leadError || !lead?.phone) {
        return null
      }

      // Limpar telefone (remover caracteres especiais)
      const cleanPhone = lead.phone.replace(/\D/g, '')

      // 2. Buscar conversa diretamente via telefone (chat_conversations usa contact_phone)
      const { data: conversation, error: conversationError } = await supabase
        .from('chat_conversations')
        .select('id')
        .eq('contact_phone', cleanPhone)
        .eq('company_id', companyId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (conversationError || !conversation) {
        return null
      }

      return conversation.id
    } catch (error) {
      console.error('Erro ao buscar conversationId:', error)
      return null
    }
  }

  // =====================================================
  // REAÇÕES EM MENSAGENS
  // =====================================================

  /**
   * Envia ou remove uma reação em uma mensagem inbound via backend.
   * O backend valida multi-tenant (company_id + conversation_id),
   * chama a Uazapi /message/react e persiste via RPC.
   *
   * @param emoji - emoji a reagir; null = remover reação existente
   */
  static async reactToMessage(
    messageId: string,
    conversationId: string,
    companyId: string,
    emoji: string | null
  ): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Sessão inválida')

    const response = await fetch('/api/chat/react-message', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        company_id:      companyId,
        conversation_id: conversationId,
        message_id:      messageId,
        emoji,
      }),
    })

    const result = await response.json().catch(() => ({}))

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Erro ao enviar reação')
    }
  }
}

// Exportar instância padrão
export const chatApi = ChatApi
