// =============================================================================
// connectOrReuseMetaWhatsAppConnection
//
// Helper de persistência Meta WhatsApp Cloud API (backend only).
// Chama exclusivamente rpc_connect_or_reuse_meta_whatsapp_connection.
//
// Não autentica, não faz claim, não chama Graph e não cai na RPC antiga.
// JWT, RBAC, partner e feature flag permanecem nos endpoints.
// =============================================================================

import {
  DISPATCHER_RPC,
  HELPER_REQUIRED_PARAMS,
  resolveHelperPublicError,
  isValidUuid,
} from './contracts/embeddedSignupDispatcher.contract.js';

const NUMERIC_ID_RE = /^[0-9]+$/;
const CIPHERTEXT_RE = /^v[0-9]+:.+$/;
const SMALLINT_MAX = 32767;
const ALLOWED_PARAM_KEYS = new Set(HELPER_REQUIRED_PARAMS);

function throwMapped(sqlstate, message) {
  const mapped = resolveHelperPublicError(sqlstate, message);
  throw Object.assign(new Error(mapped.publicError), {
    http: mapped.http,
    publicError: mapped.publicError,
  });
}

function throwInternal(sqlstate) {
  throwMapped(sqlstate ?? null, null);
}

function isOptionalText(value) {
  return value === null || typeof value === 'string';
}

function assertParams(params) {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    throwInternal('22023');
  }

  const keys = Object.keys(params);
  if (keys.length !== HELPER_REQUIRED_PARAMS.length) {
    throwInternal('22023');
  }
  for (const key of keys) {
    if (!ALLOWED_PARAM_KEYS.has(key)) {
      throwInternal('22023');
    }
  }
  for (const key of HELPER_REQUIRED_PARAMS) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      throwInternal('22023');
    }
  }

  if (
    !isValidUuid(params.companyId) ||
    !isValidUuid(params.connectedBy) ||
    !isValidUuid(params.onboardingId)
  ) {
    throwInternal('22023');
  }

  if (typeof params.wabaId !== 'string' || !NUMERIC_ID_RE.test(params.wabaId)) {
    throwInternal('22023');
  }
  if (
    typeof params.phoneNumberId !== 'string' ||
    !NUMERIC_ID_RE.test(params.phoneNumberId)
  ) {
    throwInternal('22023');
  }

  if (
    !isOptionalText(params.phoneNumber) ||
    !isOptionalText(params.verifiedName) ||
    !isOptionalText(params.displayName)
  ) {
    throwInternal('22023');
  }

  if (
    typeof params.accessTokenEnc !== 'string' ||
    !CIPHERTEXT_RE.test(params.accessTokenEnc)
  ) {
    throwInternal('22023');
  }

  if (
    typeof params.encryptionVersion !== 'number' ||
    !Number.isInteger(params.encryptionVersion) ||
    params.encryptionVersion < 1 ||
    params.encryptionVersion > SMALLINT_MAX
  ) {
    throwInternal('22023');
  }
}

function isValidSuccessRow(row) {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) {
    return false;
  }
  return (
    isValidUuid(row.instance_id) &&
    typeof row.phone_number_id === 'string' &&
    typeof row.waba_id === 'string' &&
    typeof row.status === 'string' &&
    isOptionalText(row.phone_number) &&
    isOptionalText(row.verified_name)
  );
}

export async function connectOrReuseMetaWhatsAppConnection(svc, params) {
  if (!svc || typeof svc.rpc !== 'function') {
    throwInternal();
  }

  assertParams(params);

  let result;
  try {
    result = await svc.rpc(DISPATCHER_RPC, {
      p_company_id: params.companyId,
      p_connected_by: params.connectedBy,
      p_onboarding_id: params.onboardingId,
      p_waba_id: params.wabaId,
      p_phone_number_id: params.phoneNumberId,
      p_phone_number: params.phoneNumber,
      p_verified_name: params.verifiedName,
      p_display_name: params.displayName,
      p_access_token_enc: params.accessTokenEnc,
      p_encryption_version: params.encryptionVersion,
    });
  } catch {
    throwInternal();
  }

  if (!result || result.error) {
    const err = result && result.error;
    throwMapped(err && err.code, err && err.message);
  }

  const rows = result.data;
  if (!Array.isArray(rows) || rows.length !== 1 || !isValidSuccessRow(rows[0])) {
    throwInternal();
  }

  const row = rows[0];
  return {
    instance_id: row.instance_id,
    phone_number_id: row.phone_number_id,
    waba_id: row.waba_id,
    phone_number: row.phone_number,
    verified_name: row.verified_name,
    status: row.status,
  };
}
