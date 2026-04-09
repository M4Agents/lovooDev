// =====================================================
// POST /api/agents/run-response-composer
//
// ResponseComposer — recebe AgentExecutorOutput e transforma
// raw_response em blocos de texto para envio no WhatsApp.
//
// ESTADO ATUAL: Etapa 8 — ResponseComposer implementado
//
// FLUXO ATUAL (Etapa 8):
//   1. Validar AgentExecutorOutput recebido
//   2. Chamar responseComposer.compose() para:
//      a. Validar raw_response (não vazio)
//      b. Sanitizar texto (normalizar quebras de linha)
//      c. Dividir por parágrafos (\n\n)
//      d. Dividir blocos longos por sentenças / listas / vírgulas
//      e. Filtrar e truncar blocos (MIN, HARD_LIMIT, MAX_BLOCKS)
//      f. Montar ResponseComposerOutput com blocks[{index, type, content}]
//   3. Fire-and-forget → run-whatsapp-gateway (Etapa 9 — stub)
//   4. Responder 200 imediatamente
//
// ETAPA FUTURA:
//   Etapa 9 — WhatsAppGateway:
//     - Para cada bloco em blocks[]:
//       - Enviar via Uazapi (backend, service_role)
//       - Persistir como chat_message (is_ai_generated=true, ai_block_index=index)
//       - Aplicar delay entre mensagens para simular comportamento humano
//     - Atualizar agent_conversation_sessions.messages_sent
//
// ACESSO:
//   Chamado internamente por run-agent (fire-and-forget).
//   Sem JWT de usuário.
//
// CORPO ESPERADO (AgentExecutorOutput):
//   {
//     run_id:       UUID,
//     session_id:   UUID,
//     raw_response: string,
//     agent_id:     UUID,
//     ok:           boolean,
//     fallback:     boolean,
//     metadata: { company_id, assignment_id, conversation_id }
//   }
// =====================================================

import { compose } from '../lib/agents/responseComposer.js';

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

  // ── 1. Validação do AgentExecutorOutput ──────────────────────────────────

  const output = req.body;

  if (!output || typeof output !== 'object') {
    console.error('🤖 [COMPOSE] ❌ AgentExecutorOutput inválido ou ausente');
    return res.status(400).json({ success: false, error: 'AgentExecutorOutput inválido.' });
  }

  const requiredFields = ['run_id', 'session_id', 'raw_response', 'agent_id', 'metadata'];
  const missingFields  = requiredFields.filter(f => !output[f] && output[f] !== '');

  if (missingFields.length > 0) {
    console.error('🤖 [COMPOSE] ❌ AgentExecutorOutput incompleto — campos ausentes:', missingFields);
    return res.status(400).json({
      success: false,
      error:   `AgentExecutorOutput incompleto: ${missingFields.join(', ')}`
    });
  }

  // ── 2. ResponseComposer (Etapa 8) ─────────────────────────────────────────

  let composeResult;

  try {
    composeResult = compose(output);
  } catch (composeError) {
    // compose() é função pura — exceção indica bug interno
    console.error('🤖 [COMPOSE] ❌ Exceção no ResponseComposer:', composeError.message);
    return res.status(200).json({
      success: false,
      status:  'composer_exception',
      error:   composeError.message,
      meta:    { run_id: output.run_id, conversation_id: output.metadata?.conversation_id }
    });
  }

  // ── 3. Verificar resultado ────────────────────────────────────────────────

  if (!composeResult.success) {
    const reason = composeResult.skip_reason ?? 'unknown';

    console.log(`🤖 [COMPOSE] ⏭️  ResponseComposer skip (${reason}):`, {
      run_id:          output.run_id,
      conversation_id: output.metadata?.conversation_id
    });

    return res.status(200).json({
      success: false,
      status:  reason,
      meta:    { run_id: output.run_id, conversation_id: output.metadata?.conversation_id }
    });
  }

  const { output: composerOutput } = composeResult;

  // ── 4. Dispatch fire-and-forget → run-whatsapp-gateway (Etapa 9 — stub) ──
  // O WhatsAppGateway enviará cada bloco via Uazapi e persistirá no banco.
  // Fire-and-forget: responde 200 sem bloquear no envio.

  const appBase           = process.env.APP_URL || 'https://app.lovoocrm.com';
  const whatsappGatewayUrl = `${appBase}/api/agents/run-whatsapp-gateway`;

  fetch(whatsappGatewayUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(composerOutput)
  }).catch(dispatchError => {
    console.error('🤖 [COMPOSE] ❌ Falha ao disparar run-whatsapp-gateway:', dispatchError.message);
  });

  console.log('🤖 [COMPOSE] ✅ ResponseComposerOutput → run-whatsapp-gateway (fire-and-forget):', {
    run_id:          composerOutput.run_id,
    session_id:      composerOutput.session_id,
    blocks_count:    composerOutput.blocks.length,
    block_lengths:   composerOutput.blocks.map(b => b.content.length),
    conversation_id: composerOutput.metadata?.conversation_id
  });

  // ── 5. Resposta ───────────────────────────────────────────────────────────

  return res.status(200).json({
    success: true,
    status:  'composed',
    meta: {
      run_id:          composerOutput.run_id,
      session_id:      composerOutput.session_id,
      blocks_count:    composerOutput.blocks.length,
      conversation_id: composerOutput.metadata?.conversation_id
    }
  });
}
