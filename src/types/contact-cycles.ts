// =====================================================
// TIPOS — Motor de Ciclos de Contato
//
// Refletem exatamente o schema do banco:
//   - company_contact_cycle_config  (PK: company_id)
//   - contact_attempt_reasons
//   - contact_attempt_questions
//   - contact_attempt_answers
//   - contact_attempt_cycles
//   - contact_attempts
//   - opportunity_timeline_events
// =====================================================

// ── Configuração da empresa ─────────────────────────────────────

/**
 * Valores válidos para eligibility_rule.
 * Reflete CHECK constraint: ('hours', 'day_change', 'both')
 */
export type EligibilityRule = 'hours' | 'day_change' | 'both'

/**
 * Configuração de ciclo de contato da empresa.
 * PK: company_id (sem campo id separado).
 */
export interface ContactCycleConfig {
  company_id: string
  enabled: boolean
  eligibility_rule: EligibilityRule
  /** Obrigatório quando rule = 'hours' ou 'both'. NULL quando rule = 'day_change'. */
  eligibility_hours: number | null
  show_extra_questions: boolean
  updated_at: string
}

/**
 * Campos enviados ao PUT /api/contact-cycles/config.
 * Somente estes 4 campos — nenhum campo extra.
 */
export interface ContactCycleConfigForm {
  enabled: boolean
  eligibility_rule: EligibilityRule
  /** Enviar null quando rule = 'day_change'. */
  eligibility_hours: number | null
  show_extra_questions: boolean
}

// ── Motivos de tentativa ────────────────────────────────────────

export interface ContactAttemptReason {
  id: string
  company_id: string
  label: string
  active: boolean
  created_at: string
}

export interface ContactAttemptReasonForm {
  label: string
}

export interface ContactAttemptReasonPatch {
  label?: string
  active?: boolean
}

// ── Perguntas dinâmicas ─────────────────────────────────────────

/**
 * Tipos de campo aceitos pelo backend.
 * Reflete validação em api/contact-cycles/questions.ts.
 */
export type FieldType = 'text' | 'textarea' | 'select' | 'boolean' | 'number'

export interface ContactAttemptQuestion {
  id: string
  company_id: string
  label: string
  field_type: FieldType
  /** Obrigatório quando field_type = 'select'. NULL nos demais tipos. */
  options: string[] | null
  required: boolean
  sort_order: number
  active: boolean
  created_at: string
}

export interface ContactAttemptQuestionForm {
  label: string
  field_type: FieldType
  /** Obrigatório e com ao menos 1 item quando field_type = 'select'. */
  options: string[] | null
  required: boolean
  sort_order: number
}

export interface ContactAttemptQuestionPatch {
  label?: string
  field_type?: FieldType
  options?: string[] | null
  required?: boolean
  sort_order?: number
  active?: boolean
}

// ── Ciclos de contato ───────────────────────────────────────────

export type CycleStatus = 'open' | 'closed'

export interface ContactCycleHistoryItem {
  cycle_id: string
  status: CycleStatus
  close_reason: string | null
  opened_at: string
  closed_at: string | null
  attempt_count: number
}

// ── Estado de ciclo da oportunidade ────────────────────────────

export type ContactAttemptsState = 'none' | 'cycle_open' | 'waiting'

export interface ContactCycleState {
  eligibility: string
  current_contact_cycle_id: string | null
  contact_attempts_state: ContactAttemptsState
  current_cycle_attempts_count: number
  total_contact_attempts_count: number
  next_attempt_eligible_at: string | null
  last_customer_reply_at: string | null
  last_agent_contact_at: string | null
}

// ── Tentativas de contato ────────────────────────────────────────

/** Resposta de uma resposta a pergunta dinâmica */
export interface ContactAttemptAnswer {
  question_id: string
  value: string
}

/**
 * Campos enviados ao POST /api/contact-cycles/[opportunityId]/attempt.
 * Nunca inclui lead_id nem funnel_stage_id (derivados no backend).
 */
export interface ContactAttemptForm {
  trigger_reason: 'manual' | 'whatsapp_sent' | 'whatsapp_received' | 'system'
  reason_id?: string | null
  whatsapp_message_id?: string | null
  notes?: string | null
  answers?: ContactAttemptAnswer[]
}

// ── Estado de ciclo por lead ─────────────────────────────────────

/**
 * Retorno de GET /api/contact-cycles/by-lead/[leadId].
 * Usado pelo hook useContactCycleState para decidir se abre o modal.
 */
export interface ContactCycleByLeadState {
  opportunity_id: string | null
  /** 'eligible' | 'cycle_open' | 'waiting' | 'disabled' | 'no_config' | 'no_opportunity' | 'unknown' */
  eligibility: string
  /** true apenas quando eligibility = 'eligible' ou 'cycle_open' */
  eligible_for_attempt: boolean
  contact_attempts_state: ContactAttemptsState
  current_contact_cycle_id: string | null
  current_cycle_attempts_count: number
  total_contact_attempts_count: number
  last_contact_attempt_at: string | null
  eligible_for_new_cycle_at: string | null
  reason: string
}

// ── Respostas de API ────────────────────────────────────────────

export interface ContactCycleApiSuccess<T> {
  ok: true
  data: T
}

export interface ContactCycleApiError {
  ok: false
  error: string
}

export type ContactCycleApiResponse<T> =
  | ContactCycleApiSuccess<T>
  | ContactCycleApiError
