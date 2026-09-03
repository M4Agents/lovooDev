// =====================================================
// STAGE TRANSITION QUESTIONS TRANSPORT
// Data: 02/09/2026 - Etapa E
//
// HTTP Adapter para endpoints /api/stage-transition-questions/*
// Conecta Service Layer (Etapa B) aos endpoints backend (Etapa D)
//
// NÃO usa Supabase direto (proibido para tabelas R1)
// Usa fetch com Bearer token
// =====================================================

import { supabase } from '../lib/supabase'
import { isStageTransitionQuestionsFeatureEnabled } from '../hooks/dashboard/useFeatureFlags'
import { StageTransitionServiceError, type StageTransitionErrorCode } from './stageTransitionQuestionsService'
import type { StageTransitionQuestion } from '../types/stage-transition-questions'

// =====================================================
// TYPES
// =====================================================

interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface CreateQuestionInput {
  funnel_stage_id: string
  label: string
  field_type: 'text' | 'number' | 'boolean' | 'select' | 'multi_select' | 'datetime'
  required: boolean
  options: string[] | null
  sort_order?: number
  create_activity_on_answer?: boolean
}

export interface UpdateQuestionInput {
  question_id: string
  label?: string
  required?: boolean
  sort_order?: number
  create_activity_on_answer?: boolean
}

export interface QuestionOrder {
  id: string
  sort_order: number
}

// =====================================================
// HELPERS
// =====================================================

/**
 * Obtém access_token da sessão Supabase
 */
async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new StageTransitionServiceError(
      'AUTH_ERROR' as StageTransitionErrorCode,
      'Sessão expirada'
    )
  }
  return session.access_token
}

/**
 * Wrapper genérico para fetch com Bearer token
 */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken()

  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  const text = await res.text()
  let json: ApiResponse<T>

  try {
    json = JSON.parse(text) as ApiResponse<T>
  } catch {
    throw new StageTransitionServiceError(
      'INVALID_RESPONSE' as StageTransitionErrorCode,
      `Erro ${res.status}: resposta inválida do servidor`
    )
  }

  if (!json.ok || !json.data) {
    // Mapear HTTP status para error code
    const errorMessage = json.error ?? `Erro ${res.status}`
    const errorCode = mapHttpStatusToErrorCode(res.status, errorMessage)
    throw new StageTransitionServiceError(errorCode, errorMessage)
  }

  return json.data
}

/**
 * Mapeia HTTP status + mensagem para StageTransitionErrorCode
 */
function mapHttpStatusToErrorCode(
  status: number,
  message: string
): StageTransitionErrorCode {
  // Feature desabilitada no backend
  if (status === 503) {
    return 'FEATURE_DISABLED' as StageTransitionErrorCode
  }

  // Auth errors
  if (status === 401) {
    return 'AUTH_ERROR' as StageTransitionErrorCode
  }

  // Permission errors
  if (status === 403) {
    return 'PERMISSION_DENIED' as StageTransitionErrorCode
  }

  // Not found
  if (status === 404) {
    return 'QUESTION_NOT_FOUND' as StageTransitionErrorCode
  }

  // Conflict errors (tentar detectar por mensagem)
  if (status === 409) {
    if (message.includes('limite') || message.includes('15')) {
      return 'MAX_ACTIVE_QUESTIONS' as StageTransitionErrorCode
    }
    if (message.includes('field_type')) {
      return 'QUESTION_STRUCTURE_IMMUTABLE' as StageTransitionErrorCode
    }
    if (message.includes('options')) {
      return 'QUESTION_STRUCTURE_IMMUTABLE' as StageTransitionErrorCode
    }
    if (message.includes('data e hora configurada para criar atividade')) {
      return 'ACTIVITY_DATETIME_ALREADY_EXISTS' as StageTransitionErrorCode
    }
    return 'CONFLICT_ERROR' as StageTransitionErrorCode
  }

  // Bad request (validação)
  if (status === 400) {
    if (message.includes('field_type')) {
      return 'INVALID_FIELD_TYPE' as StageTransitionErrorCode
    }
    if (message.includes('options')) {
      return 'INVALID_OPTIONS' as StageTransitionErrorCode
    }
    return 'VALIDATION_ERROR' as StageTransitionErrorCode
  }

  // Server error
  if (status >= 500) {
    return 'SERVER_ERROR' as StageTransitionErrorCode
  }

  // Unknown
  return 'UNKNOWN_ERROR' as StageTransitionErrorCode
}

// =====================================================
// FEATURE GUARD
// =====================================================

/**
 * Guard: feature deve estar habilitada antes de qualquer fetch
 */
function ensureFeatureEnabled(): void {
  if (!isStageTransitionQuestionsFeatureEnabled()) {
    throw new StageTransitionServiceError(
      'FEATURE_DISABLED' as StageTransitionErrorCode,
      'Funcionalidade de perguntas de transição não está habilitada'
    )
  }
}

// =====================================================
// TRANSPORT FUNCTIONS
// =====================================================

/**
 * GET /api/stage-transition-questions/list
 * Lista perguntas de uma stage (admin)
 */
export async function fetchAllQuestions(
  stageId: string,
  includeInactive: boolean = false
): Promise<StageTransitionQuestion[]> {
  ensureFeatureEnabled()

  const params = new URLSearchParams({
    funnel_stage_id: stageId,
    ...(includeInactive && { include_inactive: 'true' })
  })

  const response = await apiFetch<{ questions: StageTransitionQuestion[] }>(
    `/api/stage-transition-questions/list?${params}`
  )

  return response.questions
}

/**
 * GET /api/stage-transition-questions/get-active
 * Busca perguntas ativas (runtime)
 */
export async function fetchActiveQuestions(
  stageId: string
): Promise<StageTransitionQuestion[]> {
  ensureFeatureEnabled()

  const params = new URLSearchParams({
    funnel_stage_id: stageId
  })

  const response = await apiFetch<{ questions: StageTransitionQuestion[] }>(
    `/api/stage-transition-questions/get-active?${params}`
  )

  return response.questions
}

/**
 * POST /api/stage-transition-questions/create
 * Cria nova pergunta
 */
export async function createQuestion(
  input: CreateQuestionInput
): Promise<StageTransitionQuestion> {
  ensureFeatureEnabled()

  const response = await apiFetch<{ question: StageTransitionQuestion }>(
    '/api/stage-transition-questions/create',
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  )

  return response.question
}

/**
 * PUT /api/stage-transition-questions/update
 * Atualiza pergunta existente
 */
export async function updateQuestion(
  input: UpdateQuestionInput
): Promise<StageTransitionQuestion> {
  ensureFeatureEnabled()

  const response = await apiFetch<{ question: StageTransitionQuestion }>(
    '/api/stage-transition-questions/update',
    {
      method: 'PUT',
      body: JSON.stringify(input)
    }
  )

  return response.question
}

/**
 * PUT /api/stage-transition-questions/set-active
 * Ativa/desativa pergunta
 */
export async function setQuestionActive(
  questionId: string,
  active: boolean
): Promise<StageTransitionQuestion> {
  ensureFeatureEnabled()

  const response = await apiFetch<{ question: StageTransitionQuestion }>(
    '/api/stage-transition-questions/set-active',
    {
      method: 'PUT',
      body: JSON.stringify({
        question_id: questionId,
        active
      })
    }
  )

  return response.question
}

/**
 * PUT /api/stage-transition-questions/reorder
 * Reordena perguntas
 */
export async function reorderQuestions(
  stageId: string,
  questionOrder: QuestionOrder[]
): Promise<number> {
  ensureFeatureEnabled()

  const response = await apiFetch<{ updated_count: number }>(
    '/api/stage-transition-questions/reorder',
    {
      method: 'PUT',
      body: JSON.stringify({
        funnel_stage_id: stageId,
        question_order: questionOrder
      })
    }
  )

  return response.updated_count
}

/**
 * PUT /api/stage-transition-questions/set-stage-enabled
 * Habilita/desabilita perguntas para uma stage
 */
export async function setStageEnabled(
  stageId: string,
  enabled: boolean
): Promise<{ id: string; enable_transition_questions: boolean }> {
  ensureFeatureEnabled()

  const response = await apiFetch<{ stage: { id: string; enable_transition_questions: boolean } }>(
    '/api/stage-transition-questions/set-stage-enabled',
    {
      method: 'PUT',
      body: JSON.stringify({
        funnel_stage_id: stageId,
        enabled
      })
    }
  )

  return response.stage
}

// =====================================================
// GET STAGE CONFIG (Explicit enabled state + count)
// =====================================================

export interface StageTransitionConfig {
  enabled: boolean
  activeQuestionCount: number
}

/**
 * GET /api/stage-transition-questions/get-stage-config
 * Retorna configuração explícita da stage
 */
export async function fetchStageConfig(
  stageId: string
): Promise<StageTransitionConfig> {
  ensureFeatureEnabled()

  const response = await apiFetch<{ enabled: boolean; activeQuestionCount: number }>(
    `/api/stage-transition-questions/get-stage-config?funnel_stage_id=${encodeURIComponent(stageId)}`,
    {
      method: 'GET'
    }
  )

  return {
    enabled: response.enabled,
    activeQuestionCount: response.activeQuestionCount
  }
}
