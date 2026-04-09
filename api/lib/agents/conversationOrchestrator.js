// =============================================================================
// api/lib/agents/conversationOrchestrator.js
//
// ConversationOrchestrator — Etapa 5 MVP Agentes de Conversação
//
// RESPONSABILIDADE ÚNICA:
//   Garantir execução única e segura por conversa, antes do ContextBuilder.
//   Não monta contexto. Não executa LLM. Não envia mensagens.
//
// FLUXO:
//   1. Verificar e limpar stale lock (acquired_at > 5 min)
//   2. Adquirir lock atômico em agent_processing_locks
//   3. Revalidar ai_state diretamente do banco (não confiar no RouterDecision)
//   4. Encontrar ou criar agent_conversation_sessions
//   5. Montar e retornar OrchestratorContext
//
// GARANTIAS:
//   - Lock sempre liberado via `finally` (sucesso, abort ou exceção)
//   - Sessão fechada com status='abandoned' + end_reason em caso de erro
//   - company_id validado em toda operação (multi-tenant)
//   - Stale lock detectado e removido antes de tentar INSERT
//
// RETORNO:
//   { success: true, context: OrchestratorContext }   → ContextBuilder (Etapa 6)
//   { success: false, skip_reason: string }           → abort silencioso
//   { success: false, skip_reason: 'error', error }   → falha inesperada
//
// ACESSO AO BANCO:
//   Exclusivamente via service_role — agent_processing_locks tem RLS sem
//   policies (bloqueado para JWT); agent_conversation_sessions INSERT/UPDATE
//   também requer service_role.
//
// LOCK — ESTRATÉGIA MVP:
//   O lock é liberado após o execute-agent.js fazer o dispatch fire-and-forget
//   para run-context-builder. Isso significa que o lock protege o período de
//   decisão + dispatch, mas não o processamento completo do LLM.
//   Na Etapa 9 (WhatsAppGateway), o lock será transferido para ser liberado
//   apenas após o envio completo das mensagens ao WhatsApp.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { randomUUID }   from 'crypto';

// ── Constantes ────────────────────────────────────────────────────────────────

const STALE_LOCK_MINUTES = 5;

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

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Orquestra a execução do agente para um RouterDecision aprovado.
 *
 * Garante via try/catch/finally que:
 *   - O lock é sempre liberado (independente do caminho de saída)
 *   - A sessão é fechada corretamente em caso de erro
 *
 * @param {object} decision - RouterDecision do ConversationRouter (Etapa 4)
 * @returns {{ success: boolean, context?: OrchestratorContext, skip_reason?: string, error?: string }}
 */
export async function orchestrateExecution(decision) {
  const svc = getServiceSupabase();

  if (!svc) {
    console.error('🤖 [ORCH] ❌ service_role client indisponível — verifique SUPABASE_SERVICE_ROLE_KEY');
    return { success: false, skip_reason: 'error', error: 'service_role_unavailable' };
  }

  const runId         = randomUUID();
  const conversationId = decision.event.conversation_id;
  const companyId      = decision.event.company_id;

  let lockAcquired = false;
  let sessionId    = null;
  let isNewSession = false;

  try {
    // ── PASSO 1: Verificar e limpar stale lock ────────────────────────────────
    // Um lock é considerado stale quando foi adquirido há mais de STALE_LOCK_MINUTES
    // e provavelmente pertence a uma execução que falhou ou foi interrompida.
    // Limpamos antes de tentar INSERT para não bloquear indefinidamente.

    const staleThreshold = new Date(
      Date.now() - STALE_LOCK_MINUTES * 60 * 1000
    ).toISOString();

    const { data: staleLock } = await svc
      .from('agent_processing_locks')
      .select('conversation_id, acquired_at, locked_by_run_id')
      .eq('conversation_id', conversationId)
      .lt('acquired_at', staleThreshold)
      .maybeSingle();

    if (staleLock) {
      console.log('🤖 [ORCH] ⚠️  Stale lock detectado — removendo antes de tentar novo lock:', {
        conversation_id: conversationId,
        stale_since:     staleLock.acquired_at,
        stale_run_id:    staleLock.locked_by_run_id,
        threshold_min:   STALE_LOCK_MINUTES
      });

      // DELETE com filtro de tempo: seguro em race condition
      // (outro processo pode deletar simultaneamente — sem problema)
      await svc
        .from('agent_processing_locks')
        .delete()
        .eq('conversation_id', conversationId)
        .lt('acquired_at', staleThreshold);
    }

    // ── PASSO 2: Adquirir lock atômico ────────────────────────────────────────
    // INSERT com conversation_id como PK. Se já existir → conflito 23505.
    // Conflito = outra execução ativa → abortar silenciosamente.
    // lockAcquired = false enquanto não confirmamos o INSERT.

    const { error: lockError } = await svc
      .from('agent_processing_locks')
      .insert({
        conversation_id: conversationId,
        locked_by_run_id: runId
        // acquired_at tem DEFAULT now() no banco
      });

    if (lockError) {
      if (lockError.code === '23505') {
        // Lock pertence a outra execução ativa — skip silencioso correto
        console.log('🤖 [ORCH] ⏭️  Lock ocupado — conversa já está sendo processada:', {
          conversation_id: conversationId,
          run_id:          runId
        });
        // lockAcquired = false → finally não tenta deletar lock alheio
        return { success: false, skip_reason: 'skipped_lock_busy' };
      }

      // Erro de banco inesperado
      console.error('🤖 [ORCH] ❌ Erro inesperado ao adquirir lock:', lockError.message);
      return { success: false, skip_reason: 'error', error: lockError.message };
    }

    // Lock adquirido — finally garantirá a liberação a partir daqui
    lockAcquired = true;

    console.log('🤖 [ORCH] 🔒 Lock adquirido:', {
      conversation_id: conversationId,
      run_id:          runId
    });

    // ── PASSO 3: Revalidar ai_state diretamente do banco ──────────────────────
    // O RouterDecision contém o ai_state de T1 (momento do Router).
    // Um humano pode ter assumido a conversa entre T1 e agora.
    // NUNCA confiar no RouterDecision para esta verificação.

    const { data: freshConversation, error: convError } = await svc
      .from('chat_conversations')
      .select('id, ai_state, contact_phone')
      .eq('id', conversationId)
      .eq('company_id', companyId)  // garante multi-tenant
      .single();

    if (convError || !freshConversation) {
      console.error('🤖 [ORCH] ❌ Conversa não encontrada na revalidação:', {
        conversation_id: conversationId,
        company_id:      companyId,
        error:           convError?.message
      });
      // finally liberará o lock
      return { success: false, skip_reason: 'error', error: 'conversation_not_found' };
    }

    if (freshConversation.ai_state !== 'ai_active') {
      // Estado mudou entre Router e Orchestrator — skip silencioso e correto
      console.log('🤖 [ORCH] ⏭️  ai_state mudou desde o Router — abortando:', {
        conversation_id:  conversationId,
        ai_state_agora:   freshConversation.ai_state,
        ai_state_router:  decision.conversation?.ai_state
      });
      // finally liberará o lock
      return { success: false, skip_reason: 'ai_state_changed' };
    }

    // ── PASSO 4: Encontrar ou criar sessão de conversação ─────────────────────
    // Uma sessão representa um período contínuo de atividade do agente.
    // Se já existir sessão ativa para esta conversa + assignment → reutilizar.
    // Caso contrário → criar nova sessão.

    const sessionResult = await findOrCreateSession(svc, {
      companyId,
      conversationId,
      assignmentId: decision.assignment_id,
      ruleId:       decision.rule_id
    });

    sessionId    = sessionResult.sessionId;
    isNewSession = sessionResult.isNewSession;

    console.log('🤖 [ORCH] 📋 Sessão:', {
      session_id:   sessionId,
      is_new:       isNewSession,
      conversation_id: conversationId
    });

    // ── PASSO 5: Montar OrchestratorContext ───────────────────────────────────
    // Contém todos os dados necessários para o ContextBuilder (Etapa 6).
    // ai_state vem do banco (revalidado), não do RouterDecision.

    const context = {
      run_id:               runId,
      session_id:           sessionId,
      is_new_session:       isNewSession,

      // Do RouterDecision (já validados pelo Router)
      assignment_id:        decision.assignment_id,
      agent_id:             decision.agent_id,
      rule_id:              decision.rule_id,
      capabilities:         decision.capabilities,
      price_display_policy: decision.price_display_policy,

      // Estado da conversa revalidado do banco (fonte de verdade)
      conversation: {
        id:            freshConversation.id,
        contact_phone: freshConversation.contact_phone,
        ai_state:      freshConversation.ai_state  // confirmado 'ai_active'
      },

      // Evento original (passado integralmente desde o webhook)
      event: decision.event
    };

    console.log('🤖 [ORCH] ✅ OrchestratorContext montado:', {
      run_id:         runId,
      session_id:     sessionId,
      assignment_id:  decision.assignment_id,
      agent_id:       decision.agent_id,
      conversation_id: conversationId,
      ai_state:       freshConversation.ai_state
    });

    return { success: true, context };

  } catch (unexpectedError) {
    console.error('🤖 [ORCH] ❌ Exceção não capturada no Orchestrator:', {
      error:           unexpectedError.message,
      conversation_id: conversationId,
      run_id:          runId
    });

    // Fechar sessão se foi criada antes do erro
    if (sessionId) {
      try {
        await closeSession(svc, sessionId, 'abandoned', 'error');
      } catch (_) {
        // Silencioso — já estamos em tratamento de erro
      }
    }

    return {
      success:     false,
      skip_reason: 'error',
      error:       unexpectedError.message
    };

  } finally {
    // Liberar lock em TODOS os caminhos onde ele foi adquirido.
    // Quando 23505 (lock alheio), lockAcquired = false → não deleta lock alheio.
    if (lockAcquired) {
      await releaseLock(svc, conversationId);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Busca sessão ativa existente ou cria uma nova.
 * Incrementa messages_received na sessão encontrada.
 *
 * @returns {{ sessionId: string, isNewSession: boolean }}
 */
async function findOrCreateSession(svc, { companyId, conversationId, assignmentId, ruleId }) {
  // Buscar sessão ativa para esta conversa + assignment
  const { data: existing, error: selectError } = await svc
    .from('agent_conversation_sessions')
    .select('id, messages_received')
    .eq('conversation_id', conversationId)
    .eq('company_id', companyId)
    .eq('assignment_id', assignmentId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Erro ao buscar sessão: ${selectError.message}`);
  }

  if (existing) {
    // Reutilizar sessão — incrementar contador de mensagens recebidas
    // Lock garante que não há race condition neste read-modify-write
    const { error: updateError } = await svc
      .from('agent_conversation_sessions')
      .update({ messages_received: existing.messages_received + 1 })
      .eq('id', existing.id);

    if (updateError) {
      // Não é bloqueante — sessão ainda será usada
      console.error('🤖 [ORCH] ⚠️  Falha ao incrementar messages_received:', updateError.message);
    }

    return { sessionId: existing.id, isNewSession: false };
  }

  // Criar nova sessão
  const { data: newSession, error: insertError } = await svc
    .from('agent_conversation_sessions')
    .insert({
      company_id:        companyId,
      conversation_id:   conversationId,
      assignment_id:     assignmentId,
      rule_id:           ruleId ?? null,
      status:            'active',
      messages_received: 1  // esta é a primeira mensagem da sessão
    })
    .select('id')
    .single();

  if (insertError || !newSession) {
    throw new Error(`Erro ao criar sessão: ${insertError?.message ?? 'sem dados'}`);
  }

  return { sessionId: newSession.id, isNewSession: true };
}

/**
 * Fecha uma sessão com o status e motivo informados.
 * Usado em tratamento de erros para evitar sessões orphan.
 */
async function closeSession(svc, sessionId, status, endReason) {
  const { error } = await svc
    .from('agent_conversation_sessions')
    .update({
      status,
      ended_at:   new Date().toISOString(),
      end_reason: endReason
    })
    .eq('id', sessionId);

  if (error) {
    console.error('🤖 [ORCH] ⚠️  Falha ao fechar sessão:', { sessionId, status, endReason, error: error.message });
  }
}

/**
 * Libera o lock de processamento da conversa via DELETE.
 * Sempre chamado no bloco `finally` — nunca omitir.
 * Silencioso em caso de falha (lock expira por TTL de qualquer forma).
 */
async function releaseLock(svc, conversationId) {
  try {
    await svc
      .from('agent_processing_locks')
      .delete()
      .eq('conversation_id', conversationId);

    console.log('🤖 [ORCH] 🔓 Lock liberado:', { conversation_id: conversationId });
  } catch (err) {
    // Não relançar — a execução já terminou; o lock expirará por TTL (5 min)
    console.error('🤖 [ORCH] ⚠️  Falha ao liberar lock (expirará por TTL):', err.message);
  }
}
