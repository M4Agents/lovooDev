// =============================================================================
// api/lib/agents/instagramGateway.ts
//
// InstagramGateway — envia a resposta do agente ao participante Instagram.
//
// RESPONSABILIDADE ÚNICA:
//   Revalidar o estado da conversa e enviar a resposta via instagramMessageService.
//   Nunca duplica lógica de envio — delega 100% ao serviço compartilhado.
//
// REVALIDAÇÕES PRÉ-ENVIO (críticas — impedem envio se qualquer falha):
//   1. company_id bate com a conversa (ownership multi-tenant)
//   2. ai_state ainda é 'ai_active' (pode ter mudado durante a execução do LLM)
//   3. ai_assignment_id ainda é o mesmo assignment usado pelo executor
//   4. Conexão Instagram está com status = 'active'
//   5. Conversa pertence à conexão (conversation.connection_id == connection.id)
//
// Se qualquer validação falhar: retorna skip_reason, NÃO envia.
// Isso impede o agente de responder após:
//   - Humano assumiu a conversa (ai_state → ai_paused)
//   - Assignment foi trocado
//   - Conexão foi desativada
//
// ENVIO:
//   Delegado a sendInstagramMessage com origin='agent'.
//   Persiste a mensagem outbound antes do envio (inside instagramMessageService).
//
// RETORNO:
//   { success: true,  ig_message_id, message_id }
//   { success: false, skip_reason: string, error?: string }
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import { sendInstagramMessage } from '../instagram/instagramMessageService.js'

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export type GatewayInput = {
  svc:                       ReturnType<typeof createClient>
  company_id:                string
  instagram_conversation_id: string
  assignment_id:             string
  response_text:             string
  run_id:                    string
}

export type GatewayOutput =
  | { success: true;  ig_message_id: string | null; message_id: string | null; skip_reason?: undefined }
  | { success: false; skip_reason: string;           error?: string }

// ── Função principal ───────────────────────────────────────────────────────────

/**
 * Revalida o estado da conversa e envia a resposta ao participante Instagram.
 *
 * @param input - Contexto de envio com svc, IDs e texto da resposta.
 * @returns GatewayOutput — success=true com IDs da mensagem, ou false com skip_reason.
 */
export async function sendInstagramGateway(input: GatewayInput): Promise<GatewayOutput> {
  const {
    svc,
    company_id,
    instagram_conversation_id,
    assignment_id,
    response_text,
    run_id,
  } = input

  // ── 1. Validar resposta não-vazia ──────────────────────────────────────────
  const trimmedResponse = response_text?.trim()
  if (!trimmedResponse) {
    console.warn('[IG:GATEWAY] ⏭️  Resposta vazia — skip:', { run_id, instagram_conversation_id })
    return { success: false, skip_reason: 'empty_response' }
  }

  // ── 2. Revalidar conversa: company_id + ai_state + ai_assignment_id ────────
  const { data: conv, error: convErr } = await svc
    .from('instagram_conversations')
    .select('id, company_id, ai_state, ai_assignment_id, connection_id')
    .eq('id', instagram_conversation_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (convErr) {
    console.error('[IG:GATEWAY] ❌ Erro ao revalidar conversa:', {
      error: convErr.message, instagram_conversation_id, company_id,
    })
    return { success: false, skip_reason: 'db_error', error: convErr.message }
  }

  if (!conv) {
    console.warn('[IG:GATEWAY] ⏭️  Conversa não encontrada ou de outra empresa:', {
      instagram_conversation_id, company_id,
    })
    return { success: false, skip_reason: 'conversation_not_found' }
  }

  // ai_state pode ter mudado enquanto o LLM executava
  if (conv.ai_state !== 'ai_active') {
    console.log('[IG:GATEWAY] ⏭️  ai_state mudou durante execução — skip:', {
      ai_state: conv.ai_state, instagram_conversation_id, run_id,
    })
    return { success: false, skip_reason: 'ai_state_changed' }
  }

  // ai_assignment_id pode ter sido trocado durante a execução
  if (conv.ai_assignment_id !== assignment_id) {
    console.warn('[IG:GATEWAY] ⏭️  assignment_id trocado durante execução — skip:', {
      expected: assignment_id, actual: conv.ai_assignment_id, run_id,
    })
    return { success: false, skip_reason: 'assignment_changed' }
  }

  // ── 3. Revalidar conexão: ativa + pertence à empresa ──────────────────────
  const { data: connection, error: connErr } = await svc
    .from('instagram_connections')
    .select('id, company_id, status')
    .eq('id', conv.connection_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (connErr) {
    console.error('[IG:GATEWAY] ❌ Erro ao revalidar conexão:', {
      error: connErr.message, connection_id: conv.connection_id,
    })
    return { success: false, skip_reason: 'db_error', error: connErr.message }
  }

  if (!connection) {
    console.warn('[IG:GATEWAY] ⏭️  Conexão não encontrada ou de outra empresa:', {
      connection_id: conv.connection_id, company_id,
    })
    return { success: false, skip_reason: 'connection_not_found' }
  }

  if (connection.status !== 'active') {
    console.log('[IG:GATEWAY] ⏭️  Conexão inativa — skip:', {
      connection_id: connection.id, status: connection.status, run_id,
    })
    return { success: false, skip_reason: 'connection_inactive' }
  }

  // ── 4. Enviar via serviço compartilhado ────────────────────────────────────
  console.log('[IG:GATEWAY] 📤 Enviando resposta do agente:', {
    run_id,
    instagram_conversation_id,
    company_id,
    response_length: trimmedResponse.length,
  })

  const sendResult = await sendInstagramMessage({
    supabase:       svc,
    conversationId: instagram_conversation_id,
    companyId:      company_id,
    text:           trimmedResponse,
    sentBy:         null,
    origin:         'agent',
  })

  if (!sendResult.ok) {
    console.warn('[IG:GATEWAY] ⚠️  Falha no envio:', {
      error_type: sendResult.errorType,
      error:      sendResult.error,
      run_id,
    })
    return {
      success:    false,
      skip_reason: sendResult.errorType ?? 'send_failed',
      error:       sendResult.error ?? undefined,
    }
  }

  console.log('[IG:GATEWAY] ✅ Resposta enviada:', {
    run_id,
    ig_message_id: sendResult.igMessageId,
    message_id:    sendResult.savedMessage?.id ?? null,
    instagram_conversation_id,
  })

  return {
    success:       true,
    ig_message_id: sendResult.igMessageId,
    message_id:    sendResult.savedMessage?.id ?? null,
  }
}
