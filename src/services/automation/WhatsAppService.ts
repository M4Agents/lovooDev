// =====================================================
// SERVICE: WHATSAPP SERVICE (AUTOMATION)
// Data: 13/03/2026
// Objetivo: Envio de mensagens WhatsApp via automação
// IMPORTANTE: Usa infraestrutura de chat existente (RLS-safe)
// =====================================================

import { supabase } from '../../lib/supabase'
import { ChatApi } from '../chat/chatApi'

interface SendMessageParams {
  phone: string
  message: string
  leadId?: number
  companyId: string
  conversationId?: string  // Conversation ID se já disponível (mais eficiente)
  mediaUrl?: string
  messageType?: string  // Tipo de mensagem (text, image, video, audio, document) - opcional para retrocompatibilidade
  buttons?: Array<{ id: string; text: string }>
}

interface SendMessageResult {
  success: boolean
  messageId?: string
  error?: string
}

export class WhatsAppService {
  /**
   * Envia mensagem de texto via WhatsApp
   * Usa chatApi.sendMessage que já funciona com RLS via SECURITY DEFINER
   */
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    try {
      console.log('📱 WhatsAppService: Enviando mensagem', {
        phone: params.phone,
        hasMedia: !!params.mediaUrl,
        hasButtons: !!params.buttons,
        hasConversationId: !!params.conversationId
      })

      // Validações
      if (!params.phone) {
        return { success: false, error: 'Telefone não informado' }
      }

      if (!params.message && !params.mediaUrl) {
        return { success: false, error: 'Mensagem ou mídia obrigatória' }
      }

      // Se conversationId foi fornecido, usar diretamente (mais eficiente)
      if (params.conversationId) {
        console.log('✅ Usando conversationId fornecido:', params.conversationId)
        
        // Determinar message_type: usar fornecido ou fallback para retrocompatibilidade
        const messageType = params.messageType || (params.mediaUrl ? 'image' : 'text')
        
        const messageId = await ChatApi.sendMessage(
          params.conversationId,
          params.companyId,
          {
            content: params.message,
            message_type: messageType,
            media_url: params.mediaUrl
          },
          params.companyId
        )

        console.log('✅ Mensagem enviada com sucesso via chatApi:', messageId)

        return {
          success: true,
          messageId: messageId
        }
      }

      // Fallback: buscar conversationId se não foi fornecido
      console.warn('⚠️ conversationId não fornecido, buscando via telefone (menos eficiente)')
      
      const cleanPhone = this.cleanPhone(params.phone)

      // Buscar conversa via RPC (RLS-safe)
      const { data: conversations, error: convError } = await supabase.rpc('chat_get_conversations', {
        p_company_id: params.companyId,
        p_user_id: params.companyId,
        p_filter_type: 'all',
        p_instance_id: null,
        p_limit: 1000,
        p_offset: 0
      })

      if (convError || !conversations?.success) {
        console.error('❌ Erro ao buscar conversas:', convError)
        return {
          success: false,
          error: 'Erro ao buscar conversas'
        }
      }

      // Encontrar conversa do telefone
      const conversation = conversations.data?.find((c: any) => 
        c.contact_phone === cleanPhone || c.contact_phone === params.phone
      )

      if (!conversation) {
        console.error('❌ Conversa não encontrada para telefone:', cleanPhone)
        return {
          success: false,
          error: 'Conversa não encontrada. O contato precisa ter enviado uma mensagem primeiro.'
        }
      }

      // Determinar message_type: usar fornecido ou fallback para retrocompatibilidade
      const messageType = params.messageType || (params.mediaUrl ? 'image' : 'text')
      
      // Usar chatApi.sendMessage (RLS-safe via SECURITY DEFINER)
      const messageId = await ChatApi.sendMessage(
        conversation.id,
        params.companyId,
        {
          content: params.message,
          message_type: messageType,
          media_url: params.mediaUrl
        },
        params.companyId
      )

      console.log('✅ Mensagem enviada com sucesso via chatApi:', messageId)

      return {
        success: true,
        messageId: messageId
      }
    } catch (error: any) {
      console.error('❌ Erro ao enviar mensagem WhatsApp:', error)
      return {
        success: false,
        error: error.message || 'Erro desconhecido'
      }
    }
  }

  /**
   * Substitui variáveis na mensagem
   * Exemplo: "Olá {nome}" -> "Olá João"
   */
  replaceVariables(message: string, variables: Record<string, any>): string {
    let result = message

    // Substituir variáveis no formato {variavel}
    Object.keys(variables).forEach((key) => {
      const regex = new RegExp(`\\{${key}\\}`, 'g')
      result = result.replace(regex, variables[key] || '')
    })

    return result
  }

  /**
   * Busca dados do lead para usar como variáveis
   */
  async getLeadVariables(leadId: number): Promise<Record<string, any>> {
    try {
      const { data: lead, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single()

      if (error || !lead) {
        console.warn('Lead não encontrado:', leadId)
        return {}
      }

      // Retornar variáveis disponíveis
      return {
        nome: lead.name || '',
        email: lead.email || '',
        telefone: lead.phone || '',
        empresa: lead.company || '',
        cidade: lead.city || '',
        estado: lead.state || ''
      }
    } catch (error) {
      console.error('Erro ao buscar variáveis do lead:', error)
      return {}
    }
  }

  /**
   * Limpa telefone removendo caracteres especiais
   */
  private cleanPhone(phone: string): string {
    // Remove tudo exceto números
    let clean = phone.replace(/\D/g, '')

    // Se não tem código do país, adiciona 55 (Brasil)
    if (!clean.startsWith('55') && clean.length <= 11) {
      clean = '55' + clean
    }

    return clean
  }

  /**
   * Verifica se um número de telefone é válido
   */
  isValidPhone(phone: string): boolean {
    const clean = this.cleanPhone(phone)
    // Telefone brasileiro: 55 + DDD (2 dígitos) + número (8 ou 9 dígitos)
    return clean.length >= 12 && clean.length <= 13
  }
}

// Exportar instância singleton
export const whatsAppService = new WhatsAppService()
