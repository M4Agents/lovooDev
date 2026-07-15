// =============================================================================
// api/lib/agents/conversationLock.js
//
// ConversationLock — Helper compartilhado de lock por conversa
//
// RESPONSABILIDADE ÚNICA:
//   Adquirir e liberar o lock de processamento de conversa em
//   `agent_processing_locks`, garantindo que no máximo uma execução
//   de agente ocorra por company_id + conversation_id a qualquer momento.
//
// ATOMICIDADE:
//   Toda a lógica de lock reside em RPCs PL/pgSQL no banco.
//   Este helper apenas valida parâmetros, chama as RPCs e normaliza o retorno.
//   Não usa .from('agent_processing_locks') em hipótese alguma.
//
// RPCs utilizadas:
//   - public.agent_conversation_lock_acquire_v1(company_id, conversation_id, run_id, stale_after_seconds)
//   - public.agent_conversation_lock_release_v1(company_id, conversation_id, run_id)
//
// TABELA subjacente (agent_processing_locks):
//   PK composta: (company_id, conversation_id)
//   Colunas: company_id (UUID FK→companies), conversation_id (UUID FK→chat_conversations),
//            locked_by_run_id (UUID), acquired_at (TIMESTAMPTZ DEFAULT now())
//
// COMPORTAMENTO DA AQUISIÇÃO (implementado na RPC):
//   - Caso 1 — Lock inexistente       → INSERT → { acquired: true, reason: 'acquired' }
//   - Caso 2 — Mesmo runId            → idempotente, preserved acquired_at
//                                     → { acquired: true, reason: 'already_owned' }
//   - Caso 3 — Lock stale de outro    → UPDATE atômico (SELECT FOR UPDATE)
//                                     → { acquired: true, reason: 'stale_replaced' }
//   - Caso 4 — Lock ativo de outro    → { acquired: false, reason: 'lock_busy' }
//
// CALLERS:
//   - conversationOrchestrator.js (fluxo de mensagem individual)
//   - groupedAgentAdapter.js     (fluxo de lote agrupado — Etapa 13)
//
// SEGURANÇA:
//   - `svc` deve ser cliente service_role
//   - As RPCs são SECURITY DEFINER — acesso direto à tabela bloqueado para JWT
//   - locked_by_run_id não é logado externamente
//
// RETORNO de acquireConversationLock:
//   { acquired: true }                       — lock adquirido (novo ou stale substituído)
//   { acquired: true, reason: 'already_owned' } — re-aquisição idempotente (mesmo runId)
//   { acquired: false, reason: 'lock_busy' } — outro worker ativo
//
// RETORNO de releaseConversationLock:
//   { released: true }                       — lock removido com sucesso
//   { released: false, reason: string }      — lock não encontrado (não é erro crítico)
//
// ERROS:
//   acquireConversationLock lança em: parâmetro inválido, violação multi-tenant,
//   ou erro de banco inesperado.
//   releaseConversationLock nunca lança — silencioso em falha.
// =============================================================================

const DEFAULT_STALE_SECONDS = 5 * 60; // 300s = 5 min

// ── acquireConversationLock ────────────────────────────────────────────────────

/**
 * Adquire o lock de processamento para uma conversa, de forma atômica.
 *
 * Delega toda a lógica à RPC `agent_conversation_lock_acquire_v1`, que executa
 * dentro de uma única transação PostgreSQL via INSERT otimista + SELECT FOR UPDATE.
 *
 * @param {object} svc - Cliente Supabase service_role
 * @param {object} params
 * @param {string} params.companyId      - UUID da empresa (obrigatório — multi-tenant)
 * @param {string} params.conversationId - UUID da conversa (chave do lock)
 * @param {string} params.runId          - UUID da execução atual (locked_by_run_id)
 * @param {number} [params.staleMinutes] - Minutos para considerar lock stale (padrão 5)
 * @returns {Promise<{ acquired: true } | { acquired: true, reason: 'already_owned' } | { acquired: false, reason: 'lock_busy' }>}
 * @throws {Error} Em parâmetro inválido, violação multi-tenant ou erro de banco inesperado
 */
export async function acquireConversationLock(svc, {
  companyId,
  conversationId,
  runId,
  staleMinutes = DEFAULT_STALE_SECONDS / 60,
}) {
  if (!companyId)      throw new Error('acquireConversationLock: companyId é obrigatório');
  if (!conversationId) throw new Error('acquireConversationLock: conversationId é obrigatório');
  if (!runId)          throw new Error('acquireConversationLock: runId é obrigatório');

  const staleAfterSeconds = Math.round(staleMinutes * 60);

  const { data, error } = await svc.rpc('agent_conversation_lock_acquire_v1', {
    p_company_id:          companyId,
    p_conversation_id:     conversationId,
    p_run_id:              runId,
    p_stale_after_seconds: staleAfterSeconds,
  });

  if (error) {
    const msg = error.message ?? '';

    if (msg.includes('TENANT_VIOLATION')) {
      throw new Error(`acquireConversationLock: violação multi-tenant — conversa não pertence à empresa`);
    }
    if (msg.includes('INVALID_PARAM')) {
      throw new Error(`acquireConversationLock: parâmetro inválido — ${msg}`);
    }

    throw new Error(`acquireConversationLock: erro de banco inesperado: ${msg}`);
  }

  // Normalizar retorno da RPC
  const reason = data?.reason;

  if (data?.acquired === true) {
    if (reason === 'already_owned') {
      console.log('🤖 [LOCK] 🔒 Lock já pertence a este runId — re-aquisição idempotente:', {
        conversation_id: conversationId,
      });
      return { acquired: true, reason: 'already_owned' };
    }

    if (reason === 'stale_replaced') {
      console.log('🤖 [LOCK] 🔒 Stale lock substituído atomicamente:', {
        conversation_id: conversationId,
      });
      return { acquired: true };
    }

    console.log('🤖 [LOCK] 🔒 Lock adquirido:', { conversation_id: conversationId });
    return { acquired: true };
  }

  console.log('🤖 [LOCK] ⏭️  Lock ocupado — conversa já está sendo processada:', {
    conversation_id: conversationId,
  });
  return { acquired: false, reason: 'lock_busy' };
}


// ── releaseConversationLock ───────────────────────────────────────────────────

/**
 * Libera o lock de processamento de uma conversa, de forma atômica.
 *
 * Delega à RPC `agent_conversation_lock_release_v1`, que filtra por
 * company_id + conversation_id + locked_by_run_id (prova de posse).
 * Um worker não pode liberar o lock adquirido por outro worker.
 *
 * Sempre chamado no bloco `finally` do caller — nunca omitir.
 *
 * @param {object} svc - Cliente Supabase service_role
 * @param {object} params
 * @param {string} params.companyId      - UUID da empresa (multi-tenant)
 * @param {string} params.conversationId - UUID da conversa
 * @param {string} params.runId          - UUID da execução que adquiriu o lock
 * @returns {Promise<{ released: boolean, reason?: string }>}
 */
export async function releaseConversationLock(svc, { companyId, conversationId, runId }) {
  try {
    const { data, error } = await svc.rpc('agent_conversation_lock_release_v1', {
      p_company_id:      companyId,
      p_conversation_id: conversationId,
      p_run_id:          runId,
    });

    if (error) {
      console.error('🤖 [LOCK] ⚠️  Falha ao liberar lock (não crítico — expirará por TTL):', {
        conversation_id: conversationId,
        error:           error.message,
      });
      return { released: false, reason: `db_error: ${error.message}` };
    }

    if (data?.released === true) {
      console.log('🤖 [LOCK] 🔓 Lock liberado:', { conversation_id: conversationId });
      return { released: true };
    }

    // Lock não encontrado: expirou, foi limpo por recovery, ou runId divergente.
    // Não é erro crítico — pode ocorrer em retry de liberação ou lock substituído.
    console.log('🤖 [LOCK] ℹ️  Lock não encontrado na liberação (pode ter expirado):', {
      conversation_id: conversationId,
    });
    return { released: false, reason: 'not_found' };

  } catch (err) {
    // Não relançar — a execução já terminou; o lock expirará por stale timeout
    console.error('🤖 [LOCK] ⚠️  Exceção ao liberar lock (não crítico — expirará por TTL):', {
      conversation_id: conversationId,
      error:           err.message,
    });
    return { released: false, reason: `exception: ${err.message}` };
  }
}
