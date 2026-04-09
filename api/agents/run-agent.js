// =====================================================
// POST /api/agents/run-agent
//
// AgentExecutor — recebe ContextBuilderOutput, executa o LLM
// e encaminha a resposta bruta ao ResponseComposer.
//
// ESTADO ATUAL: Etapa 7 — AgentExecutor implementado
//
// FLUXO ATUAL (Etapa 7):
//   1. Validar ContextBuilderOutput recebido
//   2. Chamar agentExecutor.executeAgent() para:
//      a. Validar company_id e campos essenciais
//      b. Validar que user_message não está vazio
//      c. Montar extra_context (histórico + contato + catálogo)
//      d. Chamar runner.runAgentWithConfig() — executa OpenAI
//      e. Registrar execução em ai_agent_execution_logs
//      f. Retornar AgentExecutorOutput
//   3. Fire-and-forget → run-response-composer (Etapa 8 — stub)
//   4. Responder 200 imediatamente
//
// ETAPAS FUTURAS:
//   Etapa 8 — ResponseComposer:
//     - Quebrar raw_response em blocos tipados:
//         text | media | question | cta | handoff_notice
//     - Definir ordem e delay de cada bloco
//
//   Etapa 9 — WhatsAppGateway:
//     - Enviar cada bloco via Uazapi (backend, service_role)
//     - Persistir cada bloco como chat_message (is_ai_generated = true)
//
// ACESSO:
//   Chamado internamente por run-context-builder (fire-and-forget).
//   Sem JWT de usuário.
//
// CORPO ESPERADO (ContextBuilderOutput):
//   {
//     run_id, session_id,
//     agent: { id, prompt, knowledge_mode, knowledge_base, model, model_config },
//     conversation: { id, contact_phone, recent_messages: [...] },
//     contact: { lead_id, name, phone },
//     catalog: { products: [...], services: [...] },
//     user_message: string,
//     capabilities: { ... },
//     price_display_policy: string,
//     metadata: { company_id, assignment_id, rule_id }
//   }
// =====================================================

import { executeAgent } from '../lib/agents/agentExecutor.js';

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

  // ── 1. Validação do ContextBuilderOutput ─────────────────────────────────

  const output = req.body;

  if (!output || typeof output !== 'object') {
    console.error('🤖 [AGENT] ❌ ContextBuilderOutput inválido ou ausente');
    return res.status(400).json({ success: false, error: 'ContextBuilderOutput inválido.' });
  }

  const requiredFields = ['run_id', 'session_id', 'agent', 'conversation', 'contact', 'catalog', 'user_message', 'metadata'];
  const missingFields  = requiredFields.filter(f => !output[f] && output[f] !== '');

  if (missingFields.length > 0) {
    console.error('🤖 [AGENT] ❌ ContextBuilderOutput incompleto — campos ausentes:', missingFields);
    return res.status(400).json({
      success: false,
      error:   `ContextBuilderOutput incompleto: ${missingFields.join(', ')}`
    });
  }

  // ── 2. AgentExecutor (Etapa 7) ────────────────────────────────────────────

  let execResult;

  try {
    execResult = await executeAgent(output);
  } catch (execError) {
    // executeAgent tem tratamento interno — re-throw indica falha grave
    console.error('🤖 [AGENT] ❌ Exceção propagada do AgentExecutor:', execError.message);
    return res.status(200).json({
      success: false,
      status:  'executor_exception',
      error:   execError.message,
      meta:    { run_id: output.run_id, conversation_id: output.conversation?.id }
    });
  }

  // ── 3. Verificar resultado do AgentExecutor ───────────────────────────────

  if (!execResult.success) {
    const reason = execResult.skip_reason ?? 'unknown';

    // empty_user_message é skip esperado (sem conteúdo para responder)
    const isExpectedSkip = ['empty_user_message'].includes(reason);

    if (isExpectedSkip) {
      console.log(`🤖 [AGENT] ⏭️  AgentExecutor skip (${reason}):`, {
        run_id:          output.run_id,
        conversation_id: output.conversation?.id
      });
    } else {
      console.error(`🤖 [AGENT] ❌ AgentExecutor falhou (${reason}):`, {
        error:           execResult.error,
        run_id:          output.run_id,
        conversation_id: output.conversation?.id
      });
    }

    return res.status(200).json({
      success: false,
      status:  reason,
      meta:    { run_id: output.run_id, conversation_id: output.conversation?.id }
    });
  }

  const { output: executorOutput } = execResult;

  // ── 4. Dispatch fire-and-forget → run-response-composer (Etapa 8 — stub) ─
  // O ResponseComposer quebrará raw_response em blocos (text, media, cta...).
  // Fire-and-forget: responde 200 sem bloquear no processamento.

  const appBase             = process.env.APP_URL || 'https://app.lovoocrm.com';
  const responseComposerUrl = `${appBase}/api/agents/run-response-composer`;

  fetch(responseComposerUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(executorOutput)
  }).catch(dispatchError => {
    console.error('🤖 [AGENT] ❌ Falha ao disparar run-response-composer:', dispatchError.message);
  });

  console.log('🤖 [AGENT] ✅ AgentExecutorOutput → run-response-composer (fire-and-forget):', {
    run_id:           executorOutput.run_id,
    session_id:       executorOutput.session_id,
    agent_id:         executorOutput.agent_id,
    response_length:  executorOutput.raw_response?.length ?? 0,
    conversation_id:  executorOutput.metadata?.conversation_id
  });

  // ── 5. Resposta ───────────────────────────────────────────────────────────

  return res.status(200).json({
    success: true,
    status:  'executed',
    meta: {
      run_id:           executorOutput.run_id,
      session_id:       executorOutput.session_id,
      agent_id:         executorOutput.agent_id,
      response_length:  executorOutput.raw_response?.length ?? 0,
      conversation_id:  executorOutput.metadata?.conversation_id
    }
  });
}
