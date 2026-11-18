// =============================================================================
// outboundAudioChatStore.js — Persistência idempotente da mensagem de
// áudio outbound em meta_messages (B3.2-C.3-D.3-E.2-B.5)
//
// Cliente Supabase injetado. Sem Graph, S3, HTTP, getSupabaseAdmin,
// process.env, Date.now, upsert, UPDATE ou DELETE.
// INSERT simples; 23505 → SELECT por company_id + instance_id + wamid.
// provider_timestamp diferente não gera conflito.
// =============================================================================

import {
  buildOutboundAudioChatInsert,
  compareOutboundAudioChat,
  PERSIST_COMPARE,
} from './outboundAudioPersistenceContracts.js';
import { isUuid } from './outboundAudioOperation.js';

export const META_MESSAGES_TABLE = 'meta_messages';

const CHAT_COLUMNS = [
  'id',
  'company_id',
  'instance_id',
  'conversation_id',
  'meta_message_id',
  'direction',
  'message_type',
  'body',
  'media_asset_id',
  'provider_timestamp',
].join(', ');

const ERR_INVALID = 'invalid_input';
const ERR_INSERT = 'chat_insert_failed';
const ERR_CONFLICT = 'chat_conflict';
const ERR_INDETERMINATE = 'chat_indeterminate';

function failed(error) {
  return { ok: false, error };
}

function succeeded({ idempotent, chatMessageId }) {
  return { ok: true, idempotent, chatMessageId };
}

function isClient(supabase) {
  return supabase != null && typeof supabase.from === 'function';
}

function confirmPersistedRow(row, expected) {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) {
    return failed(ERR_INDETERMINATE);
  }
  if (!isUuid(row.id)) {
    return failed(ERR_INDETERMINATE);
  }
  const compared = compareOutboundAudioChat(row, expected);
  if (compared.result === PERSIST_COMPARE.MATCH) {
    return succeeded({ idempotent: false, chatMessageId: row.id });
  }
  if (compared.result === PERSIST_COMPARE.CONFLICT) {
    return failed(ERR_CONFLICT);
  }
  return failed(ERR_INDETERMINATE);
}

function confirmRecoveredRow(row, expected) {
  const confirmed = confirmPersistedRow(row, expected);
  if (confirmed.ok) {
    return succeeded({ idempotent: true, chatMessageId: confirmed.chatMessageId });
  }
  return confirmed;
}

async function recoverAfterUniqueViolation(supabase, expected) {
  let data;
  let error;
  try {
    const result = await supabase
      .from(META_MESSAGES_TABLE)
      .select(CHAT_COLUMNS)
      .eq('company_id', expected.company_id)
      .eq('instance_id', expected.instance_id)
      .eq('meta_message_id', expected.meta_message_id)
      .maybeSingle();
    data = result.data;
    error = result.error;
  } catch {
    return failed(ERR_INDETERMINATE);
  }

  if (error) {
    return failed(ERR_INDETERMINATE);
  }
  if (Array.isArray(data)) {
    if (data.length !== 1) return failed(ERR_INDETERMINATE);
    return confirmRecoveredRow(data[0], expected);
  }
  if (!data) {
    return failed(ERR_INDETERMINATE);
  }
  return confirmRecoveredRow(data, expected);
}

/**
 * Insere ou recupera a mensagem de áudio outbound no chat.
 * Não autoriza acesso. Não faz Graph, S3, tracking ou completed.
 * provider_timestamp deve vir do caller; este helper não inventa relógio.
 *
 * @param {{ supabase: { from: Function }, context: object }} params
 */
export async function persistOutboundAudioChat({ supabase, context } = {}) {
  const expected = buildOutboundAudioChatInsert(context);
  if (!expected.ok) {
    return failed(ERR_INVALID);
  }
  if (!isClient(supabase)) {
    return failed(ERR_INVALID);
  }

  let inserted;
  let insertError;
  try {
    const result = await supabase
      .from(META_MESSAGES_TABLE)
      .insert(expected.row)
      .select(CHAT_COLUMNS)
      .maybeSingle();
    inserted = result.data;
    insertError = result.error;
  } catch {
    return failed(ERR_INDETERMINATE);
  }

  if (insertError) {
    if (insertError.code === '23505') {
      return recoverAfterUniqueViolation(supabase, expected.row);
    }
    return failed(ERR_INSERT);
  }

  if (Array.isArray(inserted)) {
    if (inserted.length !== 1) return failed(ERR_INDETERMINATE);
    return confirmPersistedRow(inserted[0], expected.row);
  }
  return confirmPersistedRow(inserted, expected.row);
}
