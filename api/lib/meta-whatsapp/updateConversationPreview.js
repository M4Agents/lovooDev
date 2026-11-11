// =============================================================================
// updateConversationPreview
//
// Atualiza last_message_preview e last_message_at em public.meta_conversations
// após persistência bem-sucedida de mensagem outbound Meta (MVP5.B1.3).
//
// Caminho A da auditoria: dois UPDATEs condicionais atômicos, sem SELECT prévio
// e sem .or() — PostgREST deste projeto não expressa OR de forma confiável em UPDATE.
//
// Tentativa 1: last_message_at IS NULL.
// Tentativa 2: last_message_at <= providerTimestamp (somente se a 1 devolver 0 linhas).
// Erro de banco na tentativa 1 NÃO cai na tentativa 2.
//
// Não cria cliente service_role. Não chama Graph. Não faz INSERT.
// Não altera unread_count, status, contact_name nem mídia.
// company_id vem exclusivamente do caller (auth.companyId do endpoint).
// =============================================================================

/**
 * @typedef {'applied'|'skipped'|'failed'} PreviewOutcome
 * @typedef {{ outcome: PreviewOutcome }} PreviewResult
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isValidTimestamp(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function failed(reason) {
  console.error('[meta/conversation-preview] outcome=failed reason=%s', reason);
  return { outcome: 'failed' };
}

/**
 * Executa um UPDATE condicional.
 * Distingue: 1+ linhas (applied), 0 linhas (empty), erro (failed).
 * `.select('id')` após o UPDATE — não é SELECT prévio.
 *
 * @returns {Promise<'applied'|'empty'|'failed'>}
 */
async function runConditionalUpdate({
  supabase,
  companyId,
  instanceId,
  conversationId,
  payload,
  mode,
  providerTimestamp,
}) {
  let query = supabase
    .from('meta_conversations')
    .update(payload)
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .eq('instance_id', instanceId);

  if (mode === 'null') {
    query = query.is('last_message_at', null);
  } else {
    query = query.lte('last_message_at', providerTimestamp);
  }

  const { data, error } = await query.select('id');

  if (error) {
    return 'failed';
  }

  if (Array.isArray(data) && data.length > 0) {
    return 'applied';
  }

  return 'empty';
}

/**
 * Atualiza a prévia da conversa Meta com proteção anti-regressão.
 *
 * @param {object} args
 * @param {object} args.supabase            Cliente já criado pelo endpoint (getSupabaseAdmin).
 * @param {string} args.companyId           auth.companyId validado.
 * @param {string} args.instanceId          instance.id validado.
 * @param {string} args.conversationId      conversation.id validado.
 * @param {string} args.providerTimestamp   ISO gravado em meta_messages.provider_timestamp.
 * @param {string} args.preview             Texto já normalizado (máx. 100 chars no caller).
 * @returns {Promise<PreviewResult>}
 */
export async function updateConversationPreview({
  supabase,
  companyId,
  instanceId,
  conversationId,
  providerTimestamp,
  preview,
} = {}) {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return failed('invalid_client');
    }
    if (!isNonEmptyString(companyId) || !isNonEmptyString(instanceId) || !isNonEmptyString(conversationId)) {
      return failed('invalid_ids');
    }
    if (!isValidTimestamp(providerTimestamp)) {
      return failed('invalid_timestamp');
    }
    if (!isNonEmptyString(preview)) {
      return failed('invalid_preview');
    }

    const payload = {
      last_message_preview: preview,
      last_message_at:      providerTimestamp,
    };

    const first = await runConditionalUpdate({
      supabase,
      companyId,
      instanceId,
      conversationId,
      payload,
      mode: 'null',
    });

    if (first === 'applied') {
      return { outcome: 'applied' };
    }
    if (first === 'failed') {
      console.error('[meta/conversation-preview] outcome=failed db_error=true');
      return { outcome: 'failed' };
    }

    const second = await runConditionalUpdate({
      supabase,
      companyId,
      instanceId,
      conversationId,
      payload,
      mode: 'lte',
      providerTimestamp,
    });

    if (second === 'applied') {
      return { outcome: 'applied' };
    }
    if (second === 'failed') {
      console.error('[meta/conversation-preview] outcome=failed db_error=true');
      return { outcome: 'failed' };
    }

    console.log('[meta/conversation-preview] outcome=skipped rows=0');
    return { outcome: 'skipped' };
  } catch {
    console.error('[meta/conversation-preview] outcome=failed unexpected=true');
    return { outcome: 'failed' };
  }
}
