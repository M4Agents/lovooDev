// =============================================================================
// api/lib/agents/conversationRouter.js
//
// ConversationRouter — Etapa 4 + Etapa 14 (agrupamento controlado)
//
// RESPONSABILIDADE ÚNICA:
//   Decidir SE e COM QUAL assignment processar um evento de conversação.
//   Não executa o agente. Não monta contexto. Não envia mensagens.
//
// FLUXO BASE (sem agrupamento — comportamento preservado):
//   1. Deduplicação via INSERT atômico em agent_processed_messages
//   2. Verificação de ai_state
//   3. Verificação de fluxo ativo
//   4. Resolução de routing rule
//   5. Resolução de assignment + capabilities
//   6. Validação de can_auto_reply
//   7. Verificação de schedule
//   8. Retorno should_process = true
//
// FLUXO COM AGRUPAMENTO (Etapa 14 — somente quando efetivamente habilitado):
//   Idêntico ao fluxo base até o PASSO 6. No PASSO 6.5:
//   - Lê model_config.message_grouping_window_s do agente (1 query adicional)
//   - Se window > 0: chama enqueue → RPC gerencia dedup + APM atomicamente
//   - Se window = 0 ou inválido: segue fluxo base normalmente
//
// SEPARAÇÃO DE CONCEITOS (crítico):
//   canUseMessageGrouping   = elegibilidade pelo evento (canal, tipo, instance_id)
//                             Determina apenas qual estratégia de APM usar nos SKIPS.
//   groupingWindowSeconds   = configuração efetiva do agente (lida no PASSO 6.5)
//   isMessageGroupingEnabled = canUseMessageGrouping && window > 0
//                             Determina se a execução final usa enqueue ou LLM imediato.
//
// GARANTIAS DE AUDITORIA EM SKIPS:
//   Caminho não-agrupado (!canUseMessageGrouping):
//     PASSO 1 faz INSERT → skips fazem UPDATE via updateProcessedResult (comportamento original).
//   Caminho agrupável (canUseMessageGrouping = true) com skip:
//     INSERT na hora do skip com o resultado já definido (skipWithAudit).
//     Idempotente: 23505 = dedup paralelo, silenciado.
//   Caminho agrupável com grouping habilitado (isMessageGroupingEnabled = true):
//     INSERT omitido no Router — RPC enqueue cria APM com instance_id IS NOT NULL.
//     Evita estado parcial: sem INSERT antigo + falha no enqueue = retry funciona.
//
// TRATAMENTO DE ERROS DO ENQUEUE:
//   Erros técnicos (DB_ERROR, TENANT_VIOLATION, BATCH_LIMIT_REACHED, etc.) lançam throw.
//   process-conversation-event.js captura e retorna 500 (não mascara como sucesso).
//   Duplicata saudável e mensagem nova = retorno HTTP 200 (sucesso funcional).
//
// DEDUPLICAÇÃO (dois índices parciais independentes):
//   apm_dedup_router:  UNIQUE(company_id, uazapi_message_id) WHERE instance_id IS NULL
//   apm_dedup_enqueue: UNIQUE(company_id, instance_id, uazapi_message_id) WHERE instance_id IS NOT NULL
// =============================================================================

import { createClient }    from '@supabase/supabase-js';
import { resolveFlowAgent } from './flowOrchestrator.js';
import { isWithinSchedule } from './scheduleUtils.js';
import {
  enqueueMessage,
  MessageBufferLimitError,
  MessageBufferTenantError,
  MessageBufferDuplicateStateError,
  MessageBufferDatabaseError,
  MessageBufferStateError,
  MessageBufferValidationError,
} from './messageBufferService.js';

// ── Cliente service_role ──────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url.trim() || !key.trim()) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// ── Tipos de evento inbound elegíveis para agrupamento ────────────────────────
// Somente mensagens reais do usuário. Exclui status, confirmações e eventos internos.
const INBOUND_EVENT_TYPES = new Set(['conversation.message_received']);

// ── Limites de agrupamento — fixos no backend ────────────────────────────────
const GROUPING_MAX_WINDOW_SECONDS         = 120;
const GROUPING_MAX_BATCH_DURATION_SECONDS = 120;

// ── Tipos de skip (internos ao Router) ───────────────────────────────────────

const SKIP = {
  ALREADY_PROCESSED: 'already_processed',
  AI_INACTIVE:       'ai_inactive',
  NO_RULE:           'no_rule',
  CAPABILITY_DENIED: 'capability_denied',
  OUT_OF_SCHEDULE:   'out_of_schedule',
  ERROR:             'error',
  MESSAGE_BUFFERED:  'message_buffered',
};

// Mapeamento skip_reason → agent_processed_messages.result
const SKIP_TO_DB_RESULT = {
  [SKIP.AI_INACTIVE]:       'skipped_ai_inactive',
  [SKIP.NO_RULE]:           'skipped_no_rule',
  [SKIP.CAPABILITY_DENIED]: 'skipped_no_rule',
  [SKIP.OUT_OF_SCHEDULE]:   'skipped_out_of_schedule',
  [SKIP.ERROR]:             'error',
};

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Roteia um evento de conversação para o assignment correto.
 *
 * @param {object}   event            - Evento do ConversationEventEmitter
 * @param {object}   [_deps]          - Dependências injetáveis (para testes)
 * @param {object}   [_deps.svc]      - Cliente service_role
 * @param {Function} [_deps.enqueueMessage] - Função de enqueue
 * @returns {RouterDecision}
 * @throws {MessageBufferError} Se o enqueue falhar tecnicamente (permite retry via 500)
 */
export async function routeConversationEvent(event, _deps = {}) {
  const svc             = _deps.svc            ?? getServiceSupabase();
  const _enqueueMessage = _deps.enqueueMessage ?? enqueueMessage;

  if (!svc) {
    console.error('🤖 [ROUTER] ❌ service_role client indisponível');
    return buildDecision(false, SKIP.ERROR, null, event);
  }

  // ── PASSO 0: Elegibilidade para agrupamento (sem I/O) ─────────────────────
  // Determina apenas se o evento É DO TIPO que pode ser agrupado.
  // Não determina se grouping está habilitado no agente — isso é resolvido no PASSO 6.5.
  //
  // Elegível: canal whatsapp + evento inbound + instance_id presente.
  // Exclui: canal web, status de entrega, outbound, eventos sem instance_id.
  //
  // Impacto: controla qual estratégia de APM é usada nos skips:
  //   false → PASSO 1 já fez INSERT → skips fazem UPDATE
  //   true  → PASSO 1 pulado → skips fazem INSERT com resultado final

  const canUseMessageGrouping = (
    event.channel === 'whatsapp' &&
    INBOUND_EVENT_TYPES.has(event.event_type) &&
    !!event.instance_id
  );

  // ── PASSO 1: Deduplicação (somente !canUseMessageGrouping) ───────────────
  // Para canUseMessageGrouping=true: INSERT é diferido.
  //   - Se grouping habilitado (window > 0): RPC enqueue cria APM atomicamente
  //   - Se grouping desabilitado (window = 0): INSERT acontece no PASSO 7
  //   - Se skip ocorre: INSERT acontece na função skipWithAudit
  // Isso evita estado parcial: INSERT antigo + falha de enqueue = mensagem perdida.

  if (!canUseMessageGrouping) {
    const { error: insertError } = await svc
      .from('agent_processed_messages')
      .insert({
        uazapi_message_id: event.uazapi_message_id,
        conversation_id:   event.conversation_id,
        company_id:        event.company_id,
        assignment_id:     null,
        result:            'processed'
      });

    if (insertError) {
      if (insertError.code === '23505') {
        console.log('🤖 [ROUTER] ⏭️  Deduplicado — mensagem já processada:', event.uazapi_message_id);
        return buildDecision(false, SKIP.ALREADY_PROCESSED, null, event);
      }
      console.error('🤖 [ROUTER] ❌ Erro ao registrar deduplicação:', insertError.message);
      return buildDecision(false, SKIP.ERROR, null, event);
    }
  }

  // ── PASSO 2: Verificar ai_state da conversa ───────────────────────────────

  const { data: conversation, error: convError } = await svc
    .from('chat_conversations')
    .select('id, ai_state, ai_assignment_id, contact_phone')
    .eq('id', event.conversation_id)
    .eq('company_id', event.company_id)
    .single();

  if (convError || !conversation) {
    console.error('🤖 [ROUTER] ❌ Conversa não encontrada:', {
      conversation_id: event.conversation_id,
      company_id:      event.company_id,
      error:           convError?.message
    });
    await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.ERROR, null);
    return buildDecision(false, SKIP.ERROR, null, event);
  }

  if (conversation.ai_state !== 'ai_active') {
    console.log('🤖 [ROUTER] ⏭️  ai_state não é ai_active:', {
      conversation_id: event.conversation_id,
      ai_state:        conversation.ai_state
    });
    await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.AI_INACTIVE, null);
    return buildDecision(false, SKIP.AI_INACTIVE, conversation, event);
  }

  // ── PASSO 2.5: Verificar fluxo ativo ────────────────────────────────────
  // Fluxos ativos não usam agrupamento nesta etapa.
  // auditProcessed garante registro APM independente do canUseMessageGrouping.

  const flowResult = await resolveFlowAgent(event.conversation_id, event.company_id);

  if (flowResult) {
    console.log('🤖 [ROUTER] 🔀 Fluxo ativo — usando agente do estágio:', {
      agent_id:        flowResult.agent_id,
      conversation_id: event.conversation_id,
    });

    if (conversation.ai_assignment_id) {
      const { data: flowAssignment } = await svc
        .from('company_agent_assignments')
        .select('operating_schedule')
        .eq('id', conversation.ai_assignment_id)
        .eq('company_id', event.company_id)
        .maybeSingle();

      if (flowAssignment) {
        const flowScheduleCheck = isWithinSchedule(flowAssignment.operating_schedule, {
          assignmentId:   conversation.ai_assignment_id,
          companyId:      event.company_id,
          conversationId: event.conversation_id,
        });

        if (!flowScheduleCheck.allowed) {
          console.log('🤖 [ROUTER] ⏰ Fluxo ativo — fora do horário de atendimento:', {
            event:           'agent_skip_out_of_schedule',
            assignment_id:   conversation.ai_assignment_id,
            company_id:      event.company_id,
            conversation_id: event.conversation_id,
            ...flowScheduleCheck.meta,
            reason:          flowScheduleCheck.reason,
          });
          await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.OUT_OF_SCHEDULE, conversation.ai_assignment_id);
          return buildDecision(false, SKIP.OUT_OF_SCHEDULE, conversation, event);
        }
      }
    }

    await auditProcessed(svc, event, canUseMessageGrouping, conversation.ai_assignment_id);

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

  const { data: rules, error: rulesError } = await svc
    .from('agent_routing_rules')
    .select('id, assignment_id, channel, event_type, source_type, source_identifier, priority, is_fallback')
    .eq('company_id', event.company_id)
    .eq('is_active', true)
    .or(`channel.eq.${event.channel},channel.eq.*`)
    .order('priority', { ascending: true });

  if (rulesError) {
    console.error('🤖 [ROUTER] ❌ Erro ao buscar routing rules:', rulesError.message);
    await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.ERROR, null);
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
    await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.NO_RULE, null);
    return buildDecision(false, SKIP.NO_RULE, conversation, event);
  }

  // ── PASSO 4: Resolver assignment + capabilities ───────────────────────────

  const { data: assignment, error: assignError } = await svc
    .from('company_agent_assignments')
    .select('id, agent_id, capabilities, price_display_policy, is_active, display_name, operating_schedule')
    .eq('id', matchedRule.assignment_id)
    .eq('company_id', event.company_id)
    .single();

  if (assignError || !assignment) {
    console.error('🤖 [ROUTER] ❌ Assignment não encontrado ou fora da empresa:', {
      assignment_id: matchedRule.assignment_id,
      company_id:    event.company_id,
      error:         assignError?.message
    });
    await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.NO_RULE, null);
    return buildDecision(false, SKIP.NO_RULE, conversation, event);
  }

  if (!assignment.is_active) {
    console.log('🤖 [ROUTER] ⏭️  Assignment inativo:', assignment.id);
    await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.NO_RULE, null);
    return buildDecision(false, SKIP.NO_RULE, conversation, event);
  }

  // ── PASSO 5: Validar can_auto_reply ──────────────────────────────────────

  const capabilities = assignment.capabilities ?? {};

  if (!capabilities.can_auto_reply) {
    console.log('🤖 [ROUTER] ⏭️  can_auto_reply = false para assignment:', {
      assignment_id: assignment.id,
      display_name:  assignment.display_name,
      capabilities
    });
    await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.CAPABILITY_DENIED, assignment.id);
    return buildDecision(false, SKIP.CAPABILITY_DENIED, conversation, event);
  }

  // ── PASSO 6: Verificar operating_schedule ────────────────────────────────

  const scheduleCheck = isWithinSchedule(assignment.operating_schedule, {
    assignmentId:   assignment.id,
    companyId:      event.company_id,
    conversationId: event.conversation_id,
  });

  if (!scheduleCheck.allowed) {
    console.log('🤖 [ROUTER] ⏰ Fora do horário de atendimento:', {
      event:           'agent_skip_out_of_schedule',
      assignment_id:   assignment.id,
      company_id:      event.company_id,
      conversation_id: event.conversation_id,
      ...scheduleCheck.meta,
      reason:          scheduleCheck.reason,
    });
    await skipWithAudit(svc, event, canUseMessageGrouping, SKIP.OUT_OF_SCHEDULE, assignment.id);
    return buildDecision(false, SKIP.OUT_OF_SCHEDULE, conversation, event);
  }

  // ── PASSO 6.5: Resolver configuração de agrupamento ──────────────────────
  // Executado somente para eventos elegíveis (canUseMessageGrouping = true).
  // Agora temos todos os dados necessários: company_id, assignment, agent_id.
  // Uma query adicional: lovoo_agents filtrado por company_id + id (multi-tenant).
  //
  // isMessageGroupingEnabled = canUseMessageGrouping && window > 0
  // Somente quando true o INSERT antigo é omitido — caso contrário o PASSO 7
  // faz o INSERT diferido e segue o fluxo normal.

  let isMessageGroupingEnabled = false;
  let groupingWindowSeconds    = 0;

  if (canUseMessageGrouping) {
    groupingWindowSeconds    = await resolveGroupingWindow(svc, event.company_id, assignment.agent_id);
    isMessageGroupingEnabled = groupingWindowSeconds > 0;
  }

  // ── PASSO 7: Execução agrupada (apenas quando efetivamente habilitado) ────
  // Neste ponto: nenhum INSERT antigo de APM foi feito.
  // A RPC agent_message_enqueue_v1 cria o registro APM com instance_id IS NOT NULL.
  //
  // Erros de enqueue lançam throw — process-conversation-event retorna 500.
  // Duplicata saudável = HTTP 200 (sucesso funcional, mensagem já no buffer).
  // Mensagem nova = HTTP 200 (sucesso funcional, message_buffered).

  if (isMessageGroupingEnabled) {
    const messageType = resolveMessageType(event);

    let enqueueResult;
    try {
      enqueueResult = await _enqueueMessage({
        svc,
        companyId:               event.company_id,
        conversationId:          event.conversation_id,
        assignmentId:            assignment.id,
        channel:                 event.channel,
        windowSeconds:           groupingWindowSeconds,
        maxBatchDurationSeconds: GROUPING_MAX_BATCH_DURATION_SECONDS,
        providerMessageId:       event.uazapi_message_id,
        instanceId:              event.instance_id,
        messageText:             event.message_text       ?? null,
        messageType,
        providerTimestamp:       event.provider_timestamp ?? null,
        receivedAt:              event.timestamp          ?? null,
        payload:                 event.payload            ?? {},
      });
    } catch (enqueueError) {
      // Falha retentável — não retornar como sucesso (mascara falha).
      // Throw permite que process-conversation-event responda com 500.
      // NOTA: o webhook usa fire-and-forget; retry não é garantido automaticamente.
      //       A falha fica visível nos logs e no status HTTP para observabilidade.
      console.error('🤖 [ROUTER] ❌ Falha no enqueue — lançando para permitir retry:', {
        operation:       'enqueueMessage',
        company_id:      event.company_id,
        conversation_id: event.conversation_id,
        assignment_id:   assignment.id,
        agent_id:        assignment.agent_id,
        error_code:      enqueueError.code ?? 'UNKNOWN',
      });
      throw enqueueError;
    }

    if (enqueueResult.duplicate) {
      // Duplicata saudável: mensagem já está no buffer (idempotente).
      console.log('🤖 [ROUTER] ⏭️  Duplicata no buffer — skip silencioso:', {
        conversation_id: event.conversation_id,
        assignment_id:   assignment.id,
        batch_id:        enqueueResult.batchId,
      });
      return buildDecision(false, SKIP.ALREADY_PROCESSED, conversation, event);
    }

    console.log('🤖 [ROUTER] 📬 Mensagem enfileirada no buffer:', {
      conversation_id: event.conversation_id,
      assignment_id:   assignment.id,
      agent_id:        assignment.agent_id,
      batch_id:        enqueueResult.batchId,
      window_seconds:  groupingWindowSeconds,
    });

    return {
      should_process:        false,
      skip_reason:           SKIP.MESSAGE_BUFFERED,
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
        contact_phone:    conversation.contact_phone,
      },
      event,
      batch_id:         enqueueResult.batchId,
      batch_message_id: enqueueResult.batchMessageId,
      deadline_at:      enqueueResult.deadlineAt,
    };
  }

  // ── PASSO 7 (caminho não-agrupado): Finalizar APM e retornar ─────────────

  if (canUseMessageGrouping) {
    // INSERT diferido do PASSO 1 — grouping estava elegível mas desabilitado (window = 0).
    // Feito aqui com assignment_id já resolvido (uma operação em vez de INSERT + UPDATE).
    const { error: insertError } = await svc
      .from('agent_processed_messages')
      .insert({
        uazapi_message_id: event.uazapi_message_id,
        conversation_id:   event.conversation_id,
        company_id:        event.company_id,
        assignment_id:     assignment.id,
        result:            'processed',
      });

    if (insertError) {
      if (insertError.code === '23505') {
        console.log('🤖 [ROUTER] ⏭️  Deduplicado (fallback grouping-eligible):', event.uazapi_message_id);
        return buildDecision(false, SKIP.ALREADY_PROCESSED, conversation, event);
      }
      console.error('🤖 [ROUTER] ❌ Erro ao registrar APM (fallback grouping):', insertError.message);
      return buildDecision(false, SKIP.ERROR, conversation, event);
    }
  } else {
    // Caminho original: PASSO 1 fez INSERT → agora atualiza assignment_id.
    await updateProcessedResult(svc, event.company_id, event.uazapi_message_id, null, assignment.id);
  }

  console.log('🤖 [ROUTER] ✅ Roteado com sucesso:', {
    rule_id:         matchedRule.id,
    rule_priority:   matchedRule.priority,
    assignment_id:   assignment.id,
    agent_id:        assignment.agent_id,
    display_name:    assignment.display_name,
    conversation_id: event.conversation_id
  });

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

// ── Helpers de auditoria APM ──────────────────────────────────────────────────

/**
 * Registra um skip em agent_processed_messages.
 *
 * Caminho não-agrupado (!canUseMessageGrouping):
 *   PASSO 1 já fez INSERT — faz UPDATE do resultado via updateProcessedResult.
 *
 * Caminho agrupável (canUseMessageGrouping = true):
 *   Faz INSERT com o resultado final do skip.
 *   23505 = dedup paralelo, silenciado.
 *   Fire-and-forget: falhas de escrita não interrompem o Router.
 *
 * @param {object} svc
 * @param {object} event
 * @param {boolean} canUseMessageGrouping
 * @param {string} skipReason - Chave SKIP.*
 * @param {string|null} assignmentId
 */
async function skipWithAudit(svc, event, canUseMessageGrouping, skipReason, assignmentId) {
  if (!canUseMessageGrouping) {
    await updateProcessedResult(svc, event.company_id, event.uazapi_message_id, skipReason, assignmentId);
    return;
  }

  // canUseMessageGrouping = true: INSERT direto com resultado do skip.
  try {
    const dbResult = SKIP_TO_DB_RESULT[skipReason] ?? 'error';
    await svc.from('agent_processed_messages').insert({
      uazapi_message_id: event.uazapi_message_id,
      conversation_id:   event.conversation_id,
      company_id:        event.company_id,
      assignment_id:     assignmentId,
      result:            dbResult,
    });
    // { error: { code: '23505' } } = dedup paralelo — silenciado intencionalmente
  } catch (err) {
    console.error('🤖 [ROUTER] ⚠️  Falha ao registrar skip audit (grouping path):', err.message);
  }
}

/**
 * Registra uma mensagem processada (should_process = true) em agent_processed_messages.
 *
 * Análogo ao skipWithAudit mas para o caminho de sucesso (flow agent, etc.).
 * Não usado para o caminho de enqueue — a RPC já cria o registro APM.
 *
 * @param {object} svc
 * @param {object} event
 * @param {boolean} canUseMessageGrouping
 * @param {string|null} assignmentId
 */
async function auditProcessed(svc, event, canUseMessageGrouping, assignmentId) {
  if (!canUseMessageGrouping) {
    await updateProcessedResult(svc, event.company_id, event.uazapi_message_id, null, assignmentId);
    return;
  }

  try {
    await svc.from('agent_processed_messages').insert({
      uazapi_message_id: event.uazapi_message_id,
      conversation_id:   event.conversation_id,
      company_id:        event.company_id,
      assignment_id:     assignmentId,
      result:            'processed',
    });
  } catch (err) {
    console.error('🤖 [ROUTER] ⚠️  Falha ao registrar audit processado (grouping path):', err.message);
  }
}

// ── Helpers de agrupamento ────────────────────────────────────────────────────

/**
 * Resolve a janela de agrupamento do agente.
 *
 * Busca lovoo_agents com filtros multi-tenant (company_id + id).
 * Retorna 0 se: agente não encontrado, inativo, ou janela inválida.
 *
 * @param {object} svc
 * @param {string} companyId
 * @param {string} agentId
 * @returns {Promise<number>} Janela em segundos (0 = desabilitado)
 */
async function resolveGroupingWindow(svc, companyId, agentId) {
  if (!companyId || !agentId) return 0;

  const { data: agent, error } = await svc
    .from('lovoo_agents')
    .select('is_active, model_config')
    .eq('id', agentId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error || !agent) {
    console.warn('🤖 [ROUTER] ⚠️  Agente não encontrado para resolução de grouping:', {
      agent_id:   agentId,
      company_id: companyId,
    });
    return 0;
  }

  if (!agent.is_active) return 0;

  return readGroupingWindow(agent.model_config);
}

/**
 * Lê e valida model_config.message_grouping_window_s.
 *
 * Regras backend (não delegadas ao frontend):
 *   Deve ser inteiro >= 1 e <= 120.
 *   Ausente, null ou 0 → 0 (desabilitado).
 *   Inválido → 0 + warning seguro (sem o valor, apenas o tipo).
 *
 * @param {object|null} modelConfig
 * @returns {number}
 */
function readGroupingWindow(modelConfig) {
  if (!modelConfig || typeof modelConfig !== 'object') return 0;

  const w = modelConfig.message_grouping_window_s;

  if (w === undefined || w === null || w === 0) return 0;

  if (!Number.isInteger(w) || w < 1 || w > GROUPING_MAX_WINDOW_SECONDS) {
    console.warn('🤖 [ROUTER] ⚠️  message_grouping_window_s inválido — agrupamento desabilitado:', {
      value_type: typeof w,
    });
    return 0;
  }

  return w;
}

/**
 * Determina o tipo de mensagem a partir do evento.
 * Prioridade: event.message_type → 'text' (se message_text) → 'unknown'.
 *
 * @param {object} event
 * @returns {string}
 */
function resolveMessageType(event) {
  if (event.message_type && typeof event.message_type === 'string') return event.message_type;
  if (event.message_text) return 'text';
  return 'unknown';
}

// ── Helpers do Router ─────────────────────────────────────────────────────────

/**
 * Encontra a primeira routing rule que corresponde ao evento.
 */
function findMatchingRule(rules, event) {
  for (const rule of rules) {
    if (rule.event_type !== null && rule.event_type !== event.event_type) continue;
    if (rule.source_type !== null && rule.source_type !== event.source_type) continue;
    if (rule.source_identifier !== null && rule.source_identifier !== event.source_identifier) continue;
    return rule;
  }
  return null;
}

/**
 * Atualiza o resultado de um registro em agent_processed_messages.
 * Usado somente pelo caminho !canUseMessageGrouping (PASSO 1 já fez INSERT).
 * Fire-and-forget: falhas são silenciosas.
 */
async function updateProcessedResult(svc, companyId, uazapi_message_id, skipReason, assignmentId) {
  try {
    const update = {};

    if (skipReason && SKIP_TO_DB_RESULT[skipReason]) {
      update.result = SKIP_TO_DB_RESULT[skipReason];
    }
    if (assignmentId !== undefined) {
      update.assignment_id = assignmentId;
    }

    if (Object.keys(update).length === 0) return;

    await svc
      .from('agent_processed_messages')
      .update(update)
      .eq('company_id', companyId)
      .eq('uazapi_message_id', uazapi_message_id)
      .is('instance_id', null);

  } catch (err) {
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
