import {
  TEMPLATE_CREATE_LANGUAGES,
  TEMPLATE_CREATE_LIMITS,
  buildGraphCreatePayload,
  listTemplateCreateVariables,
} from '../../../api/lib/meta-whatsapp/templateCreate.js'

export { TEMPLATE_CREATE_LANGUAGES, TEMPLATE_CREATE_LIMITS, listTemplateCreateVariables }

export const CREATE_ERROR_MESSAGES: Record<string, string> = {
  invalid_template_name: 'Use só letras minúsculas, números e underline, sem espaços.',
  invalid_template_language: 'Selecione um idioma válido.',
  invalid_template_category: 'Escolha Utilidade ou Marketing.',
  invalid_template_body: 'O texto da mensagem é obrigatório e deve ter até 1024 caracteres.',
  invalid_template_header: 'O cabeçalho deve ter até 60 caracteres e no máximo uma variável.',
  invalid_template_footer: 'O rodapé deve ter até 60 caracteres e não pode ter variáveis.',
  invalid_template_variables: 'As variáveis precisam ser {{1}}, {{2}}... em ordem, ou nomes como {{nome_cliente}}.',
  invalid_template_examples: 'Preencha um exemplo para cada variável do texto.',
  authentication_not_supported: 'Modelos de autenticação não podem ser criados nesta etapa.',
  buttons_not_supported: 'Botões ainda não podem ser criados nesta etapa.',
  media_not_supported: 'Cabeçalho de imagem, vídeo ou documento ainda não pode ser criado nesta etapa.',
  instance_not_found: 'Conta Meta não encontrada.',
  instance_not_connected: 'Conecte a Cloud API antes de enviar um modelo.',
  provider_unavailable: 'Não foi possível confirmar a resposta da Meta. Atualize a lista antes de tentar novamente — o modelo pode já ter sido recebido.',
  provider_error: 'A Meta recusou este modelo. Revise o conteúdo e tente novamente.',
  invalid_request: 'Não foi possível enviar o modelo. Verifique os campos e tente novamente.',
}

export function createErrorMessage(code: string): string {
  return CREATE_ERROR_MESSAGES[code] ?? code
}

export type CreateErrorField = 'name' | 'language' | 'category' | 'header' | 'body' | 'footer' | 'examples' | 'form'

export function fieldForCreateError(code: string): CreateErrorField {
  if (code === 'invalid_template_name') return 'name'
  if (code === 'invalid_template_language') return 'language'
  if (code === 'invalid_template_category') return 'category'
  if (code === 'invalid_template_header') return 'header'
  if (code === 'invalid_template_body' || code === 'invalid_template_variables') return 'body'
  if (code === 'invalid_template_footer') return 'footer'
  if (code === 'invalid_template_examples') return 'examples'
  return 'form'
}

export function validateCreateDraft(input: {
  name: string
  language: string
  category: 'UTILITY' | 'MARKETING'
  header_text: string
  body_text: string
  footer_text: string
  examples?: { header?: Record<string, string>; body?: Record<string, string> }
}): { ok: true } | { ok: false; error: string } {
  const result = buildGraphCreatePayload(input)
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}
