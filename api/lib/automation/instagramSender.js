// =====================================================
// instagramSender.js
//
// Wrapper do executor para o nó 'message' no canal Instagram.
// Chamado por executor.js quando context.triggerData.channel = 'instagram'.
//
// Responsabilidades:
//   - Extrair texto do nó (config.message/caption/question)
//   - Interpolar variáveis de contexto (mesmo padrão do whatsappSender)
//   - Verificar idempotência: não reenviar se já existe mensagem outbound
//     para automation_execution_id + automation_node_id
//   - Validar company_id, conversation_id e connection_id
//   - Confirmar que conversation.connection_id corresponde ao connectionId
//     configurado no gatilho do flow (isolamento de conta)
//   - Delegar envio ao instagramMessageService
//   - Retornar formato compatível com o executor
//
// NUNCA requer lead.phone ou lead_id — Instagram pode operar sem lead.
// =====================================================

import { sendInstagramMessage } from '../instagram/instagramMessageService.js';

/**
 * Processa o nó 'message' para o canal Instagram.
 *
 * @param {object} node    - Nó do flow com data.config
 * @param {object} context - Contexto da execution
 *   context.executionId, context.flowId, context.companyId,
 *   context.leadId (nullable), context.variables, context.triggerData
 * @param {object} supabase - Cliente Supabase (service_role)
 *
 * @returns {Promise<{ sent, igMessageId, conversationId, error?, skipped? }>}
 */
export async function sendInstagramMessageNode(node, context, supabase) {
  const config = node.data?.config || {}

  // Extrair texto raw (mesmo padrão do whatsappSender)
  const rawMessage = config.message || config.caption || config.question || ''

  if (!rawMessage) {
    return { skipped: true, reason: 'Texto do nó message está vazio' }
  }

  const companyId      = context.companyId
  const triggerData    = context.triggerData ?? {}
  const conversationId = triggerData.conversation_id ?? null
  const connectionId   = triggerData.connection_id   ?? null

  if (!companyId) {
    return { skipped: true, reason: 'companyId ausente no context' }
  }
  if (!conversationId) {
    return { skipped: true, reason: 'conversation_id ausente no triggerData' }
  }
  if (!connectionId) {
    return { skipped: true, reason: 'connection_id ausente no triggerData' }
  }

  // ── Validação multi-tenant: connection_id do trigger deve corresponder
  //    à conversa efetiva. Impede que flow da conta A envie para conversa da conta B.
  const { data: conversation, error: convErr } = await supabase
    .from('instagram_conversations')
    .select('id, company_id, connection_id')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (convErr || !conversation) {
    return { skipped: true, reason: `Conversa ${conversationId} não encontrada para empresa ${companyId}` }
  }

  if (conversation.connection_id !== connectionId) {
    return {
      skipped: true,
      reason:  `connection_id mismatch: flow=${connectionId} vs conversa=${conversation.connection_id}`,
    }
  }

  // ── Interpolar variáveis (mesmo mecanismo do whatsappSender.replaceVariables)
  const messageText = interpolateVariables(rawMessage, context.variables)

  if (!messageText.trim()) {
    return { skipped: true, reason: 'Texto após interpolação está vazio' }
  }

  // ── Idempotência de envio por execution + node
  //    Antes de enviar, verificar se já existe mensagem outbound para este par.
  //    Protege contra retries da execution (ex.: processador reiniciou).
  if (context.executionId && node.id) {
    const { data: existingMsg } = await supabase
      .from('instagram_messages')
      .select('id, ig_message_id, status')
      .eq('automation_execution_id', context.executionId)
      .eq('automation_node_id', node.id)
      .eq('company_id', companyId)
      .eq('direction', 'outbound')
      .maybeSingle()

    if (existingMsg) {
      console.log(`[ig-sender] execution=${context.executionId} node=${node.id} — mensagem já enviada (id=${existingMsg.id}, status=${existingMsg.status})`)
      return {
        sent:          true,
        igMessageId:   existingMsg.ig_message_id,
        conversationId,
        idempotent:    true,
      }
    }
  }

  // ── Enviar via serviço compartilhado ──────────────────────────────────────
  const result = await sendInstagramMessage({
    supabase,
    conversationId,
    companyId,
    text:                  messageText,
    sentBy:                null,             // automação: sem usuário
    origin:                'automation',
    automationExecutionId: context.executionId  ?? null,
    automationNodeId:      node.id             ?? null,
  })

  if (!result.ok) {
    return {
      sent:     false,
      error:    result.error,
      errorType:result.errorType,
      errorCode:result.errorCode,
    }
  }

  return {
    sent:          true,
    igMessageId:   result.igMessageId,
    conversationId,
    messageId:     result.savedMessage?.id ?? null,
  }
}

// ── Interpolação de variáveis ─────────────────────────────────────────────────
// Substitui {{variableName}} por valores de context.variables.
// Mesmo padrão do replaceVariables no whatsappSender.js.
// Sem acesso a lead/opportunity — funciona com null para Instagram.

function interpolateVariables(text, variables) {
  if (!text) return ''
  let result = text

  const vars = variables ?? {}
  for (const key of Object.keys(vars)) {
    const value = String(vars[key] ?? '')
    // {{key}} — double-brace padrão
    result = result.replace(new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g'), value)
    // Para custom_ vars: também {{custom.fieldName}}
    if (key.startsWith('custom_')) {
      const fieldName = key.replace('custom_', '')
      result = result.replace(new RegExp(`\\{\\{custom\\.${escapeRegex(fieldName)}\\}\\}`, 'g'), value)
    }
  }

  return result
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
