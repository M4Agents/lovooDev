// =====================================================
// UTILITÁRIO: Campos Personalizados
// Formata o valor de um campo personalizado para exibição.
// Tipos reais existentes no banco: text | number | date | boolean | select
// =====================================================

/**
 * Formata o valor de um campo personalizado para exibição ao usuário.
 *
 * Regras:
 * - boolean → "Sim" / "Não"
 * - date    → formato pt-BR (dd/mm/yyyy), com proteção contra data inválida
 * - number  → valor como string (sem formatação monetária)
 * - text / select → valor bruto
 * - vazio   → string vazia (chamador decide se omite a linha)
 */
export function formatCustomFieldValue(value: string | undefined | null, fieldType: string): string {
  if (value === undefined || value === null || value === '') return ''

  switch (fieldType) {
    case 'boolean':
      return value === 'true' ? 'Sim' : 'Não'

    case 'date': {
      const d = new Date(value)
      if (isNaN(d.getTime())) return value
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d)
    }

    case 'number':
    case 'text':
    case 'select':
    default:
      return value
  }
}

/**
 * Prefixo usado para identificar campos personalizados em visible_fields.
 * Exemplo: "cf_<uuid>"
 */
export const CUSTOM_FIELD_PREFIX = 'cf_'

/** Converte um field_id em chave de visible_fields. */
export function toCustomFieldKey(fieldId: string): string {
  return `${CUSTOM_FIELD_PREFIX}${fieldId}`
}

/** Extrai o field_id de uma chave de visible_fields. */
export function fromCustomFieldKey(key: string): string {
  return key.slice(CUSTOM_FIELD_PREFIX.length)
}

/** Verifica se uma chave de visible_fields é de campo personalizado. */
export function isCustomFieldKey(key: string): boolean {
  return key.startsWith(CUSTOM_FIELD_PREFIX)
}
