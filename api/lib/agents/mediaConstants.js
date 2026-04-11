// =============================================================================
// api/lib/agents/mediaConstants.js
//
// Mapeamento canônico intent (tool) → catalog_media_usage_role (banco).
// Única fonte de verdade — não duplicar em outros arquivos.
// =============================================================================

/** @type {Record<string, string>} */
export const INTENT_TO_USAGE_ROLE = {
  presentation: 'presentation',
  proof: 'proof',
  detail: 'demo',
}
