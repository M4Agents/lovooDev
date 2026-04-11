// =============================================================================
// validTools.ts
//
// Fonte única de verdade para a whitelist de tools liberáveis por agente.
//
// Usada pelos endpoints de criação e atualização de agentes para sanitizar
// o campo allowed_tools antes de persistir no banco.
//
// Para adicionar uma nova tool:
//   1. Incluir aqui
//   2. Garantir que toolDefinitions.js e toolExecutor.js a suportam
//   3. Adicionar no toolCatalog.ts (frontend) para exibição na UI
// =============================================================================

export const VALID_TOOL_NAMES = new Set([
  'update_lead',
  'add_tag',
  'add_note',
  'update_opportunity',
  'move_opportunity',
  'create_activity',
  'schedule_contact',
  'request_handoff',
  'send_media',
])
