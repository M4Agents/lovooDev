/**
 * promptConfigValidator.ts
 *
 * Valida o shape de um prompt_config antes de persistir.
 * Não faz assembly — apenas verifica estrutura e limites.
 *
 * Chamado pelos endpoints company-agents-create e company-agents-update.
 */

import { SECTION_ORDER } from './variablesCatalog.js'

export const SECTION_MAX_CHARS   = 1500
export const PROMPT_MAX_CHARS    = 10000
export const VALID_CONFIG_VERSION = 1

export interface ValidationError {
  error:    string
  section?: string
  max?:     number
  actual?:  number
  received?: unknown
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; payload: ValidationError }

const VALID_SECTION_IDS = new Set<string>(SECTION_ORDER)

export function validatePromptConfig(config: unknown): ValidationResult {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, payload: { error: 'invalid_prompt_config' } }
  }

  const c = config as Record<string, unknown>

  // version
  if (c['version'] !== VALID_CONFIG_VERSION) {
    return { ok: false, payload: { error: 'invalid_config_version', received: c['version'] } }
  }

  // mode
  if (c['mode'] !== 'structured') {
    return { ok: false, payload: { error: 'invalid_mode', received: c['mode'] } }
  }

  // sections
  if (typeof c['sections'] !== 'object' || c['sections'] === null || Array.isArray(c['sections'])) {
    return { ok: false, payload: { error: 'invalid_sections' } }
  }

  const sections = c['sections'] as Record<string, unknown>

  for (const [sectionId, section] of Object.entries(sections)) {
    if (!VALID_SECTION_IDS.has(sectionId)) {
      return { ok: false, payload: { error: 'invalid_section_id', section: sectionId } }
    }

    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      return { ok: false, payload: { error: 'invalid_section', section: sectionId } }
    }

    const s = section as Record<string, unknown>

    if (typeof s['enabled'] !== 'boolean') {
      return { ok: false, payload: { error: 'invalid_section_enabled', section: sectionId } }
    }

    if (typeof s['content'] !== 'string') {
      return { ok: false, payload: { error: 'invalid_section_content', section: sectionId } }
    }

    if (s['content'].length > SECTION_MAX_CHARS) {
      return {
        ok: false,
        payload: {
          error:   'section_too_long',
          section: sectionId,
          max:     SECTION_MAX_CHARS,
          actual:  (s['content'] as string).length,
        },
      }
    }
  }

  return { ok: true }
}
