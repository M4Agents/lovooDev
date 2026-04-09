// =====================================================
// POST /api/agents/run-context-builder
//
// ContextBuilder — recebe OrchestratorContext, monta
// ContextBuilderOutput e encaminha ao AgentExecutor.
//
// ESTADO ATUAL: Etapa 6 — ContextBuilder implementado
//
// FLUXO ATUAL (Etapa 6):
//   1. Validar OrchestratorContext recebido
//   2. Chamar contextBuilder.buildContext() para:
//      a. Buscar configuração do agente (lovoo_agents)
//      b. Buscar mensagens recentes (RPC chat_get_messages)
//      c. Buscar contato/lead (chat_conversations → leads)
//      d. Buscar catálogo (products + services, available_for_ai=true)
//      e. Aplicar filtros de capabilities (ex: can_inform_prices)
//      f. Montar ContextBuilderOutput estruturado
//   3. Fire-and-forget → run-agent (Etapa 7 — stub)
//   4. Responder 200 imediatamente
//
// ETAPAS FUTURAS:
//   Etapa 7 — AgentExecutor:
//     - Formatar extra_context a partir do ContextBuilderOutput
//     - Chamar runner.ts (runAgent) com o contexto montado
//     - Registrar execução em ai_agent_execution_logs
//
//   Etapa 8 — ResponseComposer:
//     - Quebrar resposta do LLM em blocos tipados
//
//   Etapa 9 — WhatsAppGateway:
//     - Enviar cada bloco via Uazapi (backend, service_role)
//     - Persistir cada bloco como chat_message (is_ai_generated = true)
//
// ACESSO:
//   Chamado internamente por execute-agent (fire-and-forget).
//   Sem JWT de usuário.
//
// CORPO ESPERADO (OrchestratorContext):
//   {
//     run_id, session_id, is_new_session,
//     assignment_id, agent_id, rule_id,
//     capabilities: { can_auto_reply, can_send_media, can_inform_prices, ... },
//     price_display_policy: 'disabled' | 'fixed_only' | 'range_allowed' | 'consult_only',
//     conversation: { id, contact_phone, ai_state },
//     event: { event_type, channel, company_id, instance_id,
//              conversation_id, uazapi_message_id, source_type,
//              source_identifier, message_text, saved_message_id, timestamp }
//   }
// =====================================================

import { buildContext } from '../lib/agents/contextBuilder.js';

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

  // ── 2. ContextBuilder (Etapa 6) ───────────────────────────────────────────

  let buildResult;

  try {
    buildResult = await buildContext(context);
  } catch (buildError) {
    // buildContext tem tratamento interno — re-throw indica falha grave
    console.error('🤖 [CTX] ❌ Exceção propagada do ContextBuilder:', buildError.message);
    return res.status(200).json({
      success: false,
      status:  'context_builder_exception',
      error:   buildError.message,
      meta:    { run_id: context.run_id, conversation_id: context.event?.conversation_id }
    });
  }

  // ── 3. Verificar resultado do ContextBuilder ─────────────────────────────

  if (!buildResult.success) {
    const reason = buildResult.skip_reason ?? 'unknown';

    // agent_not_found é skip esperado (agente inativado entre Etapa 5 e 6)
    const isExpectedSkip = ['agent_not_found'].includes(reason);

    if (isExpectedSkip) {
      console.log(`🤖 [CTX] ⏭️  ContextBuilder skip (${reason}):`, {
        run_id:          context.run_id,
        conversation_id: context.event?.conversation_id
      });
    } else {
      console.error(`🤖 [CTX] ❌ ContextBuilder falhou (${reason}):`, {
        error:           buildResult.error,
        run_id:          context.run_id,
        conversation_id: context.event?.conversation_id
      });
    }

    return res.status(200).json({
      success: false,
      status:  reason,
      meta:    { run_id: context.run_id, conversation_id: context.event?.conversation_id }
    });
  }

  const { output } = buildResult;

  // ── 4. Dispatch fire-and-forget → run-agent (Etapa 7 — stub) ─────────────
  // O AgentExecutor receberá o ContextBuilderOutput e montará o prompt para o LLM.
  // Fire-and-forget: responde 200 sem bloquear no processamento.

  const appBase    = process.env.APP_URL || 'https://app.lovoocrm.com';
  const runAgentUrl = `${appBase}/api/agents/run-agent`;

  fetch(runAgentUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(output)
  }).catch(dispatchError => {
    console.error('🤖 [CTX] ❌ Falha ao disparar run-agent:', dispatchError.message);
  });

  console.log('🤖 [CTX] ✅ ContextBuilderOutput → run-agent (fire-and-forget):', {
    run_id:           output.run_id,
    session_id:       output.session_id,
    agent_id:         output.agent.id,
    knowledge_mode:   output.agent.knowledge_mode,
    messages_count:   output.conversation.recent_messages.length,
    has_lead:         !!output.contact.lead_id,
    products_count:   output.catalog.products.length,
    services_count:   output.catalog.services.length,
    conversation_id:  output.conversation.id
  });

  // ── 5. Resposta ───────────────────────────────────────────────────────────

  return res.status(200).json({
    success: true,
    status:  'context_built',
    meta: {
      run_id:           output.run_id,
      session_id:       output.session_id,
      agent_id:         output.agent.id,
      messages_count:   output.conversation.recent_messages.length,
      products_count:   output.catalog.products.length,
      services_count:   output.catalog.services.length,
      conversation_id:  output.conversation.id
    }
  });
}
