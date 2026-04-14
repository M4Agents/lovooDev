// =====================================================
// CONTEXT TYPES — contrato formal do AutomationContext
//
// Este arquivo é APENAS documentação (JSDoc typedef).
// Não exporta lógica executável.
//
// O AutomationContext é o objeto que transita por todos
// os nós do motor de automação (executor.js).
//
// Criado em dois pontos:
//   - processFlowAsync  → execução inicial de um flow
//   - resumeFromNode    → retomada após delay ou user_input
//
// Regras:
//   - Campos obrigatórios nunca devem ser null/undefined
//   - Campos opcionais devem ser explicitamente null (não undefined)
//   - Nunca importar nada de src/ dentro de api/
// =====================================================

/**
 * Contrato do objeto de contexto que transita por todos os nós
 * do motor de automação backend.
 *
 * @typedef {Object} AutomationContext
 *
 * @property {string} executionId
 *   UUID da execução em andamento (automation_executions.id).
 *   Obrigatório. Nunca null.
 *   Usado por: createLog, updateExecutedNodes, completeExecution,
 *              pauseAtDelay, pauseAtUserInput.
 *
 * @property {string} flowId
 *   UUID do flow sendo executado (automation_flows.id).
 *   Obrigatório. Nunca null.
 *   Usado por: createLog, pauseAtDelay (schedule).
 *
 * @property {string} companyId
 *   UUID da empresa — isolamento multi-tenant.
 *   Obrigatório. Nunca null. Sensível.
 *   Usado por: todos os módulos (createLog, crmActions, whatsappSender...).
 *
 * @property {number|null} leadId
 *   ID inteiro do lead associado à execução.
 *   Opcional. Null quando o flow não possui contexto de lead.
 *   Usado por: conditionEval (resolveLeadId), crmActions (resolveLeadId).
 *   Fallback: se null, resolveLeadId tenta via opportunityId.
 *
 * @property {string|null} opportunityId
 *   UUID da oportunidade associada à execução.
 *   Opcional. Null quando o flow não possui contexto de oportunidade.
 *   Usado por: conditionEval (opportunity conditions),
 *              crmActions (opportunity actions),
 *              whatsappSender (resolveLead → phone).
 *
 * @property {Record<string, any>} triggerData
 *   Payload bruto do evento que iniciou o flow (trigger_data no banco).
 *   Obrigatório. Mínimo: {}.
 *   Conteúdo varia por event_type:
 *     lead.created          → { lead_id, source }
 *     tag.added/removed     → { lead_id, tag_id, tag_name }
 *     opportunity.*         → { opportunity_id, lead_id, funnel_id, stage_id, loss_reason? }
 *     opportunity.stage_changed → { opportunity_id, old_stage, new_stage, lead_id, opportunity: {...} }
 *     message.received      → { lead_id, conversation_id, instance_id, message_id, text, channel }
 *   Usado por: nó start/trigger (retorna como output).
 *
 * @property {Record<string, any>} variables
 *   Variáveis de runtime do usuário.
 *   Obrigatório. Mínimo: {}.
 *   Não contém _awaiting_input (campo interno salvo apenas no banco).
 *   Após resume de user_input, contém a resposta do usuário na chave
 *   configurada no nó (ex: variables.user_response).
 *   Usado por: pauseAtUserInput, whatsappSender.replaceVariables.
 *
 * @property {string|null} instanceId
 *   UUID da instância WhatsApp (whatsapp_life_instances.id).
 *   Opcional. Null quando não configurado.
 *   Resolvido por resolveInstanceId() com prioridade:
 *     1. trigger_data.instance_id (snake_case — padrão dispatchers)
 *     2. trigger_data.instanceId  (camelCase  — compatibilidade legado)
 *     3. triggerNode.data.triggers[enabled].config.instanceId (config do flow)
 *   Usado por: whatsappSender.resolveConversation, whatsappSender.resolveInstance.
 *
 * @property {string|null} conversationId
 *   UUID da conversa WhatsApp (chat_conversations.id).
 *   Opcional. Null para eventos que não são message.received.
 *
 *   REGRA DE FONTE ÚNICA (evitar divergência como ocorreu com instanceId):
 *     - Fonte de verdade: trigger_data.conversation_id  (snake_case — padrão dos dispatchers)
 *     - trigger_data.conversationId existe apenas como compatibilidade com payloads legados
 *     - Não derivar de outras fontes (ex: chat_conversations.id via lookup) sem necessidade real
 *
 *   Usado por: futuras condições de canal e nós de distribuição/execute_agent.
 *
 * @property {number|null} [_resolvedLeadId]
 *   Cache interno — preenchido por resolveLeadId() (contextUtils.js) após query ao banco.
 *   Evita queries repetidas no mesmo ciclo de execução.
 *
 *   BLINDAGEM — este campo:
 *     - NÃO faz parte do contrato público do AutomationContext
 *     - NÃO deve entrar em context.variables
 *     - NÃO deve entrar em output_data de automation_logs
 *     - NÃO deve ser serializado nem retornado em respostas de API
 *     - NÃO é persistido no banco em nenhum momento
 *     - Não sobrevive entre ciclos (cada resumeFromNode cria um context novo)
 */

// Exportação vazia — este arquivo é apenas documentação.
export {}
