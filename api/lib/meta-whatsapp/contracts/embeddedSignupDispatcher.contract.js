/**
 * Contratos executáveis do Embedded Signup Dispatcher após o cutover
 * MVP5.A5.5.5 (LovooDev).
 *
 * Estado real:
 * - Helper connectOrReuseMetaWhatsAppConnection implementado e usado por
 *   complete.js e resolve-waba.js.
 * - Persistência via rpc_connect_or_reuse_meta_whatsapp_connection.
 * - Token de continuação: envelope crypto prefixo v1:; payload JSON v:2 com oid.
 * - Tokens v:1 são recusados em resolve-waba (invalid_continuation).
 * - Cutover publicado no LovooDev. Produção LovooCRM ainda não recebeu este cutover.
 *
 * Migration:
 * - Arquivo local: supabase/migrations/20261023180000_create_rpc_connect_or_reuse_meta_whatsapp_connection.sql
 * - Histórico remoto do Supabase compartilhado: 20261023203247
 * - Não executar supabase db push a partir deste arquivo.
 *
 * Este módulo documenta constantes e helpers usados pelo helper de persistência.
 * Não implementa Graph, claim nem JWT. Não reativa a RPC antiga.
 */

export const DISPATCHER_RPC = 'rpc_connect_or_reuse_meta_whatsapp_connection';
export const LEGACY_CREATE_RPC = 'rpc_create_meta_whatsapp_connection';

/** Prefixo ciphertext AES-GCM do token de continuação. Não confundir com payload.v. */
export const SELECTION_TOKEN_CRYPTO_PREFIX = 'v1:';

/** Payload JSON legado (antes do cutover). Sem oid. Crypto prefix permanece v1:. */
export const SELECTION_PAYLOAD_V1 = Object.freeze({
  version: 1,
  requiredFields: Object.freeze(['v', 'uid', 'cid', 'exp', 'opts', 'enc']),
  hasOid: false,
});

/**
 * Payload JSON atual após cutover no LovooDev.
 * oid é UUID do state claimado / sessão de onboarding.
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
 * Após o cutover (ativo no LovooDev): tokens v:1 não têm oid e não
 * podem chamar a nova RPC com segurança. Janela de incompatibilidade ≤ 10 min.
 * Produção LovooCRM ainda não recebeu este cutover.
 */
export const V1_AFTER_CUTOVER = Object.freeze({
  activeInThisSlice: true,
  http: 400,
  publicError: 'invalid_continuation',
  restartEmbeddedSignup: true,
  incompatibilityWindowMinutes: 10,
  inventOid: false,
  acceptClientOid: false,
  fallbackToLegacyCreateRpc: false,
});

/**
 * Replay e OCC são quatro casos distintos. Não tratar 23505 como
 * “replay típico após sucesso”.
 *
 * A. Número conectado a outro tenant → unique 23505.
 * B. Replay de persistência após sucesso (mesmo tenant) → OCC P0003.
 * C. Retry de complete → claim já consumido, antes da RPC.
 * D. Retry de resolve-waba após persistência → mesmo OCC de B.
 */
export const REPLAY_SCENARIOS = Object.freeze({
  A: Object.freeze({
    id: 'A',
    name: 'phone_owned_by_other_tenant',
    sqlstate: '23505',
    http: 409,
    publicError: 'phone_number_already_connected',
  }),
  B: Object.freeze({
    id: 'B',
    name: 'persistence_replay_after_success',
    sqlstate: 'P0003',
    messageIncludes: 'authorization_stale',
    http: 409,
    publicError: 'authorization_stale',
  }),
  C: Object.freeze({
    id: 'C',
    name: 'complete_retry_claim_consumed',
    sqlstate: null,
    http: 400,
    publicError: 'invalid_or_expired_state',
  }),
  D: Object.freeze({
    id: 'D',
    name: 'resolve_waba_retry_after_persist',
    sqlstate: 'P0003',
    messageIncludes: 'authorization_stale',
    http: 409,
    publicError: 'authorization_stale',
  }),
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

export const COVERAGE = Object.freeze({
  integral: 'integral',
  partial: 'partial',
});

export const DISPATCHER_SCENARIO_IDS = Object.freeze([
  'C-T1',
  'C-T2',
  'C-T3',
  'C-T4',
  'H-T1',
  'H-T2',
  'H-T3',
  'H-T4',
  'K-T1',
  'K-T2',
  'K-T3',
  'K-T4',
  'K-T5',
  'K-T6',
  'K-T7',
  'R-T1',
  'R-T2',
  'R-T3',
  'R-T4',
  'R-T5',
  'R-T6',
  'R-T7',
]);

/**
 * Rastreabilidade dos 22 IDs originais. Não é prova funcional por si só:
 * a cobertura executável vive nos arquivos apontados.
 */
export const DISPATCHER_SCENARIO_COVERAGE = Object.freeze([
  Object.freeze({
    id: 'C-T1',
    required: 'uid divergente do JWT é rejeitado no endpoint, não no helper',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'R7: uid mismatch → 400 invalid_continuation',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'C-T2',
    required: 'cid do token passa por validateMetaCaller; company_id não vem do body',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'R8: RBAC negado → 403 / R14: company_id vem de payload.cid, nunca do body',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'C-T3',
    required: 'token v:1 após cutover → 400 invalid_continuation, sem inventar oid',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'cutover: token v1 ou sem oid → 400 invalid_continuation',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'C-T4',
    required:
      'RPC exige oid + company_id + user_id + used_at; replay pós-sucesso é OCC, não unique 23505',
    file: 'api/whatsapp/meta/onboarding/__tests__/complete.test.js',
    test: 'T-75b: helper authorization_stale → 409 authorization_stale',
    coverage: COVERAGE.partial,
    notes:
      'Redação antiga confundia replay OCC (P0003/authorization_stale) com conflito unique 23505. used_at é pré-condição da RPC; o replay típico após persistência é o caso B. Complementos: T-83 (caso C), R17b (caso D), helper P0003 + authorization_stale.',
  }),
  Object.freeze({
    id: 'H-T1',
    required: 'helper invoca somente a RPC dispatcher com os 10 params validados',
    file: 'api/lib/meta-whatsapp/__tests__/connectOrReuseMetaWhatsAppConnection.test.js',
    test: 'sucesso: envia os dez parâmetros e retorna o shape público',
    coverage: COVERAGE.integral,
    notes: 'Complemento de endpoint: complete.test.js T-72.',
  }),
  Object.freeze({
    id: 'H-T2',
    required: 'helper não chama Graph API, claim, JWT nem a RPC antiga',
    file: 'api/lib/meta-whatsapp/__tests__/connectOrReuseMetaWhatsAppConnection.test.js',
    test: 'nunca chama a RPC antiga / não chama Graph API, JWT ou claim',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'H-T3',
    required: 'helper não aceita instance_id do cliente e não retorna ciphertext',
    file: 'api/lib/meta-whatsapp/__tests__/connectOrReuseMetaWhatsAppConnection.test.js',
    test: 'rejeita instanceId e parâmetros extras sem chamar a RPC',
    coverage: COVERAGE.integral,
    notes: 'Complemento: sucesso: não devolve ciphertext nem identificadores internos extras.',
  }),
  Object.freeze({
    id: 'H-T4',
    required: 'RPC ausente (42883) → 500 internal_error controlado',
    file: 'api/lib/meta-whatsapp/__tests__/connectOrReuseMetaWhatsAppConnection.test.js',
    test: '42883 → 500 internal_error',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'K-T1',
    required: 'p_onboarding_id igual ao state efetivamente claimado',
    file: 'api/whatsapp/meta/onboarding/__tests__/complete.test.js',
    test: 'T-72: helper chama a RPC dispatcher com os 10 parâmetros',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'K-T2',
    required: 'company_id deriva da row claimada; connected_by deriva do JWT',
    file: 'api/whatsapp/meta/onboarding/__tests__/complete.test.js',
    test: 'T-41: companyId vem exclusivamente do claim, não do body / T-42 / T-72',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'K-T3',
    required: 'uma única chamada ao helper; zero chamadas à RPC antiga após cutover',
    file: 'api/whatsapp/meta/onboarding/__tests__/complete.test.js',
    test: 'T-72: helper chama a RPC dispatcher com os 10 parâmetros',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'K-T4',
    required: 'sucesso preserva o shape atual de instance',
    file: 'api/whatsapp/meta/onboarding/__tests__/complete.test.js',
    test: 'T-79: Sucesso: response body contém exatamente os campos da instância',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'K-T5',
    required: 'authorization_stale → HTTP 409',
    file: 'api/whatsapp/meta/onboarding/__tests__/complete.test.js',
    test: 'T-75b: helper authorization_stale → 409 authorization_stale',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'K-T6',
    required: 'conflito cross-tenant (23505) → HTTP 409 phone_number_already_connected',
    file: 'api/whatsapp/meta/onboarding/__tests__/complete.test.js',
    test: 'T-75: RPC error 23505 → 409 phone_number_already_connected',
    coverage: COVERAGE.integral,
    notes: 'Complemento: F2-T14.',
  }),
  Object.freeze({
    id: 'K-T7',
    required: 'RPC ausente → falha interna controlada',
    file: 'api/lib/meta-whatsapp/__tests__/connectOrReuseMetaWhatsAppConnection.test.js',
    test: '42883 → 500 internal_error',
    coverage: COVERAGE.partial,
    notes:
      'O erro 42883 é coberto no helper, não diretamente no complete.js. O endpoint só propaga o mapeamento do helper.',
  }),
  Object.freeze({
    id: 'R-T1',
    required: 'v:2 válido: oid do token vira p_onboarding_id do helper',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'R13: index válido → RPC recebe parâmetros corretos',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'R-T2',
    required: 'v:1 legado após cutover → invalid_continuation',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'cutover: token v1 ou sem oid → 400 invalid_continuation',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'R-T3',
    required: 'retry de resolve-waba após persistência → OCC authorization_stale',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'R17b: authorization_stale → 409 sem vazar SQL',
    coverage: COVERAGE.partial,
    notes:
      'Redação antiga confundia replay OCC com conflito 23505 (used_at / vínculo). R19 ainda simula 23505 e cobre o caso A (outro tenant), não o replay pós-sucesso. O retry típico após persistência é o caso D (R17b).',
  }),
  Object.freeze({
    id: 'R-T4',
    required: 'token adulterado: rejeitado pela integridade AES-GCM',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'R5: continuation_token adulterado → 400 invalid_continuation',
    coverage: COVERAGE.integral,
    notes: 'Complemento neste arquivo: token adulterado: rejeitado pela integridade AES-GCM.',
  }),
  Object.freeze({
    id: 'R-T5',
    required: 'token expirado: rejeitado',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'R6: continuation_token expirado → 400 invalid_continuation',
    coverage: COVERAGE.integral,
    notes: 'Complemento neste arquivo: token expirado: rejeitado.',
  }),
  Object.freeze({
    id: 'R-T6',
    required: 'erros da RPC mapeados pelo helper sem vazar SQL',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'R17 / R17b / R18 / R21',
    coverage: COVERAGE.integral,
    notes: null,
  }),
  Object.freeze({
    id: 'R-T7',
    required: 'sucesso preserva o shape atual',
    file: 'api/whatsapp/meta/onboarding/__tests__/resolve-waba.test.js',
    test: 'R16: sucesso → shape público idêntico ao de /complete',
    coverage: COVERAGE.integral,
    notes: null,
  }),
]);

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
