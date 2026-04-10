/**
 * promptVariables.ts
 *
 * Re-exporta o catálogo de variáveis e seções a partir da fonte única de verdade:
 *   api/lib/agents/variablesCatalog.ts
 *
 * Este arquivo existe apenas para manter compatibilidade com imports existentes
 * no frontend (PromptEditor, CompanyOwnAgentsPanel, etc.).
 * NÃO duplicar dados aqui — sempre importar do catálogo.
 */

export type {
  PromptVariable,
  PromptSection,
  PromptConfig,
  SectionId,
  SectionMeta,
} from '../../api/lib/agents/variablesCatalog'

export {
  PROMPT_VARIABLES,
  PROMPT_VARIABLE_GROUPS,
  SECTION_ORDER,
  SECTION_CATALOG,
  customFieldsToVariables,
} from '../../api/lib/agents/variablesCatalog'
