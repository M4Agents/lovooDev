// =====================================================
// SERVICE: WEBHOOK SERVICE
// Data: 19/03/2026
// Objetivo: Enviar webhooks para URLs externas (versão minimalista)
// =====================================================

interface ExecutionContext {
  executionId: string
  flowId: string
  companyId: string
  triggerData: Record<string, any>
  variables: Record<string, any>
  leadId?: number
  opportunityId?: string
}

interface WebhookResult {
  success: boolean
  status: number
  data?: any
  error?: string
}

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname
    const blocked = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^169\.254\./,
    ]
    return !blocked.some(r => r.test(hostname))
  } catch {
    return false
  }
}

export class WebhookService {
  /**
   * Envia webhook para URL externa
   * @param url - URL de destino
   * @param payload - Dados a serem enviados
   * @param authToken - Token de autenticação (opcional)
   */
  async sendWebhook(
    url: string,
    payload: any,
    authToken?: string
  ): Promise<WebhookResult> {
    if (!isUrlAllowed(url)) {
      console.warn('⛔ Webhook bloqueado — URL inválida ou não permitida:', url)
      return {
        success: false,
        status: 0,
        error: 'URL de destino inválida'
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }

    try {
      console.log('🌐 Enviando webhook:', { url, hasAuth: !!authToken })

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000) // 30 segundos timeout
      })

      const responseData = await response.json().catch(() => null)

      if (!response.ok) {
        console.error('❌ Webhook falhou:', response.status, response.statusText)
        return {
          success: false,
          status: response.status,
          error: `HTTP ${response.status}: ${response.statusText}`,
          data: responseData
        }
      }

      console.log('✅ Webhook enviado com sucesso:', response.status)
      return {
        success: true,
        status: response.status,
        data: responseData
      }
    } catch (error: any) {
      console.error('❌ Erro ao enviar webhook:', error)
      return {
        success: false,
        status: 0,
        error: error.message || 'Erro desconhecido'
      }
    }
  }

  /**
   * Constrói payload padrão com todos os dados disponíveis
   * @param context - Contexto de execução
   */
  buildPayload(context: ExecutionContext): any {
    return {
      event_type: context.triggerData.type || 'unknown',
      timestamp: new Date().toISOString(),
      company_id: context.companyId,
      execution_id: context.executionId,
      flow_id: context.flowId,
      lead: context.triggerData.lead || null,
      opportunity: context.triggerData.opportunity || null,
      trigger_data: context.triggerData,
      variables: context.variables || {}
    }
  }
}

// Exportar instância singleton
export const webhookService = new WebhookService()
