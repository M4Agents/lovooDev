// =====================================================
// POST /api/agents/run-response-composer
//
// ResponseComposer — recebe AgentExecutorOutput e quebra
// a resposta bruta do LLM em blocos para envio sequencial.
//
// ESTADO ATUAL: Stub da Etapa 7 (aguardando Etapa 8)
//   Valida e loga o AgentExecutorOutput recebido.
//   Retorna { success: true } sem processar a resposta.
//
// PRÓXIMAS ETAPAS A IMPLEMENTAR AQUI:
//
//   Etapa 8 — ResponseComposer:
//     - Quebrar raw_response em blocos tipados:
//         text       → mensagem de texto simples
//         media      → envio de mídia (imagem, vídeo)
//         question   → pergunta ao contato
//         cta        → call-to-action
//         handoff_notice → aviso de transferência para humano
//     - Definir ordem e delay entre blocos
//     - Validar capabilities antes de incluir bloco de mídia:
//         can_send_media = false → remover blocos 'media'
//     - Encaminhar lista de blocos para WhatsAppGateway (Etapa 9)
//
//   Etapa 9 — WhatsAppGateway:
//     - Para cada bloco:
//       - Enviar via Uazapi (backend, service_role)
//       - Persistir como chat_message (is_ai_generated = true, ai_block_index = N)
//       - Aplicar delay entre mensagens para simular comportamento humano
//     - Liberar lock após envio completo
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
//     raw_response: string,     // resposta bruta do LLM
//     agent_id:     UUID,
//     ok:           boolean,
//     fallback:     boolean,
//     metadata: {
//       company_id:      UUID,
//       assignment_id:   UUID,
//       conversation_id: UUID
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

  // ── 2. Log estruturado — observabilidade da Etapa 7 ─────────────────────
  // Confirma que o AgentExecutor está entregando respostas válidas do LLM.

  console.log('🤖 [COMPOSE] ─── AGENT EXECUTOR OUTPUT RECEBIDO ─────────────');
  console.log('🤖 [COMPOSE] run_id:            ', output.run_id);
  console.log('🤖 [COMPOSE] session_id:        ', output.session_id);
  console.log('🤖 [COMPOSE] agent_id:          ', output.agent_id);
  console.log('🤖 [COMPOSE] ok:                ', output.ok);
  console.log('🤖 [COMPOSE] fallback:          ', output.fallback);
  console.log('🤖 [COMPOSE] response_length:   ', output.raw_response?.length ?? 0);
  console.log('🤖 [COMPOSE] raw_response:      ', output.raw_response?.substring(0, 150));
  console.log('🤖 [COMPOSE] company_id:        ', output.metadata?.company_id);
  console.log('🤖 [COMPOSE] assignment_id:     ', output.metadata?.assignment_id);
  console.log('🤖 [COMPOSE] conversation_id:   ', output.metadata?.conversation_id);
  console.log('🤖 [COMPOSE] ─── FIM DO OUTPUT ──────────────────────────────');

  // ── 3. [STUB Etapa 7] Processamento futuro ────────────────────────────────
  //
  // TODO Etapa 8: ResponseComposer
  //   - Quebrar raw_response em blocos tipados (text, media, question, cta)
  //   - Validar capabilities (can_send_media)
  //   - Encaminhar blocos ao WhatsAppGateway

  console.log('🤖 [COMPOSE] ✅ Stub Etapa 7: AgentExecutorOutput recebido, ResponseComposer pendente (Etapa 8)');

  // ── 4. Resposta ───────────────────────────────────────────────────────────

  return res.status(200).json({
    success: true,
    status:  'received',
    message: 'AgentExecutorOutput recebido. ResponseComposer pendente (Etapa 8).',
    meta: {
      run_id:           output.run_id,
      agent_id:         output.agent_id,
      response_length:  output.raw_response?.length ?? 0,
      conversation_id:  output.metadata?.conversation_id
    }
  });
}
