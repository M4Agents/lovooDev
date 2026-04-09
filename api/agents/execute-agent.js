// =====================================================
// POST /api/agents/execute-agent
//
// Ponto de entrada do pipeline de execução do agente.
// Recebe RouterDecision e delega ao ConversationOrchestrator.
//
// ESTADO ATUAL: Etapa 5 — ConversationOrchestrator implementado
//
// FLUXO ATUAL (Etapa 5):
//   1. Validar RouterDecision recebida
//   2. Chamar orchestrateExecution() para:
//      a. Limpar stale lock (> 5 min)
//      b. Adquirir lock atômico em agent_processing_locks
//      c. Revalidar ai_state direto do banco
//      d. Encontrar ou criar agent_conversation_sessions
//      e. Montar OrchestratorContext
//   3. Fire-and-forget → run-context-builder (Etapa 6 — stub)
//   4. Responder 200 imediatamente
//
// ETAPAS FUTURAS:
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
//
//   Etapa 9 — WhatsAppGateway:
//     - Enviar cada bloco via Uazapi (backend, service_role)
//     - Persistir cada bloco como chat_message (is_ai_generated = true)
//     - Liberar lock após envio completo
//     - Nota: Na Etapa 9, o lock será transferido para ser liberado APENAS
//       após o envio completo ao WhatsApp. Hoje é liberado após o dispatch.
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

import { orchestrateExecution } from '../lib/agents/conversationOrchestrator.js';

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

  // ── 2. ConversationOrchestrator (Etapa 5) ─────────────────────────────────

  let orchestratorResult;

  try {
    orchestratorResult = await orchestrateExecution(decision);
  } catch (orchError) {
    // orchestrateExecution tem try/catch interno — re-throw indica falha grave
    console.error('🤖 [EXECUTE] ❌ Exceção propagada do Orchestrator:', orchError.message);
    return res.status(200).json({
      success:     false,
      status:      'orchestrator_exception',
      error:       orchError.message,
      context:     { conversation_id: decision.event?.conversation_id }
    });
  }

  // ── 3. Verificar resultado do Orchestrator ───────────────────────────────

  if (!orchestratorResult.success) {
    const reason = orchestratorResult.skip_reason ?? 'unknown';

    // skipped_lock_busy e ai_state_changed são comportamentos normais esperados
    const isExpectedSkip = ['skipped_lock_busy', 'ai_state_changed'].includes(reason);

    if (isExpectedSkip) {
      console.log(`🤖 [EXECUTE] ⏭️  Orchestrator skip (${reason}):`, {
        conversation_id: decision.event?.conversation_id
      });
    } else {
      console.error(`🤖 [EXECUTE] ❌ Orchestrator falhou (${reason}):`, {
        error:           orchestratorResult.error,
        conversation_id: decision.event?.conversation_id
      });
    }

    return res.status(200).json({
      success:     false,
      status:      reason,
      context:     { conversation_id: decision.event?.conversation_id }
    });
  }

  const { context } = orchestratorResult;

  // ── 4. Dispatch fire-and-forget → run-context-builder (Etapa 6 — stub) ───
  // O ContextBuilder recebe o OrchestratorContext e montará o prompt para o LLM.
  // Fire-and-forget: responde 200 imediatamente sem bloquear no processamento.
  //
  // IMPORTANTE: O lock é liberado pelo Orchestrator via `finally` ANTES de
  // chegarmos aqui. Na Etapa 9 (WhatsAppGateway), o lock será realocado para
  // cobrir todo o ciclo de envio.

  const appBase       = process.env.APP_URL || 'https://app.lovoocrm.com';
  const contextBuilderUrl = `${appBase}/api/agents/run-context-builder`;

  fetch(contextBuilderUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(context)
  }).catch(dispatchError => {
    console.error('🤖 [EXECUTE] ❌ Falha ao disparar run-context-builder:', dispatchError.message);
  });

  console.log('🤖 [EXECUTE] ✅ OrchestratorContext → run-context-builder (fire-and-forget):', {
    run_id:          context.run_id,
    session_id:      context.session_id,
    is_new_session:  context.is_new_session,
    assignment_id:   context.assignment_id,
    agent_id:        context.agent_id,
    conversation_id: context.event?.conversation_id
  });

  // ── 5. Resposta ───────────────────────────────────────────────────────────

  return res.status(200).json({
    success: true,
    status:  'orchestrated',
    context: {
      run_id:          context.run_id,
      session_id:      context.session_id,
      assignment_id:   context.assignment_id,
      agent_id:        context.agent_id,
      conversation_id: context.event?.conversation_id
    }
  });
}
