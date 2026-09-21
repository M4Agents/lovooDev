// =============================================================================
// META WHATSAPP — SERVICE FRONTEND
//
// Endpoints consumidos:
//   GET  /api/whatsapp/meta/instances?company_id=<uuid>
//   POST /api/whatsapp/meta/onboarding/start
//   POST /api/whatsapp/meta/onboarding/complete
//
// Autenticação: Bearer JWT via supabase.auth.getSession().
//
// Segurança:
//   - Nenhum service_role, META_APP_SECRET ou META_TOKEN_ENC_KEY no frontend
//   - Nenhuma variável VITE_META_* — App ID/Config ID vêm da resposta do start
//   - company_id enviado somente em getInstances e startOnboarding
//   - completeOnboarding NÃO envia company_id (backend usa JWT/guard)
//   - Nenhum acesso direto às tabelas Supabase Meta
//   - Nenhum import Uazapi
//   - Nenhum window.FB / Facebook SDK
//   - Token nunca logado nem exposto no erro ao caller
// =============================================================================

import { supabase } from '../lib/supabase'
import type {
  CompleteResult,
  GetMetaConversationsResponse,
  GetMetaInstancesResponse,
  GetMetaMessagesResponse,
  MetaChatConversation,
  MetaChatMessage,
  MetaWabaSelectionOption,
  MetaWhatsAppInstance,
  OnboardingCompleteInstance,
  OnboardingCompletePayload,
  OnboardingCompleteResponse,
  OnboardingStartResponse,
} from '../types/meta-whatsapp'

// Tipos internos ao service usados para intersecção com { error?: string }.
type StartRaw = OnboardingStartResponse & { error?: string }

// CompleteRaw suporta ambos os shapes possíveis do POST /complete:
//   connected      → { instance: { id, ... } }
//   selection      → { status: 'selection_required', continuation_token, options }
type CompleteRaw = {
  instance?:           (OnboardingCompleteInstance & { id?: string }) | null
  status?:             string
  continuation_token?: unknown
  options?:            unknown
  error?:              string
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão inválida ou expirada')
  return {
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${session.access_token}`,
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

export const metaWhatsAppApi = {

  /**
   * Lista as instâncias Meta WhatsApp ativas da empresa.
   *
   * GET /api/whatsapp/meta/instances?company_id=<uuid>
   *
   * Retorna array vazio se a empresa não tiver instâncias configuradas.
   */
  async getInstances(companyId: string): Promise<MetaWhatsAppInstance[]> {
    const headers = await getAuthHeaders()
    const url = `/api/whatsapp/meta/instances?company_id=${encodeURIComponent(companyId)}`
    const res  = await fetch(url, {
      method:  'GET',
      headers: { Authorization: (headers as Record<string, string>)['Authorization'] },
    })

    const data = await res.json().catch(() => ({}) as Record<string, unknown>) as GetMetaInstancesResponse & { error?: string }

    if (!res.ok) {
      throw new Error(data.error ?? 'Erro ao carregar instâncias Meta WhatsApp')
    }

    return Array.isArray(data.instances) ? data.instances : []
  },

  /**
   * Inicia o fluxo de Embedded Signup da Meta.
   *
   * POST /api/whatsapp/meta/onboarding/start
   * body: { company_id }
   *
   * Retorna app_id, config_id e state para iniciar o popup do Facebook.
   * App secret nunca retorna ao frontend.
   */
  async startOnboarding(companyId: string): Promise<OnboardingStartResponse> {
    const headers = await getAuthHeaders()
    const res = await fetch('/api/whatsapp/meta/onboarding/start', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ company_id: companyId }),
    })

    const data = await res.json().catch(() => ({}) as Record<string, unknown>) as StartRaw

    if (!res.ok) {
      throw new Error(data.error ?? 'Erro ao iniciar onboarding Meta WhatsApp')
    }

    // Fail-closed: JSON 200 inválido não deve ser tratado como sucesso tipado.
    if (!data.state || !data.app_id || !data.config_id || !data.expires_at) {
      throw new Error('Resposta inválida do servidor')
    }

    return data
  },

  /**
   * Conclui o fluxo de Embedded Signup da Meta.
   *
   * POST /api/whatsapp/meta/onboarding/complete
   * body: { state, code, waba_id?, phone_number_id? }
   *
   * Retorna um discriminated union:
   *   { kind: 'connected', instance }         → fluxo concluído
   *   { kind: 'selection', continuation_token, options } → múltiplos WABAs; usuário precisa escolher
   *
   * IMPORTANTE: company_id NÃO é enviado — o backend o obtém via JWT/guard.
   */
  async completeOnboarding(payload: OnboardingCompletePayload): Promise<CompleteResult> {
    const headers = await getAuthHeaders()
    const res = await fetch('/api/whatsapp/meta/onboarding/complete', {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
    })

    const data = await res.json().catch(() => ({}) as Record<string, unknown>) as CompleteRaw

    if (!res.ok) {
      throw new Error(data.error ?? 'Erro ao concluir onboarding Meta WhatsApp')
    }

    // Caminho connected: instance com id presente → fluxo concluído.
    if (data.instance?.id) {
      return { kind: 'connected', instance: data.instance as OnboardingCompleteInstance }
    }

    // Caminho selection_required: múltiplos WABAs acessíveis.
    // Validação fail-closed: qualquer campo ausente ou malformado → rejeitar.
    if (data.status === 'selection_required') {
      if (typeof data.continuation_token !== 'string' || !data.continuation_token.trim()) {
        throw new Error('Resposta inválida do servidor')
      }

      const rawOptions = data.options
      if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
        throw new Error('Resposta inválida do servidor')
      }

      const seenIndexes = new Set<number>()
      const options: MetaWabaSelectionOption[] = []

      for (const opt of rawOptions) {
        if (opt === null || typeof opt !== 'object') throw new Error('Resposta inválida do servidor')
        const { index, label, name } = opt as Record<string, unknown>
        if (!Number.isInteger(index) || (index as number) < 0)   throw new Error('Resposta inválida do servidor')
        if (typeof label !== 'string' || !label.trim())          throw new Error('Resposta inválida do servidor')
        if (name !== null && typeof name !== 'string')           throw new Error('Resposta inválida do servidor')
        if (seenIndexes.has(index as number))                    throw new Error('Resposta inválida do servidor')
        seenIndexes.add(index as number)
        options.push({ index: index as number, label, name: name as string | null })
      }

      return { kind: 'selection', continuation_token: data.continuation_token, options }
    }

    // Qualquer outro shape → fail-closed.
    throw new Error('Resposta inválida do servidor')
  },

  /**
   * Resolve a seleção explícita de WABA/número após receber status selection_required.
   *
   * POST /api/whatsapp/meta/onboarding/resolve-waba
   * body: { continuation_token, selected_index }
   *
   * NUNCA enviar company_id — o backend extrai via JWT e valida no token AEAD.
   */
  async resolveWabaSelection(
    continuationToken: string,
    selectedIndex:     number,
  ): Promise<OnboardingCompleteInstance> {
    const headers = await getAuthHeaders()
    const res = await fetch('/api/whatsapp/meta/onboarding/resolve-waba', {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        continuation_token: continuationToken,
        selected_index:     selectedIndex,
        // company_id: NUNCA — extraído pelo backend via JWT
      }),
    })

    const data = await res.json().catch(() => ({}) as Record<string, unknown>) as OnboardingCompleteResponse & { error?: string }

    if (!res.ok) {
      throw new Error(data.error ?? 'Erro ao selecionar número')
    }

    // Fail-closed: instance obrigatória na resposta.
    if (!data.instance?.id) {
      throw new Error('Resposta inválida do servidor')
    }

    return data.instance
  },

  /**
   * Lista as conversas Meta WhatsApp ativas da empresa.
   *
   * GET /api/whatsapp/meta/conversations
   *   ?company_id=<uuid>
   *   [&instance_id=<uuid>]
   *   [&filter=all|unread]
   *   [&limit=<n>]
   *
   * Parâmetros undefined/null NÃO são enviados na query string.
   * Retorna array vazio se não houver conversas.
   * Nunca acessa meta_conversations diretamente via Supabase.
   */
  async getConversations(
    companyId: string,
    options?: {
      instanceId?: string
      filter?:     'all' | 'unread'
      limit?:      number
    }
  ): Promise<MetaChatConversation[]> {
    const headers = await getAuthHeaders()

    const params = new URLSearchParams({ company_id: companyId })
    if (options?.instanceId != null) params.set('instance_id', options.instanceId)
    if (options?.filter     != null) params.set('filter',      options.filter)
    if (options?.limit      != null) params.set('limit',       String(options.limit))

    const res = await fetch(`/api/whatsapp/meta/conversations?${params.toString()}`, {
      method:  'GET',
      headers: { Authorization: (headers as Record<string, string>)['Authorization'] },
    })

    const data = await res.json().catch(() => ({}) as Record<string, unknown>) as GetMetaConversationsResponse & { error?: string }

    if (!res.ok) {
      throw new Error(data.error ?? 'Erro ao carregar conversas Meta WhatsApp')
    }

    return Array.isArray(data.conversations) ? data.conversations : []
  },

  /**
   * Busca as mensagens de uma conversa Meta WhatsApp.
   *
   * GET /api/whatsapp/meta/conversations/:conversationId/messages
   *   ?company_id=<uuid>
   *   [&limit=<n>]
   *
   * conversationId é encodado na URL via encodeURIComponent.
   * Retorna mensagens em ordem cronológica (oldest -> newest).
   * Nunca acessa meta_messages diretamente via Supabase.
   */
  async getMessages(
    companyId:      string,
    conversationId: string,
    options?: {
      limit?: number
    }
  ): Promise<MetaChatMessage[]> {
    const headers = await getAuthHeaders()

    const params = new URLSearchParams({ company_id: companyId })
    if (options?.limit != null) params.set('limit', String(options.limit))

    const encodedId = encodeURIComponent(conversationId)
    const res = await fetch(
      `/api/whatsapp/meta/conversations/${encodedId}/messages?${params.toString()}`,
      {
        method:  'GET',
        headers: { Authorization: (headers as Record<string, string>)['Authorization'] },
      }
    )

    const data = await res.json().catch(() => ({}) as Record<string, unknown>) as GetMetaMessagesResponse & { error?: string }

    if (!res.ok) {
      throw new Error(data.error ?? 'Erro ao carregar mensagens Meta WhatsApp')
    }

    return Array.isArray(data.messages) ? data.messages : []
  },
}
