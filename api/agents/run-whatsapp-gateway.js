// =====================================================
// POST /api/agents/run-whatsapp-gateway
//
// WhatsAppGateway — Etapa 9 MVP Agentes de Conversação
//
// ESTADO ATUAL: Implementado (Etapa 9)
//
// FLUXO:
//   1. Validar ResponseComposerOutput recebido
//   2. Chamar whatsappGateway.sendBlocks() para:
//      a. Buscar contexto da conversa (instance_id, contact_phone)
//      b. Buscar provider context (provider_instance_id, api_key)
//      c. Para cada bloco (ordem por index):
//         - Revalidar ai_state no banco
//           → se != 'ai_active': abortar blocos restantes
//         - Persistir via chat_create_message (is_ai_generated=true)
//           → falha crítica: abortar
//         - Enviar via Uazapi (POST /send/text, token = companies.api_key)
//           → 4xx: abortar (erro de configuração)
//           → 5xx / rede: continuar (erro temporário)
//         - Atualizar status da mensagem (sent / failed)
//      d. Incrementar agent_conversation_sessions.messages_sent
//   3. Responder 200 com resumo do envio
//
// ACESSO:
//   Chamado internamente por run-response-composer (fire-and-forget).
//   Sem JWT de usuário.
//   Usa service_role para todas as operações no banco.
//
// CORPO ESPERADO (ResponseComposerOutput):
//   {
//     run_id:     UUID,
//     session_id: UUID,
//     blocks: [
//       { index: 0, type: 'text', content: '...' },
//       ...
//     ],
//     metadata: { company_id, conversation_id, assignment_id }
//   }
// =====================================================

import { sendBlocks } from '../lib/agents/whatsappGateway.js';

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

  // ── 1. Validação do ResponseComposerOutput ────────────────────────────────

  const composerOutput = req.body;

  if (!composerOutput || typeof composerOutput !== 'object') {
    console.error('🤖 [GATEWAY] ❌ ResponseComposerOutput inválido ou ausente');
    return res.status(400).json({ success: false, error: 'ResponseComposerOutput inválido.' });
  }

  const requiredFields = ['run_id', 'session_id', 'blocks', 'metadata'];
  const missingFields  = requiredFields.filter(f => !composerOutput[f]);

  if (missingFields.length > 0) {
    console.error('🤖 [GATEWAY] ❌ ResponseComposerOutput incompleto — campos ausentes:', missingFields);
    return res.status(400).json({
      success: false,
      error:   `ResponseComposerOutput incompleto: ${missingFields.join(', ')}`
    });
  }

  if (!Array.isArray(composerOutput.blocks) || composerOutput.blocks.length === 0) {
    console.error('🤖 [GATEWAY] ❌ blocks vazio ou inválido');
    return res.status(400).json({ success: false, error: 'blocks deve ser um array não vazio.' });
  }

  const requiredMeta = ['company_id', 'conversation_id'];
  const missingMeta  = requiredMeta.filter(f => !composerOutput.metadata?.[f]);

  if (missingMeta.length > 0) {
    console.error('🤖 [GATEWAY] ❌ metadata incompleto:', missingMeta);
    return res.status(400).json({
      success: false,
      error:   `metadata incompleto: ${missingMeta.join(', ')}`
    });
  }

  // ── 2. Log de entrada ─────────────────────────────────────────────────────

  console.log('🤖 [GATEWAY] 🚀 WhatsAppGateway iniciando:', {
    run_id:          composerOutput.run_id,
    session_id:      composerOutput.session_id,
    blocks_count:    composerOutput.blocks.length,
    conversation_id: composerOutput.metadata.conversation_id,
    company_id:      composerOutput.metadata.company_id
  });

  // ── 3. Executar WhatsAppGateway ───────────────────────────────────────────

  let gatewayResult;

  try {
    gatewayResult = await sendBlocks(composerOutput);
  } catch (gatewayError) {
    console.error('🤖 [GATEWAY] ❌ Exceção inesperada no WhatsAppGateway:', gatewayError.message);
    return res.status(200).json({
      success: false,
      status:  'gateway_exception',
      error:   gatewayError.message,
      meta: {
        run_id:          composerOutput.run_id,
        conversation_id: composerOutput.metadata.conversation_id
      }
    });
  }

  // ── 4. Resposta ───────────────────────────────────────────────────────────

  if (!gatewayResult.success) {
    console.error('🤖 [GATEWAY] ❌ sendBlocks retornou failure:', {
      error: gatewayResult.error,
      stage: gatewayResult.stage,
      run_id:          composerOutput.run_id,
      conversation_id: composerOutput.metadata.conversation_id
    });

    return res.status(200).json({
      success: false,
      status:  `gateway_failed:${gatewayResult.stage ?? gatewayResult.error ?? 'unknown'}`,
      meta: {
        run_id:          composerOutput.run_id,
        conversation_id: composerOutput.metadata.conversation_id,
        error:           gatewayResult.error
      }
    });
  }

  console.log('🤖 [GATEWAY] ✅ Envio concluído:', {
    run_id:          composerOutput.run_id,
    conversation_id: composerOutput.metadata.conversation_id,
    total_blocks:    composerOutput.blocks.length,
    sent:            gatewayResult.successCount,
    abort_reason:    gatewayResult.abortReason ?? 'none'
  });

  return res.status(200).json({
    success: true,
    status:  gatewayResult.abortReason ? `partial:${gatewayResult.abortReason}` : 'sent',
    meta: {
      run_id:          composerOutput.run_id,
      session_id:      composerOutput.session_id,
      conversation_id: composerOutput.metadata.conversation_id,
      blocks_total:    composerOutput.blocks.length,
      blocks_sent:     gatewayResult.successCount,
      abort_reason:    gatewayResult.abortReason ?? null
    }
  });
}
