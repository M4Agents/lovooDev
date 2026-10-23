/**
 * Contratos da futura integração Embedded Signup → RPC dispatcher.
 *
 * ESTE MÓDULO É DOCUMENTAÇÃO EXECUTÁVEL. Não implementa helper, crypto nem
 * troca de RPC. Os endpoints e selectionTokenCrypto.js permanecem no fluxo
 * atual até uma etapa futura autorizada.
 *
 * Fonte: MVP5.A5.5.1 + A5.5.2. Migration local (não aplicada):
 * supabase/migrations/20261023180000_create_rpc_connect_or_reuse_meta_whatsapp_connection.sql
 */

export const DISPATCHER_RPC = 'rpc_connect_or_reuse_meta_whatsapp_connection';
export const LEGACY_CREATE_RPC = 'rpc_create_meta_whatsapp_connection';

/** Prefixo ciphertext AES-GCM do token de continuação. Não confundir com payload.v. */
export const SELECTION_TOKEN_CRYPTO_PREFIX = 'v1:';

/** Payload JSON atual (selectionTokenCrypto.js). Sem oid. */
export const SELECTION_PAYLOAD_V1 = Object.freeze({
  version: 1,
  requiredFields: Object.freeze(['v', 'uid', 'cid', 'exp', 'opts', 'enc']),
  hasOid: false,
});

/**
 * Payload JSON proposto. oid é UUID do state claimado / sessão de onboarding.
 * oid NÃO pode vir de campo livre do frontend.
 */
export const SELECTION_PAYLOAD_V2 = Object.freeze({
  version: 2,
  requiredFields: Object.freeze(['v', 'uid', 'cid', 'oid', 'exp', 'opts', 'enc']),
  oidRequired: true,
  oidFormat: 'uuid',
  oidSource: 'authenticated_token_only',
  uidMustMatchJwt: true,
  cidMustPassValidateMetaCaller: true,
  integrity: 'aes-256-gcm',
  cryptoPrefixUnchanged: SELECTION_TOKEN_CRYPTO_PREFIX,
});

/**
 * Após o cutover (NÃO ativar nesta etapa): tokens v:1 não têm oid e não
 * podem chamar a nova RPC com segurança. Janela de incompatibilidade ≤ 10 min.
 */
export const V1_AFTER_CUTOVER = Object.freeze({
  activeInThisSlice: false,
  http: 400,
  publicError: 'invalid_continuation',
  restartEmbeddedSignup: true,
  incompatibilityWindowMinutes: 10,
  inventOid: false,
  acceptClientOid: false,
  fallbackToLegacyCreateRpc: false,
});

export const HELPER_NAME = 'connectOrReuseMetaWhatsAppConnection';

export const HELPER_REQUIRED_PARAMS = Object.freeze([
  'companyId',
  'connectedBy',
  'onboardingId',
  'wabaId',
  'phoneNumberId',
  'phoneNumber',
  'verifiedName',
  'displayName',
  'accessTokenEnc',
  'encryptionVersion',
]);

export const HELPER_FORBIDDEN = Object.freeze({
  graphApi: true,
  onboardingClaim: true,
  jwtAuthInsideHelper: true,
  clientChosenInstanceId: true,
  returnCiphertext: true,
  fallbackToLegacyCreateRpc: true,
});

/**
 * Mapeamento de erros da RPC. P0003 NÃO é mapeado de forma indiscriminada:
 * só vira authorization_stale quando a mensagem contém esse código.
 */
export const HELPER_ERROR_MAP = Object.freeze([
  Object.freeze({
    id: 'unique_phone_conflict',
    sqlstate: '23505',
    messageIncludes: null,
    http: 409,
    publicError: 'phone_number_already_connected',
  }),
  Object.freeze({
    id: 'authorization_stale',
    sqlstate: 'P0003',
    messageIncludes: 'authorization_stale',
    http: 409,
    publicError: 'authorization_stale',
  }),
  Object.freeze({
    id: 'onboarding_not_usable',
    sqlstate: 'P0002',
    messageIncludes: null,
    http: 500,
    publicError: 'internal_error',
    hideOnboardingDetails: true,
  }),
  Object.freeze({
    id: 'invalid_rpc_args',
    sqlstate: '22023',
    messageIncludes: null,
    http: 500,
    publicError: 'internal_error',
  }),
  Object.freeze({
    id: 'rpc_missing',
    sqlstate: '42883',
    messageIncludes: null,
    http: 500,
    publicError: 'internal_error',
  }),
  Object.freeze({
    id: 'other_sql',
    sqlstate: null,
    messageIncludes: null,
    http: 500,
    publicError: 'internal_error',
  }),
]);

/** Shape de sucesso atual de complete.js / resolve-waba.js (instance). */
export const SUCCESS_INSTANCE_SHAPE = Object.freeze([
  'id',
  'phone_number_id',
  'waba_id',
  'phone_number',
  'verified_name',
  'status',
]);

export const COMPLETE_CONTRACT = Object.freeze({
  onboardingIdSource: 'claimed_state',
  companyIdSource: 'claimed_row.company_id',
  connectedBySource: 'jwt.user_id',
  helperCalls: 1,
  legacyCreateRpcCallsAfterCutover: 0,
  preserveSuccessShape: true,
});

export const RESOLVE_WABA_CONTRACT = Object.freeze({
  oidSource: 'authenticated_token.oid',
  uidComparedToJwt: true,
  cidValidatedByGuard: true,
  optsFromAuthenticatedTokenOnly: true,
  onboardingIdSource: 'token.oid',
  helperCalls: 1,
  legacyCreateRpcCallsAfterCutover: 0,
  preserveSuccessShape: true,
});

export function resolveHelperPublicError(sqlstate, message) {
  const text = typeof message === 'string' ? message : '';
  const stale = HELPER_ERROR_MAP.find((row) => row.id === 'authorization_stale');
  if (
    sqlstate === stale.sqlstate &&
    text.includes(stale.messageIncludes)
  ) {
    return stale;
  }

  const exact = HELPER_ERROR_MAP.find(
    (row) => row.sqlstate === sqlstate && row.id !== 'authorization_stale' && row.id !== 'other_sql'
  );
  if (exact) return exact;

  return HELPER_ERROR_MAP.find((row) => row.id === 'other_sql');
}

export function isValidUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
