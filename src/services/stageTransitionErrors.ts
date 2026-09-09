// =====================================================
// CHAT.Q2 — Helper Centralizado de Erros
// Data: 09/09/2026
// =====================================================

/**
 * Mapeia erros de transição de etapa para mensagens em pt-BR
 */
export function getTransitionErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Erro desconhecido ao mover oportunidade. Tente novamente.'
  }

  const errorMessage = error.message || ''

  // Erros de validação do RPC
  if (errorMessage.includes('MISSING_REQUIRED_ANSWER')) {
    return 'Resposta obrigatória não foi fornecida.'
  }

  if (errorMessage.includes('INVALID_TRANSITION_QUESTION')) {
    return 'Pergunta de transição inválida. As perguntas podem ter sido alteradas.'
  }

  if (errorMessage.includes('UNAUTHORIZED')) {
    return 'Você não tem permissão para mover esta oportunidade.'
  }

  if (errorMessage.includes('não está na etapa de origem')) {
    return 'A oportunidade foi movida por outro usuário.'
  }

  // Erros de permissão RBAC
  if (errorMessage.includes('FORBIDDEN') || errorMessage.includes('forbidden')) {
    return 'Você não tem permissão para acessar esta etapa.'
  }

  // Erros de integridade
  if (errorMessage.includes('POSITION_NOT_FOUND')) {
    return 'Posição da oportunidade não encontrada. A oportunidade pode ter sido movida por outro usuário.'
  }

  if (errorMessage.includes('STAGE_NOT_FOUND')) {
    return 'Etapa não encontrada. A configuração do funil pode ter sido alterada.'
  }

  if (errorMessage.includes('OPPORTUNITY_NOT_FOUND')) {
    return 'Oportunidade não encontrada. Ela pode ter sido excluída.'
  }

  // Erros de tenant/company
  if (errorMessage.includes('COMPANY_MISMATCH')) {
    return 'Erro de permissão: empresa não corresponde.'
  }

  // Erros de feature flag
  if (errorMessage.includes('FEATURE_NOT_ENABLED')) {
    return 'Este recurso não está habilitado para sua empresa.'
  }

  // Erros de rede/timeout
  if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
    return 'A operação demorou muito. Verifique sua conexão e tente novamente.'
  }

  if (errorMessage.includes('network') || errorMessage.includes('NETWORK')) {
    return 'Erro de conexão. Verifique sua internet e tente novamente.'
  }

  // Fallback genérico
  return 'Erro ao mover oportunidade. Tente novamente.'
}

/**
 * Mapeia erros de precheck para mensagens em pt-BR
 */
export function getPrecheckErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Erro ao carregar perguntas de transição.'
  }

  const errorMessage = error.message || ''

  if (errorMessage.includes('timeout') || errorMessage.includes('TIMEOUT')) {
    return 'Tempo esgotado ao carregar perguntas. Tente novamente.'
  }

  if (errorMessage.includes('network') || errorMessage.includes('NETWORK')) {
    return 'Erro de conexão ao carregar perguntas. Verifique sua internet.'
  }

  if (errorMessage.includes('STAGE_NOT_FOUND')) {
    return 'Etapa não encontrada. A configuração pode ter sido alterada.'
  }

  return 'Erro ao carregar perguntas de transição.'
}
