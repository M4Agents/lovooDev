// =============================================================================
// api/lib/agents/whatsappGateway.js
//
// WhatsAppGateway — Etapa 9 MVP Agentes de Conversação
//
// RESPONSABILIDADE ÚNICA:
//   Receber os blocos do ResponseComposer, persistir cada um como chat_message
//   e enviar via Uazapi, bloco a bloco, na ordem do index.
//   Revalida ai_state antes de cada envio. Atualiza agent_conversation_sessions
//   com o total de mensagens enviadas ao final.
//
// FLUXO POR BLOCO:
//   1. Revalidar ai_state da conversa no banco
//      → se != 'ai_active': abortar blocos restantes
//   2. Persistir via chat_create_message (SECURITY DEFINER)
//      → p_sent_by = null (mensagem de IA)
//      → p_is_ai_generated = true
//      → p_ai_run_id, p_ai_block_index, p_ai_block_type preenchidos
//      → falha de persistência: abortar (não enviar sem registro no banco)
//   3. Enviar via Uazapi
//      → POST https://lovoo.uazapi.com/send/text
//      → Header: token = whatsapp_life_instances.provider_token
//      → timeout: 30s
//      → 4xx: abortar (erro de configuração — afeta todos os blocos)
//      → 5xx: logar, continuar (erro temporário do provider)
//   4. Atualizar status da mensagem (sent / failed)
//
// PREPARAÇÃO (feita uma vez antes do loop):
//   - Buscar instance_id + contact_phone de chat_conversations
//   - Buscar provider_instance_id + provider_token de whatsapp_life_instances
//
// PÓS-LOOP:
//   - Atualizar agent_conversation_sessions.messages_sent += successCount
//
// MULTI-TENANT:
//   company_id revalidado em todas as queries de banco.
//   Nunca confia apenas no composerOutput.
//
// DELAY ENTRE BLOCOS:
//   Simulação de digitação humana via parâmetro 'delay' do Uazapi.
//   Calcula delay proporcional ao tamanho do bloco (300-1200ms).
//   Chamadas são sequenciais (await); o delay é processado no servidor Uazapi.
//
// RETORNO:
//   { success: true, successCount, abortReason? }
//   { success: false, error: string, stage: string }
// =============================================================================

import { createClient } from '@supabase/supabase-js';

// ── Constantes ─────────────────────────────────────────────────────────────────

const UAZAPI_BASE_URL  = 'https://lovoo.uazapi.com';
const UAZAPI_TIMEOUT   = 30_000;

/** Delay mínimo antes do envio (ms) — simula digitação no Uazapi */
const SEND_DELAY_MIN = 300;
/** Delay máximo antes do envio (ms) */
const SEND_DELAY_MAX = 1200;
/** ms por caractere para calcular delay proporcional */
const SEND_DELAY_PER_CHAR = 10;

// ── Cliente service_role ───────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url.trim() || !key.trim()) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// ── Função principal ───────────────────────────────────────────────────────────

/**
 * Envia todos os blocos do ResponseComposerOutput ao WhatsApp, bloco a bloco.
 *
 * @param {object} composerOutput — ResponseComposerOutput (Etapa 8)
 * @returns {{ success: boolean, successCount?: number, abortReason?: string, error?: string, stage?: string }}
 */
export async function sendBlocks(composerOutput) {
  const svc = getServiceSupabase();
  if (!svc) {
    console.error('🤖 [GATEWAY] ❌ service_role não disponível — variáveis de ambiente ausentes');
    return { success: false, error: 'service_role_unavailable', stage: 'init' };
  }

  const { run_id, session_id, blocks, metadata } = composerOutput;
  const { company_id, conversation_id, assignment_id } = metadata;

  // ── 1. Buscar contexto da conversa (uma vez, antes do loop) ────────────────
  const convContext = await fetchConversationContext(svc, { conversation_id, company_id });
  if (!convContext.success) {
    return { success: false, error: convContext.error, stage: 'fetch_conversation' };
  }
  const { instance_id, contact_phone } = convContext;

  // ── 2. Buscar contexto do provider (instância + token) ─────────────────────
  const providerCtx = await fetchProviderContext(svc, { instance_id, company_id });
  if (!providerCtx.success) {
    return { success: false, error: providerCtx.error, stage: 'fetch_provider' };
  }
  const { provider_instance_id, api_key } = providerCtx;

  // ── 3. Loop de envio bloco a bloco ─────────────────────────────────────────
  let successCount = 0;
  let abortReason  = null;

  for (const block of blocks) {

    // 3a. Revalidar ai_state antes de cada bloco
    const stateCheck = await checkAiState(svc, { conversation_id, company_id });
    if (!stateCheck.isActive) {
      abortReason = 'ai_state_changed';
      console.log(`🤖 [GATEWAY] ⏹️  Envio interrompido: ai_state mudou (block.index=${block.index}):`, {
        ai_state:        stateCheck.ai_state,
        run_id,
        conversation_id,
        blocks_sent:     successCount,
        blocks_remaining: blocks.length - block.index
      });
      break;
    }

    // 3b. Persistir mensagem no banco via chat_create_message
    const persistResult = await persistBlock(svc, {
      block,
      run_id,
      conversation_id,
      company_id
    });

    if (!persistResult.success) {
      // Falha de persistência é crítica: não enviar bloco sem registro no banco
      abortReason = 'persist_failed';
      console.error(`🤖 [GATEWAY] ❌ Falha crítica ao persistir bloco ${block.index} — abortando:`, persistResult.error);
      break;
    }

    const { message_id } = persistResult;
    console.log(`🤖 [GATEWAY] 💾 Bloco ${block.index} persistido:`, {
      message_id,
      content_length: block.content.length,
      run_id,
      conversation_id
    });

    // 3c. Enviar via Uazapi
    const sendDelay = calculateSendDelay(block.content);
    const sendResult = await sendViaUazapi({
      api_key,
      phone:   contact_phone,
      content: block.content,
      delay:   sendDelay
    });

    // 3d. Atualizar status da mensagem
    await updateMessageStatus(svc, {
      message_id,
      company_id,
      ok:                sendResult.ok,
      uazapi_message_id: sendResult.uazapi_message_id,
      error_message:     sendResult.error_message
    });

    // #endregion

    if (sendResult.ok) {
      successCount++;
      console.log(`🤖 [GATEWAY] ✅ Bloco ${block.index} enviado:`, {
        message_id,
        uazapi_message_id: sendResult.uazapi_message_id,
        content_length:    block.content.length,
        run_id,
        conversation_id
      });
    } else {
      // Qualquer falha de envio (4xx, 5xx ou erro de rede) aborta os blocos restantes.
      // MVP: segurança sobre resiliência — evita que o lead receba mensagens
      // fora de contexto se um bloco anterior da sequência não foi entregue.
      // Fase futura: implementar retry/backoff por bloco.
      abortReason = sendResult.http_status
        ? `uazapi_${sendResult.http_status}`
        : 'uazapi_network_error';

      console.warn(`🤖 [GATEWAY] ⚠️  Falha no envio do bloco ${block.index} — abortando sequência:`, {
        message_id,
        http_status:  sendResult.http_status ?? 'network_error',
        error:        sendResult.error_message,
        abort_reason: abortReason,
        run_id,
        conversation_id
      });
      break;
    }
  }

  // ── 4. Atualizar agent_conversation_sessions.messages_sent ─────────────────
  if (successCount > 0 && session_id) {
    await incrementSessionMessages(svc, { session_id, company_id, count: successCount });
  }

  // ── 5. Resultado final ─────────────────────────────────────────────────────
  console.log('🤖 [GATEWAY] 🏁 Envio concluído:', {
    run_id,
    conversation_id,
    total_blocks:  blocks.length,
    sent:          successCount,
    failed:        blocks.length - successCount,
    abort_reason:  abortReason ?? 'none'
  });

  return {
    success:      successCount > 0 || abortReason === null,
    successCount,
    abortReason
  };
}

// ── Funções auxiliares ─────────────────────────────────────────────────────────

/**
 * Busca instance_id e contact_phone da conversa.
 * Revalida company_id para garantir isolamento multi-tenant.
 */
async function fetchConversationContext(svc, { conversation_id, company_id }) {
  const { data, error } = await svc
    .from('chat_conversations')
    .select('instance_id, contact_phone, ai_state')
    .eq('id', conversation_id)
    .eq('company_id', company_id)
    .single();

  if (error || !data) {
    console.error('🤖 [GATEWAY] ❌ Conversa não encontrada:', { conversation_id, company_id, error });
    return { success: false, error: 'conversation_not_found' };
  }

  if (!data.instance_id) {
    console.error('🤖 [GATEWAY] ❌ instance_id ausente na conversa:', { conversation_id });
    return { success: false, error: 'missing_instance_id' };
  }

  if (!data.contact_phone) {
    console.error('🤖 [GATEWAY] ❌ contact_phone ausente na conversa:', { conversation_id });
    return { success: false, error: 'missing_contact_phone' };
  }

  return {
    success:       true,
    instance_id:   data.instance_id,
    contact_phone: data.contact_phone
  };
}

/**
 * Busca provider_instance_id e api_key para o envio via Uazapi.
 * Queries independentes para compatibilidade com RLS e schema.
 */
async function fetchProviderContext(svc, { instance_id, company_id }) {
  // Buscar provider_instance_id + provider_token da instância
  // provider_token é o token de autenticação do Uazapi (não confundir com api_key da empresa)
  const { data: instance, error: instError } = await svc
    .from('whatsapp_life_instances')
    .select('provider_instance_id, provider_token')
    .eq('id', instance_id)
    .eq('company_id', company_id)
    .single();

  if (instError || !instance?.provider_instance_id) {
    console.error('🤖 [GATEWAY] ❌ Instância não encontrada:', { instance_id, company_id, error: instError });
    return { success: false, error: 'instance_not_found' };
  }

  if (!instance?.provider_token) {
    console.error('🤖 [GATEWAY] ❌ provider_token ausente na instância:', { instance_id });
    return { success: false, error: 'missing_provider_token' };
  }

  return {
    success:               true,
    provider_instance_id:  instance.provider_instance_id,
    api_key:               instance.provider_token  // provider_token = token Uazapi da instância
  };
}

/**
 * Revalida ai_state diretamente do banco antes de cada envio.
 * Garante que um humano que assumiu a conversa interrompa o envio imediatamente.
 */
async function checkAiState(svc, { conversation_id, company_id }) {
  const { data, error } = await svc
    .from('chat_conversations')
    .select('ai_state')
    .eq('id', conversation_id)
    .eq('company_id', company_id)
    .single();

  if (error || !data) {
    // Se não conseguimos verificar, é mais seguro abortar
    console.warn('🤖 [GATEWAY] ⚠️  Falha ao revalidar ai_state — abortando por segurança:', error);
    return { isActive: false, ai_state: 'unknown' };
  }

  return {
    isActive: data.ai_state === 'ai_active',
    ai_state: data.ai_state
  };
}

/**
 * Persiste o bloco como chat_message via RPC chat_create_message.
 * Usa o overload de 11 parâmetros com campos de IA.
 * p_sent_by = null indica mensagem gerada por agente.
 */
async function persistBlock(svc, { block, run_id, conversation_id, company_id }) {
  const { data, error } = await svc.rpc('chat_create_message', {
    p_conversation_id: conversation_id,
    p_company_id:      company_id,
    p_content:         block.content,
    p_message_type:    'text',
    p_direction:       'outbound',
    p_sent_by:         null,          // null = mensagem de agente (sem usuário humano)
    p_media_url:       null,
    p_is_ai_generated: true,
    p_ai_run_id:       run_id,
    p_ai_block_index:  block.index,
    p_ai_block_type:   block.type     // 'text' no MVP
  });

  if (error) {
    console.error('🤖 [GATEWAY] ❌ Erro RPC chat_create_message:', error);
    return { success: false, error: error.message };
  }

  if (!data?.success) {
    console.error('🤖 [GATEWAY] ❌ chat_create_message retornou success=false:', data);
    return { success: false, error: data?.error ?? 'unknown_rpc_error' };
  }

  return { success: true, message_id: data.message_id };
}

/**
 * Envia uma mensagem de texto via Uazapi.
 * O campo 'delay' é processado pelo servidor Uazapi antes do envio,
 * simulando tempo de digitação humana.
 *
 * @returns {{ ok: boolean, uazapi_message_id?, http_status?, error_message? }}
 */
async function sendViaUazapi({ api_key, phone, content, delay }) {
  const url     = `${UAZAPI_BASE_URL}/send/text`;
  const payload = {
    number:      phone,
    text:        content,
    delay:       delay,
    linkPreview: false  // desabilitado para mensagens de agente
  };

  let response;
  let responseBody;

  try {
    response = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'token':        api_key
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(UAZAPI_TIMEOUT)
    });

    responseBody = await response.json().catch(() => ({}));
  } catch (networkError) {
    // Timeout ou erro de rede — não crítico, apenas logar
    console.error('🤖 [GATEWAY] ❌ Erro de rede ao chamar Uazapi:', networkError.message);
    return {
      ok:            false,
      error_message: `network_error: ${networkError.message}`
    };
  }

  if (response.ok) {
    return {
      ok:                true,
      uazapi_message_id: responseBody.messageid ?? responseBody.id ?? null,
      http_status:       response.status
    };
  }

  return {
    ok:            false,
    http_status:   response.status,
    error_message: `HTTP ${response.status}: ${JSON.stringify(responseBody).substring(0, 200)}`
  };
}

/**
 * Atualiza status da mensagem via RPC update_message_status.
 * Fire-and-forget interno: falha não interrompe o fluxo.
 */
async function updateMessageStatus(svc, { message_id, company_id, ok, uazapi_message_id, error_message }) {
  if (!message_id) return;

  try {
    const { error } = await svc.rpc('update_message_status', {
      p_message_id:        message_id,
      p_status:            ok ? 'sent' : 'failed',
      p_uazapi_message_id: uazapi_message_id ?? null,
      p_error_message:     ok ? null : error_message
    });

    if (error) {
      console.warn('🤖 [GATEWAY] ⚠️  Falha ao atualizar status da mensagem (não crítico):', {
        message_id,
        error
      });
    }
  } catch (err) {
    // Nunca interromper o loop por falha de atualização de status
    console.warn('🤖 [GATEWAY] ⚠️  Exceção ao atualizar status (ignorada):', err.message);
  }
}

/**
 * Incrementa agent_conversation_sessions.messages_sent de forma segura.
 * Lê o valor atual antes de incrementar para evitar override.
 */
async function incrementSessionMessages(svc, { session_id, company_id, count }) {
  try {
    const { data: session, error: fetchError } = await svc
      .from('agent_conversation_sessions')
      .select('messages_sent')
      .eq('id', session_id)
      .eq('company_id', company_id)
      .single();

    if (fetchError || !session) {
      console.warn('🤖 [GATEWAY] ⚠️  Sessão não encontrada para atualizar messages_sent:', { session_id });
      return;
    }

    const newCount = (session.messages_sent ?? 0) + count;

    const { error: updateError } = await svc
      .from('agent_conversation_sessions')
      .update({ messages_sent: newCount })
      .eq('id', session_id)
      .eq('company_id', company_id);

    if (updateError) {
      console.warn('🤖 [GATEWAY] ⚠️  Falha ao atualizar messages_sent (não crítico):', updateError);
    } else {
      console.log('🤖 [GATEWAY] 📊 messages_sent atualizado:', { session_id, new_count: newCount });
    }
  } catch (err) {
    console.warn('🤖 [GATEWAY] ⚠️  Exceção ao atualizar messages_sent (ignorada):', err.message);
  }
}

/**
 * Calcula o delay de envio em ms com base no tamanho do bloco.
 * Delay proporcional ao texto: simula tempo de digitação humana no servidor Uazapi.
 * Range: SEND_DELAY_MIN – SEND_DELAY_MAX.
 */
function calculateSendDelay(content) {
  const raw = SEND_DELAY_MIN + (content.length * SEND_DELAY_PER_CHAR);
  return Math.min(raw, SEND_DELAY_MAX);
}
