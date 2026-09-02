// =====================================================
// TYPES: STAGE TRANSITION QUESTIONS R1
// Data: 02/09/2026
// Objetivo: Perguntas de transição entre etapas (R1 aprovado)
// =====================================================

export type StageTransitionFieldType = 
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multi_select'

export interface StageTransitionQuestion {
  id: string
  company_id: string
  funnel_stage_id: string
  label: string
  field_type: StageTransitionFieldType
  options: string[] | null  // obrigatório para select/multi_select, null para outros
  required: boolean
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

/**
 * Resposta de pergunta de transição.
 * 
 * Para todos os tipos, `value` é uma string:
 * - text: string simples
 * - number: string decimal canônico (ex: "1500.50")
 * - boolean: "true" ou "false" (lowercase)
 * - select: string da opção selecionada
 * - multi_select: JSON array serializado (ex: '["Produto A","Produto C"]')
 */
export interface StageTransitionAnswer {
  question_id: string
  value: string
}

export interface CreateStageTransitionQuestionForm {
  funnel_stage_id: string
  label: string
  field_type: StageTransitionFieldType
  options?: string[] | null
  required: boolean
  sort_order?: number
}

export interface UpdateStageTransitionQuestionForm {
  label?: string
  required?: boolean
  sort_order?: number
  active?: boolean
}

export interface MoveOpportunityV2Params {
  opportunity_id: string
  funnel_id: string
  from_stage_id: string
  to_stage_id: string
  position_in_stage: number
  transition_answers: StageTransitionAnswer[] | null
}

/**
 * Erros semânticos mapeados da RPC move_opportunity_v2
 */
export enum StageTransitionErrorCode {
  POSITION_NOT_FOUND = 'POSITION_NOT_FOUND',
  OPPORTUNITY_NOT_FOUND = 'OPPORTUNITY_NOT_FOUND',
  CROSS_TENANT_FUNNEL = 'CROSS_TENANT_FUNNEL',
  INVALID_STAGE_FUNNEL = 'INVALID_STAGE_FUNNEL',
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_TRANSITION_ANSWERS_FORMAT = 'INVALID_TRANSITION_ANSWERS_FORMAT',
  DUPLICATE_QUESTION_ID = 'DUPLICATE_QUESTION_ID',
  QUESTIONS_NOT_ENABLED = 'QUESTIONS_NOT_ENABLED',
  MISSING_REQUIRED_ANSWER = 'MISSING_REQUIRED_ANSWER',
  INVALID_TRANSITION_QUESTION = 'INVALID_TRANSITION_QUESTION',
  EMPTY_ANSWER_VALUE = 'EMPTY_ANSWER_VALUE',
  INVALID_SELECT_VALUE = 'INVALID_SELECT_VALUE',
  INVALID_BOOLEAN = 'INVALID_BOOLEAN',
  INVALID_NUMBER = 'INVALID_NUMBER',
  TOO_MANY_ACTIVE_QUESTIONS = 'TOO_MANY_ACTIVE_QUESTIONS',
  INVALID_TRANSITION_QUESTION_CONFIG = 'INVALID_TRANSITION_QUESTION_CONFIG',
  INVALID_MULTI_SELECT_FORMAT = 'INVALID_MULTI_SELECT_FORMAT',
  INVALID_MULTI_SELECT_VALUE = 'INVALID_MULTI_SELECT_VALUE',
}

export interface StageTransitionError {
  code: StageTransitionErrorCode
  message: string
  userMessage: string
}
