// =====================================================
// SERVICE: WHATSAPP SERVICE (AUTOMATION)
// Data: 13/03/2026
// Objetivo: Envio de mensagens WhatsApp via automação
// IMPORTANTE: Não altera sistema existente, apenas adiciona funcionalidade
// =====================================================

import { supabase } from '../../lib/supabase'

interface SendMessageParams {
  phone: string
  message: string
  leadId?: number
  companyId: string
  mediaUrl?: string
  buttons?: Array<{ id: string; text: string }>
}

interface SendMessageResult {
  success: boolean
  messageId?: string
  error?: string
}

export class WhatsAppService {
  private readonly UAZAPI_BASE_URL = 'https://lovoo.uazapi.com'

  /**
   * Envia mensagem de texto via WhatsApp
   */
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    try {
      console.log('📱 WhatsAppService: Enviando mensagem', {
        phone: params.phone,
        hasMedia: !!params.mediaUrl,
        hasButtons: !!params.buttons
      })

      // Validações
      if (!params.phone) {
        return { success: false, error: 'Telefone não informado' }
      }

      if (!params.message && !params.mediaUrl) {
        return { success: false, error: 'Mensagem ou mídia obrigatória' }
      }

      // Formatar telefone (remover caracteres especiais)
      const cleanPhone = this.cleanPhone(params.phone)

      // Buscar conversation_id via lead (evita RLS em chat_conversations)
      let conversationId: string | null = null
      
      if (params.leadId) {
        // Buscar via lead_id se disponível
        const { data: contact } = await supabase
          .from('chat_contacts')
          .select('conversation_id')
          .eq('lead_id', params.leadId)
          .eq('company_id', params.companyId)
          .single()
        
        conversationId = contact?.conversation_id || null
      }
      
      // Se não encontrou via lead, buscar via telefone
      if (!conversationId) {
        const { data: contact } = await supabase
          .from('chat_contacts')
          .select('conversation_id')
          .eq('phone', cleanPhone)
          .eq('company_id', params.companyId)
          .single()
        
        conversationId = contact?.conversation_id || null
      }

      if (!conversationId) {
        console.error('❌ Conversa não encontrada para telefone:', cleanPhone)
        return {
          success: false,
          error: 'Conversa não encontrada. O contato precisa ter enviado uma mensagem primeiro.'
        }
      }

      // Criar mensagem no banco via RPC
      const { data: messageData, error: messageError } = await supabase.rpc('chat_create_message', {
        p_conversation_id: conversationId,
        p_company_id: params.companyId,
        p_content: params.message,
        p_message_type: params.mediaUrl ? 'image' : 'text',
        p_direction: 'outbound',
        p_sent_by: params.companyId, // Usar companyId como fallback
        p_media_url: params.mediaUrl || null
      })

      if (messageError || !messageData?.success) {
        console.error('❌ Erro ao criar mensagem:', messageError)
        return {
          success: false,
          error: messageError?.message || 'Erro ao criar mensagem'
        }
      }

      const messageId = messageData.message_id

      // Enviar via endpoint interno (mesmo que o chat usa)
      const response = await fetch('/api/uazapi-send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message_id: messageId,
          company_id: params.companyId
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('❌ Erro ao enviar mensagem:', errorData)
        return {
          success: false,
          error: errorData.error || 'Erro ao enviar mensagem'
        }
      }

      const data = await response.json()
      console.log('✅ Mensagem enviada com sucesso:', messageId)

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
   * Salva mensagem no histórico (opcional)
   */
  private async saveMessageToHistory(params: SendMessageParams): Promise<void> {
    try {
      // Buscar conversation_id do lead
      const { data: contact } = await supabase
        .from('chat_contacts')
        .select('conversation_id')
        .eq('lead_id', params.leadId)
        .eq('company_id', params.companyId)
        .single()

      if (!contact) {
        console.warn('Contato não encontrado para lead:', params.leadId)
        return
      }

      // Salvar mensagem
      await supabase.from('chat_messages').insert({
        conversation_id: contact.conversation_id,
        company_id: params.companyId,
        message_text: params.message,
        from_me: true,
        message_type: params.mediaUrl ? 'image' : 'text',
        media_url: params.mediaUrl,
        timestamp: new Date().toISOString(),
        status: 'sent'
      })

      console.log('✅ Mensagem salva no histórico')
    } catch (error) {
      console.error('Erro ao salvar mensagem no histórico:', error)
      // Não falhar a execução se não conseguir salvar no histórico
    }
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
