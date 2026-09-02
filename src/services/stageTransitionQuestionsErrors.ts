// =====================================================
// STAGE TRANSITION QUESTIONS - ERROR MAPPING
// Data: 02/09/2026 - Etapa B
// Objetivo: Catálogo centralizado de erros semânticos da RPC move_opportunity_v2
// =====================================================

import { StageTransitionErrorCode } from '../types/stage-transition-questions'

// =====================================================
// ERROR METADATA
// =====================================================

export interface StageTransitionErrorMetadata {
  code: StageTransitionErrorCode
  category: 'validation' | 'authorization' | 'configuration' | 'data_integrity'
  userMessage: string
  retryable: boolean
}

/**
 * Catálogo completo de erros semânticos da RPC move_opportunity_v2
 * Baseado em: supabase/migrations/20260820130000_recreate_move_opportunity_with_answers.sql
 * 
 * IMPORTANTE: Códigos devem corresponder EXATAMENTE aos da RPC
 */
export const ERROR_CATALOG: Record<StageTransitionErrorCode, StageTransitionErrorMetadata> = {
  // ===================================================
  // ERROS GERAIS (7)
  // ===================================================
  
  [StageTransitionErrorCode.POSITION_NOT_FOUND]: {
    code: StageTransitionErrorCode.POSITION_NOT_FOUND,
    category: 'data_integrity',
    userMessage: 'Posição da oportunidade não encontrada.',
    retryable: false
  },
  
  [StageTransitionErrorCode.OPPORTUNITY_NOT_FOUND]: {
    code: StageTransitionErrorCode.OPPORTUNITY_NOT_FOUND,
    category: 'data_integrity',
    userMessage: 'Oportunidade não encontrada.',
    retryable: false
  },
  
  [StageTransitionErrorCode.CROSS_TENANT_FUNNEL]: {
    code: StageTransitionErrorCode.CROSS_TENANT_FUNNEL,
    category: 'authorization',
    userMessage: 'Não foi possível concluir a movimentação.',
    retryable: false
  },
  
  [StageTransitionErrorCode.INVALID_STAGE_FUNNEL]: {
    code: StageTransitionErrorCode.INVALID_STAGE_FUNNEL,
    category: 'validation',
    userMessage: 'Etapa inválida ou incompatível com o funil.',
    retryable: false
  },
  
  [StageTransitionErrorCode.UNAUTHORIZED]: {
    code: StageTransitionErrorCode.UNAUTHORIZED,
    category: 'authorization',
    userMessage: 'Você não tem permissão para mover esta oportunidade.',
    retryable: false
  },
  
  [StageTransitionErrorCode.INVALID_TRANSITION_ANSWERS_FORMAT]: {
    code: StageTransitionErrorCode.INVALID_TRANSITION_ANSWERS_FORMAT,
    category: 'validation',
    userMessage: 'Formato inválido das respostas.',
    retryable: false
  },
  
  [StageTransitionErrorCode.DUPLICATE_QUESTION_ID]: {
    code: StageTransitionErrorCode.DUPLICATE_QUESTION_ID,
    category: 'validation',
    userMessage: 'Respostas duplicadas para a mesma pergunta.',
    retryable: false
  },
  
  // ===================================================
  // ERROS DE PERGUNTAS (5)
  // ===================================================
  
  [StageTransitionErrorCode.QUESTIONS_NOT_ENABLED]: {
    code: StageTransitionErrorCode.QUESTIONS_NOT_ENABLED,
    category: 'configuration',
    userMessage: 'Perguntas de transição não estão habilitadas para esta etapa.',
    retryable: false
  },
  
  [StageTransitionErrorCode.MISSING_REQUIRED_ANSWER]: {
    code: StageTransitionErrorCode.MISSING_REQUIRED_ANSWER,
    category: 'validation',
    userMessage: 'Existem perguntas obrigatórias não respondidas.',
    retryable: false
  },
  
  [StageTransitionErrorCode.INVALID_TRANSITION_QUESTION]: {
    code: StageTransitionErrorCode.INVALID_TRANSITION_QUESTION,
    category: 'configuration',
    userMessage: 'Pergunta de transição inválida ou inativa.',
    retryable: false
  },
  
  [StageTransitionErrorCode.TOO_MANY_ACTIVE_QUESTIONS]: {
    code: StageTransitionErrorCode.TOO_MANY_ACTIVE_QUESTIONS,
    category: 'configuration',
    userMessage: 'Limite de perguntas ativas excedido (máximo 15).',
    retryable: false
  },
  
  [StageTransitionErrorCode.INVALID_TRANSITION_QUESTION_CONFIG]: {
    code: StageTransitionErrorCode.INVALID_TRANSITION_QUESTION_CONFIG,
    category: 'configuration',
    userMessage: 'Configuração de pergunta inválida. Contate o administrador.',
    retryable: false
  },
  
  // ===================================================
  // ERROS DE VALIDAÇÃO (5)
  // ===================================================
  
  [StageTransitionErrorCode.EMPTY_ANSWER_VALUE]: {
    code: StageTransitionErrorCode.EMPTY_ANSWER_VALUE,
    category: 'validation',
    userMessage: 'Resposta vazia não é permitida.',
    retryable: false
  },
  
  [StageTransitionErrorCode.INVALID_SELECT_VALUE]: {
    code: StageTransitionErrorCode.INVALID_SELECT_VALUE,
    category: 'validation',
    userMessage: 'Opção selecionada inválida.',
    retryable: false
  },
  
  [StageTransitionErrorCode.INVALID_BOOLEAN]: {
    code: StageTransitionErrorCode.INVALID_BOOLEAN,
    category: 'validation',
    userMessage: 'Valor booleano inválido.',
    retryable: false
  },
  
  [StageTransitionErrorCode.INVALID_NUMBER]: {
    code: StageTransitionErrorCode.INVALID_NUMBER,
    category: 'validation',
    userMessage: 'Número inválido.',
    retryable: false
  },
  
  [StageTransitionErrorCode.INVALID_MULTI_SELECT_FORMAT]: {
    code: StageTransitionErrorCode.INVALID_MULTI_SELECT_FORMAT,
    category: 'validation',
    userMessage: 'Formato de seleção múltipla inválido.',
    retryable: false
  },
  
  // ===================================================
  // ERROS MULTI_SELECT (1)
  // ===================================================
  
  [StageTransitionErrorCode.INVALID_MULTI_SELECT_VALUE]: {
    code: StageTransitionErrorCode.INVALID_MULTI_SELECT_VALUE,
    category: 'validation',
    userMessage: 'Valor de seleção múltipla inválido.',
    retryable: false
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Obtém metadata de erro pelo código
 */
export function getErrorMetadata(code: StageTransitionErrorCode): StageTransitionErrorMetadata {
  return ERROR_CATALOG[code]
}

/**
 * Obtém mensagem amigável para o usuário
 * NÃO expõe detalhes técnicos ou cross-tenant
 */
export function getUserMessage(code: StageTransitionErrorCode): string {
  const metadata = ERROR_CATALOG[code]
  return metadata?.userMessage || 'Não foi possível concluir a operação.'
}

/**
 * Verifica se erro é retryable
 */
export function isRetryable(code: StageTransitionErrorCode): boolean {
  const metadata = ERROR_CATALOG[code]
  return metadata?.retryable || false
}

/**
 * Obtém categoria do erro
 */
export function getErrorCategory(code: StageTransitionErrorCode): string {
  const metadata = ERROR_CATALOG[code]
  return metadata?.category || 'unknown'
}

/**
 * Lista todos os códigos de erro disponíveis
 */
export function getAllErrorCodes(): StageTransitionErrorCode[] {
  return Object.keys(ERROR_CATALOG) as StageTransitionErrorCode[]
}

/**
 * Valida se código é conhecido
 */
export function isKnownErrorCode(code: string): code is StageTransitionErrorCode {
  return code in ERROR_CATALOG
}
