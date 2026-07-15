// =============================================================================
// api/lib/agents/outboundReconciliation.js
//
// OutboundReconciliation — Verificação de mensagens já persistidas por runId
//
// RESPONSABILIDADE ÚNICA:
//   Consultar chat_messages para verificar se o pipeline agrupado já persistiu
//   (e possivelmente enviou) blocos de resposta para um determinado runId.
//   Permite ao adapter evitar re-execução do LLM e envio cego em retries.
//
// FLUXO DE USO:
//   Chamado em groupedAgentAdapter.js ANTES de executar o LLM, após adquirir
//   o lock de conversação. Permite 4 comportamentos:
//     - Nenhuma mensagem → executar LLM normalmente
//     - Todas confirmadas (sent) → sucesso reconciliado, sem LLM
//     - Alguma pendente ou falha conhecida → retry somente do outbound, sem LLM
//     - Estado desconhecido → não reenviar automaticamente; sinalizar investigação
//
// QUERY:
//   Filtra por: company_id + conversation_id + ai_run_id + is_ai_generated + direction
//   Todos os filtros são obrigatórios (multi-tenant + idempotência).
//   Ordena por ai_block_index ASC para preservar ordem.
//
// STATUS ESPERADOS em chat_messages:
//   'sent'    — enviado com confirmação pelo gateway
//   'failed'  — envio falhou (gateway atualizou via update_message_status)
//   'pending' — persistido mas não enviado / status não atualizado
//   outros    — estado desconhecido (→ hasUnknown = true)
//
// SEGURANÇA:
//   - `svc` deve ser cliente service_role (RLS bypassado)
//   - Logs não contêm conteúdo das mensagens
//   - company_id é sempre obrigatório (multi-tenant)
//
// JANELA RESIDUAL DOCUMENTADA:
//   Se a mensagem foi persistida E o envio foi iniciado mas o timeout ocorreu
//   antes da confirmação do provider, o status pode ser 'pending' mesmo que a
//   mensagem tenha chegado ao destinatário. Nesse caso, status = 'has_pending'
//   e o adapter deve indicar 'retry_outbound_only' sem re-executar o LLM.
//   Nunca assume que ausência de 'sent' significa que o lead não recebeu.
// =============================================================================


/**
 * Carrega mensagens outbound já persistidas para um runId específico.
 *
 * @param {object} params
 * @param {object} params.svc            - Cliente Supabase service_role
 * @param {string} params.companyId      - UUID da empresa (obrigatório)
 * @param {string} params.conversationId - UUID da conversa (obrigatório)
 * @param {string} params.runId          - ai_run_id (= executionId) a consultar (obrigatório)
 *
 * @returns {Promise<{
 *   hasExisting:  boolean,
 *   messages:     Array<{ id: string, ai_block_index: number|null, status: string|null }>,
 *   allConfirmed: boolean,  — todos com status = 'sent'
 *   hasPending:   boolean,  — algum com status = 'pending' ou null
 *   hasFailed:    boolean,  — algum com status = 'failed'
 *   hasUnknown:   boolean,  — algum com status fora de ['sent','failed','pending']
 *   status:       'none'|'all_confirmed'|'has_failed'|'has_pending'|'unknown'
 * }>}
 *
 * @throws {Error} Se os parâmetros obrigatórios estiverem ausentes
 * @throws {Error} Se a query ao banco falhar
 */
export async function loadExistingOutboundForRun({ svc, companyId, conversationId, runId }) {
  if (!svc) {
    throw new Error('loadExistingOutboundForRun: svc é obrigatório');
  }
  if (!companyId) {
    throw new Error('loadExistingOutboundForRun: companyId é obrigatório');
  }
  if (!conversationId) {
    throw new Error('loadExistingOutboundForRun: conversationId é obrigatório');
  }
  if (!runId) {
    throw new Error('loadExistingOutboundForRun: runId é obrigatório');
  }

  const { data, error } = await svc
    .from('chat_messages')
    .select('id, ai_block_index, status')
    .eq('company_id',      companyId)
    .eq('conversation_id', conversationId)
    .eq('ai_run_id',       runId)
    .eq('is_ai_generated', true)
    .eq('direction',       'outbound')
    .order('ai_block_index', { ascending: true });

  if (error) {
    throw new Error(`loadExistingOutboundForRun: falha ao consultar chat_messages: ${error.message}`);
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return {
      hasExisting:  false,
      messages:     [],
      allConfirmed: false,
      hasPending:   false,
      hasFailed:    false,
      hasUnknown:   false,
      status:       'none',
    };
  }

  const knownStatuses = new Set(['sent', 'failed', 'pending']);

  const allConfirmed = rows.every((m) => m.status === 'sent');
  const hasFailed    = rows.some((m) => m.status === 'failed');
  const hasPending   = rows.some((m) => m.status === 'pending' || m.status == null);
  const hasUnknown   = rows.some((m) => m.status != null && !knownStatuses.has(m.status));

  let status;
  if (allConfirmed)   status = 'all_confirmed';
  else if (hasFailed) status = 'has_failed';
  else if (hasPending)status = 'has_pending';
  else                status = 'unknown';

  console.log('🤖 [RECONCILE] 🔍 loadExistingOutboundForRun:', {
    company_id:      companyId,
    conversation_id: conversationId,
    run_id:          runId,
    message_count:   rows.length,
    status,
    all_confirmed:   allConfirmed,
    has_failed:      hasFailed,
    has_pending:     hasPending,
    has_unknown:     hasUnknown,
  });

  return {
    hasExisting:  true,
    messages:     rows,
    allConfirmed,
    hasFailed,
    hasPending,
    hasUnknown,
    status,
  };
}
