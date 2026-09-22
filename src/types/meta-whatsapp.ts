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

// ── Provider view-model ───────────────────────────────────────────────────────
// Tipo de apresentação/routing no frontend.
// NÃO representa unificação de tabelas, autenticação ou credenciais.
// provider_token, waba_id, phone_number_id e credentials nunca pertencem aqui.

export type WhatsAppProvider = 'uazapi' | 'meta'

export interface WhatsAppChatInstance {
  id:          string
  provider:    WhatsAppProvider
  /** Nome para exibição: display_name, phone_number, verified_name ou id como fallback */
  label:       string
  phoneNumber: string | null
  status:      string
}

// ── META CHAT — Conversation ──────────────────────────────────────────────────
// Espelho dos campos públicos retornados por:
//   GET /api/whatsapp/meta/conversations
//
// Campos explicitamente excluídos pelo backend: company_id, meta_message_id.
// Nullability reflete o schema real: last_message_at e last_message_preview
// podem ser null em conversas sem mensagem ainda.

export interface MetaChatConversation {
  id:                   string
  instance_id:          string
  wa_id:                string
  contact_name:         string | null
  status:               'active' | 'archived'
  unread_count:         number
  last_message_at:      string | null   // ISO-8601 | null
  last_message_preview: string | null
  created_at:           string
  updated_at:           string
  // Foto do contato — enriquecida pelo backend via chat_contacts (MVP3F).
  // null quando não há correspondência por telefone na mesma company.
  profile_picture_url:  string | null
}

// ── META CHAT — Message ───────────────────────────────────────────────────────
// Espelho dos campos públicos retornados por:
//   GET /api/whatsapp/meta/conversations/:id/messages
//
// Campos explicitamente excluídos pelo backend: company_id, meta_message_id, updated_at.
// message_type é string (não literal union) porque o MVP3A entrega 'text' e
// futuros tipos (image, document, etc.) serão adicionados sem breaking change.

export interface MetaChatMessage {
  id:                 string
  conversation_id:    string
  instance_id:        string
  direction:          'inbound' | 'outbound'
  message_type:       string          // 'text' no MVP3A; expansível sem breaking change
  body:               string
  provider_timestamp: string | null   // ISO-8601 | null
  created_at:         string
}

// ── Response shapes ───────────────────────────────────────────────────────────

export interface GetMetaConversationsResponse {
  conversations: MetaChatConversation[]
}

export interface GetMetaMessagesResponse {
  messages: MetaChatMessage[]
}

// ── POST /api/whatsapp/meta/messages/send ─────────────────────────────────────
// Resposta de envio bem-sucedido de mensagem de texto Meta WhatsApp (MVP3D).
//
// ok:         sempre true em respostas 200 (garante fail-closed no service).
// message_id: wamid retornado pela Graph API (identificador opaco Meta).
//
// Contrato do payload de ENVIO (side frontend → backend):
//   company_id:      UUID da empresa — extraído via JWT/guard pelo backend
//   instance_id:     UUID da instância Meta
//   conversation_id: UUID da conversa — o backend resolve o destinatário (wa_id)
//                    server-side a partir deste campo. `to` nunca vai no payload.
//   message.type:    'text'
//   message.text.body: conteúdo da mensagem
//
// Erros distintos retornados pelo backend (propagados como err.message):
//   invalid_request         → campos inválidos/ausentes
//   invalid_message         → rejeitado pela Graph API (ex: 131047 window expirada)
//   instance_not_found      → instância inexistente ou outro tenant
//   conversation_not_found  → conversa inexistente, outro tenant ou outra instance
//   instance_not_connected  → instância sem status 'connected'
//   credential_unavailable  → token ausente ou decrypt falhou
//   send_persistence_failed → Graph aceitou, mas falhou ao salvar localmente
//                             ⚠ NÃO reenviar — mensagem pode já ter sido entregue
//   provider_error          → Graph rejeitou (502)
//   provider_unavailable    → timeout/rede com Graph (503)
//   internal_error          → erro interno inesperado

export interface MetaSendMessageResponse {
  ok:         true
  message_id: string
}
