// =====================================================
// POST /api/agents/run-context-builder
//
// ContextBuilder — recebe OrchestratorContext e monta
// o contexto completo para o AgentExecutor (LLM).
//
// ESTADO ATUAL: Stub da Etapa 5 (aguardando Etapa 6)
//   Valida e loga o OrchestratorContext recebido.
//   Retorna { success: true } sem executar o LLM.
//
// PRÓXIMAS ETAPAS A IMPLEMENTAR AQUI:
//
//   Etapa 6 — ContextBuilder:
//     - Buscar system_prompt do agente (lovoo_agents.prompt)
//     - Buscar histórico de mensagens via chat_get_messages
//     - Buscar produtos/serviços da empresa (RAG)
//     - Filtrar dados conforme capabilities:
//         can_inform_prices → incluir/excluir preços
//         can_send_media    → incluir/excluir mídias
//     - Montar FullContext para o AgentExecutor
//
//   Etapa 7 — AgentExecutor:
//     - Chamar OpenAI (runner.ts) com FullContext
//     - Registrar execução em ai_agent_execution_logs
//
//   Etapa 8 — ResponseComposer:
//     - Quebrar resposta do LLM em blocos tipados:
//         text | media | question | cta | handoff_notice
//
//   Etapa 9 — WhatsAppGateway:
//     - Enviar cada bloco via Uazapi (backend, service_role)
//     - Persistir cada bloco como chat_message (is_ai_generated = true)
//
// ACESSO:
//   Chamado internamente por execute-agent (fire-and-forget).
//   Sem JWT de usuário — validar origin via secret header pós-MVP.
//
// CORPO ESPERADO (OrchestratorContext):
//   {
//     run_id:               UUID,
//     session_id:           UUID,
//     is_new_session:       boolean,
//     assignment_id:        UUID,
//     agent_id:             UUID,
//     rule_id:              UUID,
//     capabilities:         { can_auto_reply, can_send_media, can_inform_prices, ... },
//     price_display_policy: 'disabled' | 'fixed_only' | 'range_allowed' | 'consult_only',
//     conversation: {
//       id:            UUID,
//       contact_phone: string,
//       ai_state:      'ai_active'
//     },
//     event: {
//       event_type, channel, company_id, instance_id,
//       conversation_id, uazapi_message_id, source_type,
//       source_identifier, message_text, saved_message_id, timestamp
//     }
//   }
// =====================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
  }

  // ── 1. Validação do OrchestratorContext ──────────────────────────────────

  const context = req.body;

  if (!context || typeof context !== 'object') {
    console.error('🤖 [CTX] ❌ OrchestratorContext inválido ou ausente');
    return res.status(400).json({ success: false, error: 'OrchestratorContext inválido.' });
  }

  const requiredFields = ['run_id', 'session_id', 'assignment_id', 'agent_id', 'conversation', 'event'];
  const missingFields  = requiredFields.filter(f => !context[f]);

  if (missingFields.length > 0) {
    console.error('🤖 [CTX] ❌ OrchestratorContext incompleto — campos ausentes:', missingFields);
    return res.status(400).json({
      success: false,
      error:   `OrchestratorContext incompleto: ${missingFields.join(', ')}`
    });
  }

  // ── 2. Log estruturado — observabilidade da Etapa 5 ─────────────────────
  // Confirma que o Orchestrator está entregando contextos corretos.

  console.log('🤖 [CTX] ─── ORCHESTRATOR CONTEXT RECEBIDO ──────────────────');
  console.log('🤖 [CTX] run_id:               ', context.run_id);
  console.log('🤖 [CTX] session_id:           ', context.session_id);
  console.log('🤖 [CTX] is_new_session:        ', context.is_new_session);
  console.log('🤖 [CTX] assignment_id:         ', context.assignment_id);
  console.log('🤖 [CTX] agent_id:              ', context.agent_id);
  console.log('🤖 [CTX] rule_id:               ', context.rule_id);
  console.log('🤖 [CTX] price_display_policy:  ', context.price_display_policy);
  console.log('🤖 [CTX] capabilities:          ', JSON.stringify(context.capabilities));
  console.log('🤖 [CTX] conversation.id:       ', context.conversation?.id);
  console.log('🤖 [CTX] conversation.ai_state: ', context.conversation?.ai_state);
  console.log('🤖 [CTX] event.message_text:    ', context.event?.message_text?.substring(0, 80));
  console.log('🤖 [CTX] event.company_id:      ', context.event?.company_id);
  console.log('🤖 [CTX] ─── FIM DO CONTEXT ─────────────────────────────────');

  // ── 3. [STUB Etapa 5] Processamento futuro ────────────────────────────────
  //
  // TODO Etapa 6: ContextBuilder
  //   - Buscar system_prompt do agente
  //   - Buscar histórico de mensagens (chat_get_messages)
  //   - Buscar produtos/serviços da empresa
  //   - Filtrar dados por capabilities
  //   - Montar FullContext para AgentExecutor

  console.log('🤖 [CTX] ✅ Stub Etapa 5: OrchestratorContext recebido, ContextBuilder pendente (Etapa 6)');

  // ── 4. Resposta ───────────────────────────────────────────────────────────

  return res.status(200).json({
    success: true,
    status:  'received',
    message: 'OrchestratorContext recebido. ContextBuilder pendente (Etapa 6).',
    context: {
      run_id:          context.run_id,
      session_id:      context.session_id,
      assignment_id:   context.assignment_id,
      agent_id:        context.agent_id,
      conversation_id: context.event?.conversation_id
    }
  });
}
