/**
 * promptAssembler.ts
 *
 * Único responsável por montar o campo `prompt` a partir de `prompt_config`.
 * Determinístico: mesma entrada → mesmo output, sempre.
 *
 * Regras de assembly:
 *   - Itera SECTION_ORDER (ordem fixa, imutável pelo usuário)
 *   - Seção ausente no config → omitida
 *   - Seção com enabled: false → omitida
 *   - Seção com content.trim() === '' → omitida
 *   - Apenas content.trim() — conteúdo interno preservado integralmente
 *   - Separador entre seções: '\n\n---\n\n'
 *   - Resultado final com .trim()
 *   - Erro se nenhuma seção ativa ou se total exceder PROMPT_MAX_CHARS
 */

import { SECTION_ORDER, SECTION_CATALOG, type SectionId, type PromptConfig } from './variablesCatalog.js'
import { PROMPT_MAX_CHARS } from './promptConfigValidator.js'

export interface AssemblyResult {
  prompt:       string
  totalChars:   number
  sectionsUsed: SectionId[]
}

export interface AssemblyError {
  error:   string
  max?:    number
  actual?: number
}

export type AssemblyOutcome =
  | { ok: true;  result: AssemblyResult }
  | { ok: false; payload: AssemblyError }

export function assemblePrompt(config: PromptConfig): AssemblyOutcome {
  const parts: string[]       = []
  const sectionsUsed: SectionId[] = []

  for (const sectionId of SECTION_ORDER) {
    const section = config.sections[sectionId]
    if (!section)           continue
    if (!section.enabled)   continue
    const trimmed = section.content.trim()
    if (!trimmed)           continue

    const { label } = SECTION_CATALOG[sectionId]
    parts.push(`## ${label}\n\n${trimmed}`)
    sectionsUsed.push(sectionId)
  }

  if (parts.length === 0) {
    return { ok: false, payload: { error: 'no_active_sections' } }
  }

  const prompt = parts.join('\n\n---\n\n').trim()

  if (prompt.length > PROMPT_MAX_CHARS) {
    return {
      ok: false,
      payload: { error: 'prompt_too_long', max: PROMPT_MAX_CHARS, actual: prompt.length },
    }
  }

  return { ok: true, result: { prompt, totalChars: prompt.length, sectionsUsed } }
}
