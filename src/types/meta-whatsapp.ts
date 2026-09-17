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
//
// waba_id é opcional:
//   presente  → caminho normal (FINISH chegou com wabaId)
//   ausente   → caminho discovery (FINISH não chegou; backend usa debug_token)

export interface OnboardingCompletePayload {
  state:             string
  code:              string
  waba_id?:          string   // opcional — ausente no caminho discovery
  phone_number_id?:  string
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

// ── S7: Seleção de WABA ───────────────────────────────────────────────────────
// Usada quando /complete retorna status: 'selection_required' (múltiplos WABAs
// acessíveis). O frontend apresenta a lista ao usuário e chama /resolve-waba
// com o índice escolhido + continuation_token.
//
// index: identificador opaco da opção no backend — enviar como selected_index.
//        NÃO assumir sequencialidade — validar via options.some(o => o.index === idx).
// label: número de telefone formatado para exibição (ex: "+55 11 99999-9999").
// name:  verified_name se disponível — null se ausente.

export interface MetaWabaSelectionOption {
  index: number
  label: string
  name:  string | null
}

// Resultado discriminado de completeOnboarding.
//   connected  → fluxo concluído; instance disponível para uso.
//   selection  → usuário precisa escolher WABA/número antes de prosseguir.

export type CompleteResult =
  | { kind: 'connected'; instance: OnboardingCompleteInstance }
  | { kind: 'selection'; continuation_token: string; options: MetaWabaSelectionOption[] }

// ── OnboardingStep ────────────────────────────────────────────────────────────
// Máquina de estados do fluxo Embedded Signup Meta.
// Usada pelo hook useMetaOnboarding (1D.2) e pelo painel MetaWhatsAppPanel (1D.3).
//
// Fluxo normal:
//   idle → loading_session → ready → popup_open → completing → idle
//
// Fluxo selection (múltiplos WABAs):
//   completing → awaiting_selection → resolving_selection → idle
//
// Erros levam de qualquer estado para idle + onboardingError preenchido.
// CANCEL do Meta leva para idle sem erro.

export type OnboardingStep =
  | 'idle'                  // sem sessão pré-criada (estado inicial)
  | 'loading_session'       // POST /start em andamento no mount do painel
  | 'ready'                 // sessão + SDK prontos — botão habilitado
  | 'popup_open'            // FB.login aberto — aguardando code + waba_id
  | 'completing'            // POST /complete em andamento
  | 'awaiting_selection'    // aguardando seleção explícita do usuário (múltiplos WABAs)
  | 'resolving_selection'   // POST /resolve-waba em andamento
