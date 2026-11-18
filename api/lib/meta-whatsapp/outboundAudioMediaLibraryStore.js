// =============================================================================
// outboundAudioMediaLibraryStore.js — Persistência idempotente de áudio
// outbound em company_media_library (B3.2-C.3-D.3-E.2-B.4)
//
// Cliente Supabase injetado. Sem Graph, S3, HTTP, getSupabaseAdmin,
// process.env, upsert, UPDATE ou DELETE.
// INSERT simples; 23505 → SELECT por company_id + source_ref + comparação pura.
// =============================================================================

import {
  buildOutboundAudioMediaLibraryInsert,
  compareOutboundAudioMediaLibrary,
  PERSIST_COMPARE,
} from './outboundAudioPersistenceContracts.js';
import { isUuid } from './outboundAudioOperation.js';

export const COMPANY_MEDIA_LIBRARY_TABLE = 'company_media_library';

const CML_COLUMNS = [
  'id',
  'company_id',
  'source_ref',
  's3_key',
  'file_type',
  'mime_type',
  'file_size',
].join(', ');

const ERR_INVALID = 'invalid_input';
const ERR_INSERT = 'media_library_insert_failed';
const ERR_CONFLICT = 'media_library_conflict';
const ERR_INDETERMINATE = 'media_library_indeterminate';

function failed(error) {
  return { ok: false, error };
}

function succeeded({ idempotent, mediaAssetId }) {
  return { ok: true, idempotent, mediaAssetId };
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
  const compared = compareOutboundAudioMediaLibrary(row, expected);
  if (compared.result === PERSIST_COMPARE.MATCH) {
    return succeeded({ idempotent: false, mediaAssetId: row.id });
  }
  if (compared.result === PERSIST_COMPARE.CONFLICT) {
    return failed(ERR_CONFLICT);
  }
  return failed(ERR_INDETERMINATE);
}

function confirmRecoveredRow(row, expected) {
  const confirmed = confirmPersistedRow(row, expected);
  if (confirmed.ok) {
    return succeeded({ idempotent: true, mediaAssetId: confirmed.mediaAssetId });
  }
  return confirmed;
}

async function recoverAfterUniqueViolation(supabase, expected) {
  let data;
  let error;
  try {
    const result = await supabase
      .from(COMPANY_MEDIA_LIBRARY_TABLE)
      .select(CML_COLUMNS)
      .eq('company_id', expected.company_id)
      .eq('source_ref', expected.source_ref)
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
 * Insere ou recupera o asset de áudio outbound na biblioteca da empresa.
 * Não autoriza acesso. Não faz Graph, S3, tracking, chat ou completed.
 *
 * @param {{ supabase: { from: Function }, context: object }} params
 */
export async function persistOutboundAudioMediaLibrary({ supabase, context } = {}) {
  const expected = buildOutboundAudioMediaLibraryInsert(context);
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
      .from(COMPANY_MEDIA_LIBRARY_TABLE)
      .insert(expected.row)
      .select(CML_COLUMNS)
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
