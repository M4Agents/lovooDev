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
  GetMetaInstancesResponse,
  MetaWhatsAppInstance,
  OnboardingCompletePayload,
  OnboardingCompleteResponse,
  OnboardingStartResponse,
} from '../types/meta-whatsapp'

// Tipos internos ao service usados para intersecção com { error?: string }.
type StartRaw    = OnboardingStartResponse    & { error?: string }
type CompleteRaw = OnboardingCompleteResponse & { error?: string }

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
   * body: { state, code, waba_id, phone_number_id? }
   *
   * IMPORTANTE: company_id NÃO é enviado — o backend o obtém via JWT/guard.
   */
  async completeOnboarding(payload: OnboardingCompletePayload): Promise<OnboardingCompleteResponse> {
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

    // Fail-closed: JSON 200 inválido não deve ser tratado como sucesso tipado.
    if (!data.instance?.id) {
      throw new Error('Resposta inválida do servidor')
    }

    return data
  },
}
