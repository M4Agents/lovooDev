// =============================================================================
// META WHATSAPP — TIPOS TYPESCRIPT
//
// Tipos baseados nos contratos reais dos endpoints:
//   GET  /api/whatsapp/meta/instances
//   POST /api/whatsapp/meta/onboarding/start
//   POST /api/whatsapp/meta/onboarding/complete
//
// Isolados do sistema Uazapi/WhatsApp Life.
// Nenhum campo de credencial ou secret pertence a estes tipos.
// =============================================================================

// ── Status da instância ───────────────────────────────────────────────────────

export type MetaWhatsAppInstanceStatus =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'token_revoked'

// ── Instância Meta WhatsApp ───────────────────────────────────────────────────
// Espelho dos 9 campos públicos retornados por GET /instances.
// Nunca incluir: company_id, connected_by, deleted_at, access_token_enc.

export interface MetaWhatsAppInstance {
  id:              string
  phone_number_id: string
  waba_id:         string
  display_name:    string | null
  phone_number:    string | null
  verified_name:   string | null
  status:          MetaWhatsAppInstanceStatus
  created_at:      string
  updated_at:      string
}

// ── GET /api/whatsapp/meta/instances ─────────────────────────────────────────

export interface GetMetaInstancesResponse {
  instances: MetaWhatsAppInstance[]
}

// ── POST /api/whatsapp/meta/onboarding/start ─────────────────────────────────
// Resposta inclui App ID, Config ID, state e expires_at (TTL da sessão).
// App secret nunca aparece aqui.
// Contrato real: start.js linha 103-108.

export interface OnboardingStartResponse {
  state:      string
  app_id:     string
  config_id:  string
  expires_at: string   // ISO-8601 — TTL da sessão de onboarding (now + 10 min)
}

// ── POST /api/whatsapp/meta/onboarding/complete ───────────────────────────────
// Payload enviado pelo frontend ao encerrar o Embedded Signup.
// company_id NÃO pertence a este payload — o backend extrai via JWT/guard.

export interface OnboardingCompletePayload {
  state:            string
  code:             string
  waba_id:          string
  phone_number_id?: string
}

// Subconjunto da instância retornado por complete.js (linhas 325-332).
// O backend constrói explicitamente somente estes 6 campos na resposta —
// display_name, created_at e updated_at NÃO são retornados pelo complete.
// Usar MetaWhatsAppInstance aqui seria incorreto (9 campos obrigatórios).

export interface OnboardingCompleteInstance {
  id:              string
  phone_number_id: string
  waba_id:         string
  phone_number:    string | null
  verified_name:   string | null
  status:          MetaWhatsAppInstanceStatus
}

// Resposta de conclusão do onboarding.

export interface OnboardingCompleteResponse {
  instance: OnboardingCompleteInstance
}
