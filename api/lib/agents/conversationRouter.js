// =============================================================================
// api/lib/agents/conversationRouter.js
//
// ConversationRouter — Etapa 4 MVP Agentes de Conversação
//
// RESPONSABILIDADE ÚNICA:
//   Decidir SE e COM QUAL assignment processar um evento de conversação.
//   Não executa o agente. Não monta contexto. Não envia mensagens.
//
// FLUXO:
//   1. Deduplicação (agent_processed_messages — INSERT atômico)
//   2. Verificação de ai_state (deve ser 'ai_active')
//   3. Resolução de routing rule (company_id + channel + especificidade)
//   4. Resolução de assignment + capabilities
//   5. Validação de can_auto_reply
//   6. Retorno do RouterDecision
//
// ACESSO AO BANCO:
//   Exclusivamente via service_role — bypass de RLS onde necessário.
//   agent_processed_messages tem RLS sem policies → só service_role pode gravar.
//
// RETORNO:
//   RouterDecision: { should_process, skip_reason, assignment_id, ... }
//   Quando should_process = false → o endpoint retorna 200 silencioso.
//   Quando should_process = true  → o endpoint dispara execute-agent (fire-and-forget).
//
// DEDUPLICAÇÃO:
//   INSERT em agent_processed_messages com uazapi_message_id como PK.
//   Se já existir (error code 23505) → mensagem já foi processada → skip silencioso.
//   INSERT primeiro garante atomicidade em invocações paralelas do mesmo evento.
//
// MATCHING DE REGRAS:
//   Regras ordenadas por priority ASC (menor número = maior prioridade).
//   Para cada regra, verifica event_type, source_type, source_identifier.
//   Campos NULL na regra = "qualquer valor" (wildcard).
//   Primeiro match válido é usado. Regra com is_fallback = true é catch-all.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { resolveFlowAgent } from './flowOrchestrator.js';

// ── Cliente service_role ──────────────────────────────────────────────────────
// Segue o mesmo padrão de api/lib/agents/logger.ts

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url.trim() || !key.trim()) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// ── Tipos de skip (internos ao Router) ───────────────────────────────────────
// Mapeados para os valores válidos de agent_processed_messages.result ao gravar.

const SKIP = {
  ALREADY_PROCESSED: 'already_processed', // Sem gravação — registro já existe
  AI_INACTIVE:       'ai_inactive',        // → DB: 'skipped_ai_inactive'
  NO_RULE:           'no_rule',            // → DB: 'skipped_no_rule'
  CAPABILITY_DENIED: 'capability_denied',  // → DB: 'skipped_no_rule'
  ERROR:             'error',              // → DB: 'error'
};

// Mapeamento RouterDecision.skip_reason → agent_processed_messages.result
const SKIP_TO_DB_RESULT = {
  [SKIP.AI_INACTIVE]:       'skipped_ai_inactive',
  [SKIP.NO_RULE]:           'skipped_no_rule',
  [SKIP.CAPABILITY_DENIED]: 'skipped_no_rule',
  [SKIP.ERROR]:             'error',
};

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Roteia um evento de conversação para o assignment correto.
 *
 * @param {object} event - Evento emitido pelo ConversationEventEmitter
 * @returns {RouterDecision}
 */
export async function routeConversationEvent(event) {
  const svc = getServiceSupabase();

  if (!svc) {
    console.error('🤖 [ROUTER] ❌ service_role client indisponível — verifique SUPABASE_SERVICE_ROLE_KEY');
    return buildDecision(false, SKIP.ERROR, null, event);
  }

  // ── PASSO 1: Deduplicação ─────────────────────────────────────────────────
  // INSERT atômico: se uazapi_message_id já existe (PK), retorna code 23505.
  // Garante que invocações paralelas do mesmo evento não se duplicam.

  const { error: insertError } = await svc
    .from('agent_processed_messages')
    .insert({
      uazapi_message_id: event.uazapi_message_id,
      conversation_id:   event.conversation_id,
      company_id:        event.company_id,
      assignment_id:     null,
      result:            'processed'  // valor temporário; atualizado abaixo
    });

  if (insertError) {
    if (insertError.code === '23505') {
      // Deduplicação: mensagem já registrada por execução anterior
      console.log('🤖 [ROUTER] ⏭️  Deduplicado — mensagem já processada:', event.uazapi_message_id);
      return buildDecision(false, SKIP.ALREADY_PROCESSED, null, event);
    }
    // Erro de banco inesperado — não tentar gravar (pode falhar também)
    console.error('🤖 [ROUTER] ❌ Erro ao registrar deduplicação:', insertError.message);
    return buildDecision(false, SKIP.ERROR, null, event);
  }

  // ── PASSO 2: Verificar ai_state da conversa ───────────────────────────────
  // O Router só age quando ai_state = 'ai_active'.
  // Todos os outros estados (inactive, paused, suggested) são ignorados.

  const { data: conversation, error: convError } = await svc
    .from('chat_conversations')
    .select('id, ai_state, ai_assignment_id, contact_phone')
    .eq('id', event.conversation_id)
    .eq('company_id', event.company_id)  // garante multi-tenant
    .single();

  if (convError || !conversation) {
    console.error('🤖 [ROUTER] ❌ Conversa não encontrada:', {
      conversation_id: event.conversation_id,
      company_id:      event.company_id,
      error:           convError?.message
    });
    await updateProcessedResult(svc, event.uazapi_message_id, SKIP.ERROR, null);
    return buildDecision(false, SKIP.ERROR, null, event);
  }

  if (conversation.ai_state !== 'ai_active') {
    console.log('🤖 [ROUTER] ⏭️  ai_state não é ai_active:', {
      conversation_id: event.conversation_id,
      ai_state:        conversation.ai_state
    });
    await updateProcessedResult(svc, event.uazapi_message_id, SKIP.AI_INACTIVE, null);
    return buildDecision(false, SKIP.AI_INACTIVE, conversation, event);
  }

  // ── PASSO 2.5: Verificar fluxo ativo (Phase 3) ───────────────────────────
  // Se a conversa tem um conversation_flow_states ativo, o agent_id do estágio
  // atual tem prioridade sobre as agent_routing_rules.
  // locked_opportunity_id é propagado ao contexto para o toolExecutor.

  const flowResult = await resolveFlowAgent(event.conversation_id, event.company_id);

  if (flowResult) {
    console.log('🤖 [ROUTER] 🔀 Fluxo ativo — usando agente do estágio:', {
      agent_id:    flowResult.agent_id,
      conversation_id: event.conversation_id,
    });

    await updateProcessedResult(svc, event.uazapi_message_id, null, conversation.ai_assignment_id);

    return {
      should_process:        true,
      skip_reason:           null,
      rule_id:               null,
      assignment_id:         conversation.ai_assignment_id,
      agent_id:              flowResult.agent_id,
      flow_state_id:         flowResult.flow_state_id,
      locked_opportunity_id: flowResult.locked_opportunity_id,
      capabilities:          { can_auto_reply: true },
      price_display_policy:  null,
      conversation: {
        id:               conversation.id,
        ai_state:         conversation.ai_state,
        ai_assignment_id: conversation.ai_assignment_id,
        contact_phone:    conversation.contact_phone
      },
      event
    };
  }

  // ── PASSO 3: Resolver routing rule ────────────────────────────────────────
  // Busca todas as regras ativas da empresa para o canal do evento.
  // Inclui regras com channel = '*' (canal coringa).
  // Ordenadas por priority ASC — menor número = maior prioridade.

  const { data: rules, error: rulesError } = await svc
    .from('agent_routing_rules')
    .select('id, assignment_id, channel, event_type, source_type, source_identifier, priority, is_fallback')
    .eq('company_id', event.company_id)
    .eq('is_active', true)
    .or(`channel.eq.${event.channel},channel.eq.*`)
    .order('priority', { ascending: true });

  if (rulesError) {
    console.error('🤖 [ROUTER] ❌ Erro ao buscar routing rules:', rulesError.message);
    await updateProcessedResult(svc, event.uazapi_message_id, SKIP.ERROR, null);
    return buildDecision(false, SKIP.ERROR, conversation, event);
  }

  const matchedRule = findMatchingRule(rules ?? [], event);

  if (!matchedRule) {
    console.log('🤖 [ROUTER] ⏭️  Nenhuma routing rule corresponde ao evento:', {
      company_id:        event.company_id,
      channel:           event.channel,
      event_type:        event.event_type,
      source_identifier: event.source_identifier,
      rules_checked:     rules?.length ?? 0
    });
    await updateProcessedResult(svc, event.uazapi_message_id, SKIP.NO_RULE, null);
    return buildDecision(false, SKIP.NO_RULE, conversation, event);
  }

  // ── PASSO 4: Resolver assignment + capabilities ───────────────────────────
  // O assignment define o agente base (agent_id) e suas capacidades operacionais.
  // Validação de company_id aqui garante multi-tenant mesmo com assignment_id externo.

  const { data: assignment, error: assignError } = await svc
    .from('company_agent_assignments')
    .select('id, agent_id, capabilities, price_display_policy, is_active, display_name')
    .eq('id', matchedRule.assignment_id)
    .eq('company_id', event.company_id)  // garante multi-tenant
    .single();

  if (assignError || !assignment) {
    console.error('🤖 [ROUTER] ❌ Assignment não encontrado ou fora da empresa:', {
      assignment_id: matchedRule.assignment_id,
      company_id:    event.company_id,
      error:         assignError?.message
    });
    await updateProcessedResult(svc, event.uazapi_message_id, SKIP.NO_RULE, null);
    return buildDecision(false, SKIP.NO_RULE, conversation, event);
  }

  if (!assignment.is_active) {
    console.log('🤖 [ROUTER] ⏭️  Assignment inativo:', assignment.id);
    await updateProcessedResult(svc, event.uazapi_message_id, SKIP.NO_RULE, null);
    return buildDecision(false, SKIP.NO_RULE, conversation, event);
  }

  // ── PASSO 5: Validar can_auto_reply ──────────────────────────────────────
  // Esta capability determina se o agente pode responder automaticamente.
  // Não depende do prompt — é uma regra de negócio controlada pelo backend.

  const capabilities = assignment.capabilities ?? {};

  if (!capabilities.can_auto_reply) {
    console.log('🤖 [ROUTER] ⏭️  can_auto_reply = false para assignment:', {
      assignment_id:  assignment.id,
      display_name:   assignment.display_name,
      capabilities
    });
    await updateProcessedResult(svc, event.uazapi_message_id, SKIP.CAPABILITY_DENIED, assignment.id);
    return buildDecision(false, SKIP.CAPABILITY_DENIED, conversation, event);
  }

  // ── PASSO 6: Atualizar agent_processed_messages com assignment_id resolvido ──
  // Mantém result = 'processed' (correto: o Router decidiu processar).
  // assignment_id agora preenchido para rastreabilidade.

  await updateProcessedResult(svc, event.uazapi_message_id, null, assignment.id);

  console.log('🤖 [ROUTER] ✅ Roteado com sucesso:', {
    rule_id:         matchedRule.id,
    rule_priority:   matchedRule.priority,
    assignment_id:   assignment.id,
    agent_id:        assignment.agent_id,
    display_name:    assignment.display_name,
    conversation_id: event.conversation_id
  });

  // ── RouterDecision final ──────────────────────────────────────────────────

  return {
    should_process:        true,
    skip_reason:           null,
    rule_id:               matchedRule.id,
    assignment_id:         assignment.id,
    agent_id:              assignment.agent_id,
    flow_state_id:         null,
    locked_opportunity_id: null,
    capabilities,
    price_display_policy:  assignment.price_display_policy,
    conversation: {
      id:               conversation.id,
      ai_state:         conversation.ai_state,
      ai_assignment_id: conversation.ai_assignment_id,
      contact_phone:    conversation.contact_phone
    },
    event
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Encontra a primeira routing rule que corresponde ao evento.
 * Rules já chegam ordenadas por priority ASC — primeiro match é o correto.
 *
 * Lógica de especificidade (gerenciada pela ordenação por priority):
 *   - Regra com source_identifier preenchido = mais específica (prioridade baixa numericamente)
 *   - Regra com source_type preenchido = intermediária
 *   - Regra is_fallback = true, todos NULL = catch-all (prioridade alta numericamente)
 *
 * Campos NULL na regra = wildcard para aquela dimensão.
 */
function findMatchingRule(rules, event) {
  for (const rule of rules) {
    // event_type: se a regra especifica, deve bater exatamente
    if (rule.event_type !== null && rule.event_type !== event.event_type) continue;
    // source_type: se a regra especifica, deve bater exatamente
    if (rule.source_type !== null && rule.source_type !== event.source_type) continue;
    // source_identifier: se a regra especifica, deve bater exatamente
    if (rule.source_identifier !== null && rule.source_identifier !== event.source_identifier) continue;
    // Todas as condições satisfeitas (ou todas NULL = catch-all)
    return rule;
  }
  return null;
}

/**
 * Atualiza o resultado de um registro em agent_processed_messages.
 * Fire-and-forget: falhas são silenciosas (não interrompem o Router).
 *
 * @param {object} svc             - Cliente service_role
 * @param {string} uazapi_message_id
 * @param {string|null} skipReason - Chave SKIP.* ou null para manter 'processed'
 * @param {string|null} assignmentId
 */
async function updateProcessedResult(svc, uazapi_message_id, skipReason, assignmentId) {
  try {
    const update = {};

    // Traduz skip_reason interno para o enum aceito pelo banco
    if (skipReason && SKIP_TO_DB_RESULT[skipReason]) {
      update.result = SKIP_TO_DB_RESULT[skipReason];
    }
    // assignment_id: atualiza sempre que fornecido
    if (assignmentId !== undefined) {
      update.assignment_id = assignmentId;
    }

    if (Object.keys(update).length === 0) return;

    await svc
      .from('agent_processed_messages')
      .update(update)
      .eq('uazapi_message_id', uazapi_message_id);

  } catch (err) {
    // Nunca deve interromper o fluxo do Router
    console.error('🤖 [ROUTER] ⚠️  Falha ao atualizar agent_processed_messages:', err.message);
  }
}

/**
 * Constrói um RouterDecision de skip (should_process = false).
 */
function buildDecision(shouldProcess, skipReason, conversation, event) {
  return {
    should_process:       shouldProcess,
    skip_reason:          skipReason,
    rule_id:              null,
    assignment_id:        null,
    agent_id:             null,
    capabilities:         null,
    price_display_policy: null,
    conversation: conversation ? {
      id:               conversation.id,
      ai_state:         conversation.ai_state,
      ai_assignment_id: conversation.ai_assignment_id,
      contact_phone:    conversation.contact_phone
    } : null,
    event
  };
}
