// =====================================================
// POST /api/agents/execute-agent
//
// Executor do agente de conversação — recebe RouterDecision
// e orquestra todo o processamento de IA.
//
// ESTADO ATUAL: Stub da Etapa 4 (aguardando Etapa 5)
//   Valida e loga o RouterDecision recebido.
//   Retorna { success: true } sem executar o agente ainda.
//
// PRÓXIMAS ETAPAS A IMPLEMENTAR AQUI:
//
//   Etapa 5 — ConversationOrchestrator:
//     - Adquirir lock em agent_processing_locks (idempotência por conversa)
//     - Verificar/criar agent_conversation_sessions
//     - Revalidar capabilities antes de prosseguir
//
//   Etapa 6 — ContextBuilder:
//     - Buscar histórico de mensagens (chat_get_messages)
//     - Buscar produtos/serviços da empresa (RAG)
//     - Filtrar dados conforme capabilities (preços, mídias)
//     - Montar system_prompt + context para o LLM
//
//   Etapa 7 — AgentExecutor:
//     - Chamar runner.ts com o contexto montado
//     - Registrar em ai_agent_execution_logs
//
//   Etapa 8 — ResponseComposer:
//     - Quebrar resposta do LLM em blocos (text, media, question, cta)
//     - Definir ordem e delay de cada bloco
//
//   Etapa 9 — WhatsAppGateway:
//     - Enviar cada bloco via Uazapi (backend, service_role)
//     - Persistir cada bloco como chat_message (is_ai_generated = true)
//     - Liberar lock após envio completo
//
// ACESSO:
//   Chamado internamente por process-conversation-event (fire-and-forget).
//   Sem JWT de usuário — validar origin via secret header pós-MVP.
//
// CORPO ESPERADO (RouterDecision):
//   {
//     should_process:       true,
//     skip_reason:          null,
//     rule_id:              UUID,
//     assignment_id:        UUID,
//     agent_id:             UUID,
//     capabilities:         { can_auto_reply, can_send_media, ... },
//     price_display_policy: 'disabled' | 'fixed_only' | ...,
//     conversation: {
//       id, ai_state, ai_assignment_id, contact_phone
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

  // ── 1. Validação do RouterDecision ────────────────────────────────────────

  const decision = req.body;

  if (!decision || typeof decision !== 'object') {
    console.error('🤖 [EXECUTE] ❌ RouterDecision inválido ou ausente');
    return res.status(400).json({ success: false, error: 'RouterDecision inválido.' });
  }

  // Campos obrigatórios que o Router garante quando should_process = true
  const requiredFields = ['assignment_id', 'agent_id', 'rule_id', 'conversation', 'event'];
  const missingFields  = requiredFields.filter(f => !decision[f]);

  if (missingFields.length > 0) {
    console.error('🤖 [EXECUTE] ❌ RouterDecision incompleto — campos ausentes:', missingFields);
    return res.status(400).json({
      success: false,
      error:   `RouterDecision incompleto: ${missingFields.join(', ')}`
    });
  }

  if (!decision.should_process) {
    console.warn('🤖 [EXECUTE] ⚠️  Recebeu RouterDecision com should_process = false — ignorando');
    return res.status(200).json({ success: true, status: 'skipped_by_router' });
  }

  // ── 2. Log estruturado do RouterDecision recebido ─────────────────────────
  // Ponto central de observabilidade da Etapa 4.
  // Confirma que o Router está enviando decisões corretas antes da Etapa 5.

  console.log('🤖 [EXECUTE] ─── ROUTER DECISION RECEBIDA ─────────────────────');
  console.log('🤖 [EXECUTE] assignment_id:        ', decision.assignment_id);
  console.log('🤖 [EXECUTE] agent_id:             ', decision.agent_id);
  console.log('🤖 [EXECUTE] rule_id:              ', decision.rule_id);
  console.log('🤖 [EXECUTE] price_display_policy: ', decision.price_display_policy);
  console.log('🤖 [EXECUTE] capabilities:         ', JSON.stringify(decision.capabilities));
  console.log('🤖 [EXECUTE] conversation.id:      ', decision.conversation?.id);
  console.log('🤖 [EXECUTE] conversation.ai_state:', decision.conversation?.ai_state);
  console.log('🤖 [EXECUTE] event.conversation_id:', decision.event?.conversation_id);
  console.log('🤖 [EXECUTE] event.message_text:   ', decision.event?.message_text?.substring(0, 80));
  console.log('🤖 [EXECUTE] event.company_id:     ', decision.event?.company_id);
  console.log('🤖 [EXECUTE] ─── FIM DA DECISION ──────────────────────────────');

  // ── 3. [STUB Etapa 4] Processamento futuro ────────────────────────────────
  //
  // TODO Etapa 5: ConversationOrchestrator
  //   - Adquirir lock em agent_processing_locks
  //   - Verificar/criar agent_conversation_sessions
  //   - Revalidar capabilities
  //
  // [Não implementar aqui — aguardar aprovação da Etapa 5]

  console.log('🤖 [EXECUTE] ✅ Stub Etapa 4: RouterDecision recebida, Orchestrator pendente (Etapa 5)');

  // ── 4. Resposta ───────────────────────────────────────────────────────────

  return res.status(200).json({
    success: true,
    status:  'received',
    message: 'RouterDecision recebida. Orchestrator pendente (Etapa 5).',
    context: {
      assignment_id:   decision.assignment_id,
      agent_id:        decision.agent_id,
      conversation_id: decision.event?.conversation_id
    }
  });
}
