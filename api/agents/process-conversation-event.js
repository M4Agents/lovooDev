// =====================================================
// POST /api/agents/process-conversation-event
//
// Receptor do ConversationEventEmitter + executor do ConversationRouter.
//
// RESPONSABILIDADE:
//   1. Valida o payload do evento
//   2. Executa o ConversationRouter (deduplicação, ai_state, regras, capabilities)
//   3. Se RouterDecision.should_process = true → dispara execute-agent (fire-and-forget)
//   4. Retorna 200 imediatamente (webhook não aguarda esta resposta)
//
// ESTADO ATUAL: Etapa 4 (ConversationRouter implementado)
//   Etapa 5: execute-agent.js → Orchestrator (lock, sessão, handoff)
//   Etapas 6-9: ContextBuilder, AgentExecutor, ResponseComposer, WhatsAppGateway
//
// ACESSO:
//   Chamado internamente pelo webhook (fire-and-forget, sem JWT).
//   Sem autenticação por enquanto — endereçar com secret header pós-MVP.
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

import { routeConversationEvent } from '../lib/agents/conversationRouter.js';

// Campos obrigatórios para o Router identificar e deduplícar o evento
const REQUIRED_FIELDS = [
  'event_type',
  'company_id',
  'conversation_id',
  'uazapi_message_id',
  'channel'
];

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

  // ── 1. Validação do payload ───────────────────────────────────────────────

  const body = req.body;

  if (!body || typeof body !== 'object') {
    console.error('🤖 [EVENT] ❌ Corpo inválido ou ausente');
    return res.status(400).json({ success: false, error: 'Corpo da requisição inválido.' });
  }

  const missingFields = REQUIRED_FIELDS.filter(field => !body[field]);
  if (missingFields.length > 0) {
    console.error('🤖 [EVENT] ❌ Campos obrigatórios ausentes:', missingFields);
    return res.status(400).json({
      success: false,
      error: `Campos obrigatórios ausentes: ${missingFields.join(', ')}`
    });
  }

  // Desestruturação explícita — descarta campos inesperados do body
  const event = {
    event_type:        body.event_type,
    channel:           body.channel,
    company_id:        body.company_id,
    instance_id:       body.instance_id        ?? null,
    conversation_id:   body.conversation_id,
    uazapi_message_id: body.uazapi_message_id,
    source_type:       body.source_type        ?? null,
    source_identifier: body.source_identifier  ?? null,
    message_text:      body.message_text       ?? null,
    saved_message_id:  body.saved_message_id   ?? null,
    timestamp:         body.timestamp          ?? new Date().toISOString()
  };

  console.log('🤖 [EVENT] Evento recebido:', {
    event_type:        event.event_type,
    conversation_id:   event.conversation_id,
    uazapi_message_id: event.uazapi_message_id,
    company_id:        event.company_id,
    channel:           event.channel
  });

  // ── 2. ConversationRouter ─────────────────────────────────────────────────
  // O Router executa deduplicação, verifica ai_state, resolve regras e capabilities.
  // Retorna RouterDecision com should_process e todos os dados resolvidos.

  let decision;
  try {
    decision = await routeConversationEvent(event);
  } catch (routerError) {
    console.error('🤖 [EVENT] ❌ Exceção não capturada no Router:', routerError.message);
    return res.status(200).json({
      success: true,
      status:  'router_error',
      error:   routerError.message
    });
  }

  // ── 3. Dispatch para execute-agent (fire-and-forget) ──────────────────────
  // Somente quando o Router decidiu processar (should_process = true).
  // Sem await — este endpoint retorna 200 antes do agente executar.

  if (decision.should_process) {
    const appBase      = process.env.APP_URL || 'https://app.lovoocrm.com';
    const executeUrl   = `${appBase}/api/agents/execute-agent`;

    fetch(executeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(decision)
    }).catch(dispatchError => {
      console.error('🤖 [EVENT] ❌ Falha ao disparar execute-agent:', dispatchError.message);
    });

    console.log('🤖 [EVENT] ✅ RouterDecision = processar → execute-agent disparado (fire-and-forget):', {
      assignment_id:   decision.assignment_id,
      agent_id:        decision.agent_id,
      conversation_id: event.conversation_id,
      rule_id:         decision.rule_id
    });

  } else {
    console.log('🤖 [EVENT] ⏭️  RouterDecision = skip:', {
      skip_reason:     decision.skip_reason,
      conversation_id: event.conversation_id,
      uazapi_message_id: event.uazapi_message_id
    });
  }

  // ── 4. Resposta ───────────────────────────────────────────────────────────
  // Retorna sempre 200 — o webhook já não aguarda esta resposta.
  // O status reflete a decisão do Router para observabilidade.

  return res.status(200).json({
    success:     true,
    status:      decision.should_process ? 'dispatched' : `skipped:${decision.skip_reason}`,
    should_process: decision.should_process,
    skip_reason: decision.skip_reason,
    assignment_id:  decision.assignment_id,
    rule_id:        decision.rule_id
  });
}
