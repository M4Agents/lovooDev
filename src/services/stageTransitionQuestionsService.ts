// =====================================================
// STAGE TRANSITION QUESTIONS SERVICE
// Data: 02/09/2026 - Etapa B (Service Layer)
// Objetivo: Camada de serviço para Stage Transition Questions R1
// =====================================================

import type {
  StageTransitionQuestion,
  StageTransitionAnswer,
  StageTransitionFieldType
} from '../types/stage-transition-questions'
import { StageTransitionErrorCode } from '../types/stage-transition-questions'
import {
  serializeMultiSelectValue
} from '../utils/stageTransitionQuestions'
import { isStageTransitionQuestionsFeatureEnabled } from '../hooks/dashboard/useFeatureFlags'

// =====================================================
// ERRORS
// =====================================================

export class StageTransitionServiceError extends Error {
  constructor(
    public readonly code: StageTransitionErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'StageTransitionServiceError'
  }
}

export class StageTransitionFeatureDisabledError extends Error {
  constructor() {
    super('Stage Transition Questions feature is disabled')
    this.name = 'StageTransitionFeatureDisabledError'
  }
}

// =====================================================
// TYPES - UI INPUT
// =====================================================

/**
 * Valor de resposta natural da UI (antes da conversão para contrato RPC)
 * - text/number/select: string
 * - boolean: boolean
 * - multi_select: string[]
 */
export type StageTransitionDraftValue = string | boolean | string[] | null | undefined

/**
 * Resposta rascunho da UI (antes da validação/canonicalização)
 */
export interface StageTransitionDraftAnswer {
  questionId: string
  value: StageTransitionDraftValue
}

// =====================================================
// TYPES - RPC PAYLOAD
// =====================================================

/**
 * Parâmetros da futura RPC move_opportunity_v2
 */
export interface MoveOpportunityV2Params {
  p_opportunity_id: string
  p_funnel_id: string
  p_from_stage_id: string
  p_to_stage_id: string
  p_position_in_stage: number
  p_transition_answers: StageTransitionAnswer[] | null
}

// =====================================================
// TYPES - CRUD DTOs (Futuros)
// =====================================================

export interface CreateStageTransitionQuestionInput {
  funnel_stage_id: string
  label: string
  field_type: StageTransitionFieldType
  required: boolean
  options: string[] | null
  sort_order: number
}

export interface UpdateStageTransitionQuestionInput {
  label?: string
  required?: boolean
  sort_order?: number
  active?: boolean
}

// =====================================================
// FEATURE GUARD
// =====================================================

function ensureFeatureEnabled(): void {
  if (!isStageTransitionQuestionsFeatureEnabled()) {
    throw new StageTransitionFeatureDisabledError()
  }
}

// =====================================================
// PAYLOAD BUILDER
// =====================================================

/**
 * Converte respostas da UI para o formato do contrato RPC
 * 
 * Validações:
 * - Question_id conhecido
 * - Field_type compatível
 * - Required respondidas
 * - Canonicalização multi_select
 * - Serialização correta
 * - Duplicatas rejeitadas
 * - Respostas opcionais vazias omitidas
 * 
 * @throws StageTransitionServiceError
 */
export function buildTransitionAnswersPayload(
  draftAnswers: StageTransitionDraftAnswer[],
  questions: StageTransitionQuestion[]
): StageTransitionAnswer[] {
  ensureFeatureEnabled()
  
  // Mapa de perguntas por ID para lookup eficiente
  const questionsMap = new Map(questions.map(q => [q.id, q]))
  
  // Detectar duplicatas no draft
  const questionIds = draftAnswers.map(a => a.questionId)
  const uniqueIds = new Set(questionIds)
  if (uniqueIds.size !== questionIds.length) {
    throw new StageTransitionServiceError(
      StageTransitionErrorCode.DUPLICATE_QUESTION_ID,
      'Respostas duplicadas para a mesma pergunta não são permitidas'
    )
  }
  
  // Processar respostas
  const answers: StageTransitionAnswer[] = []
  
  for (const draft of draftAnswers) {
    const question = questionsMap.get(draft.questionId)
    
    // Validar question_id conhecido
    if (!question) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_TRANSITION_QUESTION,
        `Pergunta desconhecida: ${draft.questionId}`
      )
    }
    
    // Validar configuração da pergunta
    validateQuestionConfiguration(question)
    
    // Processar valor baseado no field_type
    const processedValue = processAnswerValue(draft.value, question)
    
    // Omitir respostas opcionais vazias
    if (processedValue === null) {
      if (question.required) {
        throw new StageTransitionServiceError(
          StageTransitionErrorCode.MISSING_REQUIRED_ANSWER,
          `Pergunta obrigatória sem resposta: ${question.label}`
        )
      }
      continue // Omite opcional vazia
    }
    
    answers.push({
      question_id: question.id,
      value: processedValue
    })
  }
  
  // Validar que todas as required foram respondidas
  const answeredIds = new Set(answers.map(a => a.question_id))
  const missingRequired = questions
    .filter(q => q.required && q.active && !answeredIds.has(q.id))
  
  if (missingRequired.length > 0) {
    throw new StageTransitionServiceError(
      StageTransitionErrorCode.MISSING_REQUIRED_ANSWER,
      `Perguntas obrigatórias não respondidas: ${missingRequired.map(q => q.label).join(', ')}`
    )
  }
  
  return answers
}

/**
 * Valida configuração da pergunta (fail-closed no client)
 */
function validateQuestionConfiguration(question: StageTransitionQuestion): void {
  // SELECT e MULTI_SELECT exigem options
  if (question.field_type === 'select' || question.field_type === 'multi_select') {
    if (!question.options || question.options.length === 0) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_TRANSITION_QUESTION_CONFIG,
        `Pergunta ${question.field_type} sem opções configuradas`
      )
    }
    
    // Validar que options são strings não vazias
    for (const opt of question.options) {
      if (typeof opt !== 'string' || opt.trim() === '') {
        throw new StageTransitionServiceError(
          StageTransitionErrorCode.INVALID_TRANSITION_QUESTION_CONFIG,
          'Opções devem ser strings não vazias'
        )
      }
    }
    
    // Validar duplicatas nas options
    const uniqueOptions = new Set(question.options)
    if (uniqueOptions.size !== question.options.length) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_TRANSITION_QUESTION_CONFIG,
        'Opções duplicadas não são permitidas'
      )
    }
  } else {
    // Outros tipos não devem ter options
    if (question.options !== null && question.options !== undefined) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_TRANSITION_QUESTION_CONFIG,
        `Pergunta ${question.field_type} não deve ter opções`
      )
    }
  }
}

/**
 * Processa valor baseado no field_type
 * Retorna null se resposta opcional vazia (deve ser omitida)
 */
function processAnswerValue(
  value: StageTransitionDraftValue,
  question: StageTransitionQuestion
): string | null {
  
  // TEXT
  if (question.field_type === 'text') {
    if (value === null || value === undefined || value === '') {
      return null // Omitir se vazio
    }
    if (typeof value !== 'string') {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_TRANSITION_ANSWERS_FORMAT,
        'Valor text deve ser string'
      )
    }
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  
  // NUMBER
  if (question.field_type === 'number') {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const strValue = typeof value === 'number' ? String(value) : String(value)
    
    // Validar formato decimal
    if (!/^-?\d+(\.\d+)?$/.test(strValue)) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_NUMBER,
        'Número inválido (esperado formato decimal)'
      )
    }
    return strValue
  }
  
  // BOOLEAN
  if (question.field_type === 'boolean') {
    if (value === null || value === undefined) {
      return null
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false'
    }
    if (value === 'true' || value === 'false') {
      return value
    }
    throw new StageTransitionServiceError(
      StageTransitionErrorCode.INVALID_BOOLEAN,
      'Valor boolean inválido'
    )
  }
  
  // SELECT
  if (question.field_type === 'select') {
    if (value === null || value === undefined || value === '') {
      return null
    }
    if (typeof value !== 'string') {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_TRANSITION_ANSWERS_FORMAT,
        'Valor select deve ser string'
      )
    }
    
    // Validar que opção existe (case-sensitive)
    if (!question.options || !question.options.includes(value)) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_SELECT_VALUE,
        `Opção inválida: ${value}`
      )
    }
    return value
  }
  
  // MULTI_SELECT
  if (question.field_type === 'multi_select') {
    if (value === null || value === undefined) {
      return null
    }
    
    if (!Array.isArray(value)) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_MULTI_SELECT_FORMAT,
        'Valor multi_select deve ser array'
      )
    }
    
    // Array vazio deve ser omitido (não persistir [])
    if (value.length === 0) {
      return null
    }
    
    // Validar que são strings
    if (!value.every(v => typeof v === 'string')) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_MULTI_SELECT_VALUE,
        'Todos elementos de multi_select devem ser strings'
      )
    }
    
    // Validar duplicatas
    const uniqueValues = new Set(value)
    if (uniqueValues.size !== value.length) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_MULTI_SELECT_VALUE,
        'Valores duplicados não são permitidos'
      )
    }
    
    // Canonicalizar e serializar
    if (!question.options) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_TRANSITION_QUESTION_CONFIG,
        'multi_select sem options'
      )
    }
    
    try {
      return serializeMultiSelectValue(value, question.options)
    } catch (error) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_MULTI_SELECT_VALUE,
        error instanceof Error ? error.message : 'Erro ao processar multi_select',
        error
      )
    }
  }
  
  // DATETIME
  if (question.field_type === 'datetime') {
    if (value === null || value === undefined || value === '') {
      return null
    }
    
    if (typeof value !== 'string') {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Valor datetime deve ser string'
      )
    }
    
    const trimmed = value.trim()
    if (trimmed === '') {
      return null
    }
    
    // Validar formato datetime-local ESTRITO (sem timezone, sem espaços)
    // YYYY-MM-DDTHH:mm ou YYYY-MM-DDTHH:mm:ss
    const datetimeLocalPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
    const match = datetimeLocalPattern.exec(trimmed)
    
    if (!match) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Formato de data e hora inválido'
      )
    }
    
    // Extrair componentes para validação rigorosa
    const year = parseInt(match[1], 10)
    const month = parseInt(match[2], 10)
    const day = parseInt(match[3], 10)
    const hour = parseInt(match[4], 10)
    const minute = parseInt(match[5], 10)
    const second = match[6] ? parseInt(match[6], 10) : 0
    
    // Validar ranges básicos
    if (month < 1 || month > 12) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Mês inválido (1-12)'
      )
    }
    
    if (day < 1 || day > 31) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Dia inválido (1-31)'
      )
    }
    
    if (hour < 0 || hour > 23) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Hora inválida (0-23)'
      )
    }
    
    if (minute < 0 || minute > 59) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Minuto inválido (0-59)'
      )
    }
    
    if (second < 0 || second > 59) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Segundo inválido (0-59)'
      )
    }
    
    // Parsear data
    let parsedDate: Date
    try {
      parsedDate = new Date(trimmed)
      
      // Validar que resultou em data válida (não NaN)
      if (isNaN(parsedDate.getTime())) {
        throw new Error('Data inválida')
      }
    } catch (error) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Data e hora inválidas',
        error
      )
    }
    
    // VALIDAÇÃO RIGOROSA: verificar que data parseada corresponde aos componentes originais
    // Isso rejeita datas impossíveis como 2026-02-31 que JavaScript normaliza para 2026-03-03
    if (
      parsedDate.getFullYear() !== year ||
      parsedDate.getMonth() + 1 !== month ||
      parsedDate.getDate() !== day ||
      parsedDate.getHours() !== hour ||
      parsedDate.getMinutes() !== minute ||
      parsedDate.getSeconds() !== second
    ) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.INVALID_DATETIME,
        'Data inválida (dia não existe no calendário)'
      )
    }
    
    // Se create_activity_on_answer=true, validar que é futuro
    if (question.create_activity_on_answer && parsedDate.getTime() < Date.now()) {
      throw new StageTransitionServiceError(
        StageTransitionErrorCode.DATETIME_IN_PAST,
        'O agendamento deve estar no futuro'
      )
    }
    
    // Retornar ISO 8601 UTC canônico com Z
    return parsedDate.toISOString()
  }
  
  throw new StageTransitionServiceError(
    StageTransitionErrorCode.INVALID_TRANSITION_ANSWERS_FORMAT,
    `Field type desconhecido: ${question.field_type}`
  )
}

// =====================================================
// MOVE OPPORTUNITY V2 PARAMS BUILDER
// =====================================================

/**
 * Prepara parâmetros para futura chamada move_opportunity_v2
 * NÃO executa a chamada (sem transporte)
 */
export function prepareMoveOpportunityV2Params(
  opportunityId: string,
  funnelId: string,
  fromStageId: string,
  toStageId: string,
  positionInStage: number,
  answers: StageTransitionAnswer[] | null
): MoveOpportunityV2Params {
  ensureFeatureEnabled()
  
  return {
    p_opportunity_id: opportunityId,
    p_funnel_id: funnelId,
    p_from_stage_id: fromStageId,
    p_to_stage_id: toStageId,
    p_position_in_stage: positionInStage,
    p_transition_answers: answers
  }
}

// =====================================================
// GATEWAY INTERFACES (Futuras)
// =====================================================

/**
 * Interface para futura implementação de acesso a perguntas
 * Etapa B: Apenas contrato, SEM implementação de transporte
 */
export interface StageTransitionQuestionsGateway {
  /**
   * Carrega perguntas ativas de uma etapa
   * Ordenadas por sort_order ASC
   */
  getActiveStageTransitionQuestions(
    companyId: string,
    funnelId: string,
    stageId: string
  ): Promise<StageTransitionQuestion[]>
  
  /**
   * Lista todas perguntas de uma etapa (ativas e inativas)
   */
  listStageTransitionQuestions(
    companyId: string,
    funnelId: string,
    stageId: string
  ): Promise<StageTransitionQuestion[]>
  
  /**
   * Cria nova pergunta
   */
  createStageTransitionQuestion(
    companyId: string,
    input: CreateStageTransitionQuestionInput
  ): Promise<StageTransitionQuestion>
  
  /**
   * Atualiza pergunta existente
   */
  updateStageTransitionQuestion(
    companyId: string,
    questionId: string,
    input: UpdateStageTransitionQuestionInput
  ): Promise<StageTransitionQuestion>
  
  /**
   * Reordena perguntas de uma etapa
   */
  reorderStageTransitionQuestions(
    companyId: string,
    stageId: string,
    questionIds: string[]
  ): Promise<void>
  
  /**
   * Habilita/desabilita perguntas em uma etapa
   */
  setStageTransitionQuestionsEnabled(
    companyId: string,
    stageId: string,
    enabled: boolean
  ): Promise<void>
}

/**
 * Interface para futura implementação de movimentação v2
 */
export interface MoveOpportunityV2Gateway {
  /**
   * Move oportunidade com suporte a transition questions
   */
  moveOpportunityV2(params: MoveOpportunityV2Params): Promise<void>
}

// =====================================================
// EXPORTS
// =====================================================

export {
  type StageTransitionQuestion,
  type StageTransitionAnswer,
  type StageTransitionFieldType,
  type StageTransitionErrorCode
} from '../types/stage-transition-questions'
