// =====================================================
// POST /api/agents/process-conversation-event
//
// Endpoint receptor do ConversationEventEmitter.
// Recebe eventos de conversação disparados pelo webhook Uazapi
// e os encaminha para o ConversationRouter (Etapas 4+).
//
// ESTADO ATUAL: Stub da Etapa 3 (MVP Agentes)
//   - Valida campos obrigatórios
//   - Loga o evento para observabilidade
//   - Retorna { success: true }
//
// PRÓXIMAS ETAPAS (NÃO IMPLEMENTAR AQUI):
//   Etapa 4: ConversationRouter (busca routing rule + assignment)
//   Etapa 5: ConversationOrchestrator (lock, deduplicação, sessão)
//   Etapa 6: ContextBuilder (RAG, catálogo, histórico)
//   Etapa 7: AgentExecutor (runner.ts / OpenAI)
//   Etapa 8: ResponseComposer (multi-blocos)
//   Etapa 9: WhatsAppGateway (envio via Uazapi)
//
// ACESSO: Chamado internamente pelo webhook — sem JWT de usuário.
// Não expor publicamente sem proteção por secret header (pós-MVP).
//
// CORPO ESPERADO:
//   {
//     event_type:        'conversation.message_received',
//     channel:           'whatsapp',
//     company_id:        UUID,
//     instance_id:       UUID,
//     conversation_id:   UUID,
//     uazapi_message_id: string,
//     source_type:       'whatsapp_message',
//     source_identifier: string,
//     message_text:      string,
//     saved_message_id:  UUID,
//     timestamp:         ISO string
//   }
// =====================================================

// Campos obrigatórios mínimos para o Router identificar o evento
const REQUIRED_FIELDS = [
  'event_type',
  'company_id',
  'conversation_id',
  'uazapi_message_id',
  'channel'
];

export default async function handler(req, res) {
  // CORS: este endpoint só aceita POST de origem interna
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

  // ── 1. Parse e validação do corpo ──────────────────────────────────────────

  const body = req.body;

  if (!body || typeof body !== 'object') {
    console.error('🤖 [AGENT-EVENT] ❌ Corpo da requisição inválido ou ausente');
    return res.status(400).json({ success: false, error: 'Corpo da requisição inválido.' });
  }

  // Verificar campos obrigatórios
  const missingFields = REQUIRED_FIELDS.filter(field => !body[field]);
  if (missingFields.length > 0) {
    console.error('🤖 [AGENT-EVENT] ❌ Campos obrigatórios ausentes:', missingFields);
    return res.status(400).json({
      success: false,
      error:   `Campos obrigatórios ausentes: ${missingFields.join(', ')}`
    });
  }

  // Extrair campos com desestruturação explícita (evita dados extras não esperados)
  const {
    event_type,
    channel,
    company_id,
    instance_id,
    conversation_id,
    uazapi_message_id,
    source_type,
    source_identifier,
    message_text,
    saved_message_id,
    timestamp
  } = body;

  // ── 2. Log estruturado do evento ───────────────────────────────────────────
  //
  // Este log é o ponto central de observabilidade da Etapa 3.
  // Permite confirmar que o emitter está funcionando antes da Etapa 4.

  console.log('🤖 [AGENT-EVENT] ─── EVENTO RECEBIDO ───────────────────────────');
  console.log('🤖 [AGENT-EVENT] event_type:        ', event_type);
  console.log('🤖 [AGENT-EVENT] channel:           ', channel);
  console.log('🤖 [AGENT-EVENT] company_id:        ', company_id);
  console.log('🤖 [AGENT-EVENT] instance_id:       ', instance_id);
  console.log('🤖 [AGENT-EVENT] conversation_id:   ', conversation_id);
  console.log('🤖 [AGENT-EVENT] uazapi_message_id: ', uazapi_message_id);
  console.log('🤖 [AGENT-EVENT] source_identifier: ', source_identifier);
  console.log('🤖 [AGENT-EVENT] message_text:      ', message_text?.substring(0, 80));
  console.log('🤖 [AGENT-EVENT] saved_message_id:  ', saved_message_id);
  console.log('🤖 [AGENT-EVENT] timestamp:         ', timestamp);
  console.log('🤖 [AGENT-EVENT] ─── FIM DO EVENTO ────────────────────────────');

  // ── 3. [Etapa 3 STUB] Processamento futuro ────────────────────────────────
  //
  // TODO Etapa 4: ConversationRouter
  //   - Verificar ai_state da conversa (deve ser 'ai_active')
  //   - Buscar agent_routing_rules ativas da empresa
  //   - Resolver assignment_id pelo match (channel, event_type, source_identifier)
  //   - Passar RouterDecision para o Orchestrator
  //
  // TODO Etapa 5: ConversationOrchestrator
  //   - Verificar agent_processed_messages (deduplicação por uazapi_message_id)
  //   - Adquirir lock em agent_processing_locks
  //   - Criar/atualizar agent_conversation_sessions
  //   - Validar AgentCapabilities (can_auto_reply, etc.)
  //
  // [Não implementar aqui — aguardar aprovação da Etapa 4]

  console.log('🤖 [AGENT-EVENT] ✅ Stub Etapa 3: evento registrado, Router pendente (Etapa 4)');

  // ── 4. Resposta ────────────────────────────────────────────────────────────
  //
  // Retornar sempre 200 para não causar retry do webhook.
  // O webhook não aguarda esta resposta (fire-and-forget).

  return res.status(200).json({
    success: true,
    status:  'queued',
    message: 'Evento recebido. Processamento pelo Router pendente (Etapa 4).',
    event: {
      event_type,
      conversation_id,
      uazapi_message_id,
      company_id
    }
  });
}
