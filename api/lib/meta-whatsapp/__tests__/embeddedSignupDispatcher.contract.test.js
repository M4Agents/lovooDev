/**
 * Contratos executáveis do Embedded Signup Dispatcher após o cutover
 * MVP5.A5.5.5 (LovooDev).
 *
 * it() = invariantes do contrato e rastreabilidade de cobertura.
 * Os 22 IDs C-T, H-T, K-T e R-T não são reexecutados aqui: a cobertura
 * funcional vive nos testes de helper, complete, resolve-waba e crypto.
 * Este arquivo valida o contrato e a integridade do inventário.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptSelectionPayload,
  decryptSelectionPayload,
} from '../selectionTokenCrypto.js';
import {
  DISPATCHER_RPC,
  LEGACY_CREATE_RPC,
  SELECTION_TOKEN_CRYPTO_PREFIX,
  SELECTION_PAYLOAD_V1,
  SELECTION_PAYLOAD_V2,
  V1_AFTER_CUTOVER,
  REPLAY_SCENARIOS,
  HELPER_NAME,
  HELPER_REQUIRED_PARAMS,
  HELPER_FORBIDDEN,
  HELPER_ERROR_MAP,
  SUCCESS_INSTANCE_SHAPE,
  COMPLETE_CONTRACT,
  RESOLVE_WABA_CONTRACT,
  COVERAGE,
  DISPATCHER_SCENARIO_IDS,
  DISPATCHER_SCENARIO_COVERAGE,
  resolveHelperPublicError,
  isValidUuid,
} from '../contracts/embeddedSignupDispatcher.contract.js';

const VALID_OID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CONTRACT_KEY = 'c'.repeat(64);

function v1Payload(overrides = {}) {
  return {
    v: 1,
    uid: 'aaaa0000-0000-4000-8000-000000000001',
    cid: 'bbbb0000-0000-4000-8000-000000000002',
    exp: Date.now() + 10 * 60 * 1000,
    opts: [{ w: '123456789', p: '987654321', d: '+55 11 90000-0000', n: 'Empresa Contrato' }],
    enc: 'v1:FAKECIPHERTEXT==',
    ...overrides,
  };
}

let savedSelectionKey;

beforeEach(() => {
  savedSelectionKey = process.env.META_SELECTION_ENC_KEY_V1;
  process.env.META_SELECTION_ENC_KEY_V1 = CONTRACT_KEY;
});

afterEach(() => {
  if (savedSelectionKey === undefined) {
    delete process.env.META_SELECTION_ENC_KEY_V1;
  } else {
    process.env.META_SELECTION_ENC_KEY_V1 = savedSelectionKey;
  }
});

describe('contrato: token de continuação v:2', () => {
  it('não confunde payload.v com o prefixo criptográfico v1:', () => {
    expect(SELECTION_TOKEN_CRYPTO_PREFIX).toBe('v1:');
    expect(SELECTION_PAYLOAD_V2.version).toBe(2);
    expect(SELECTION_PAYLOAD_V2.cryptoPrefixUnchanged).toBe('v1:');
  });

  it('v:2 exige oid UUID autenticado; v:1 legado não possui oid', () => {
    expect(SELECTION_PAYLOAD_V1.hasOid).toBe(false);
    expect(SELECTION_PAYLOAD_V2.oidRequired).toBe(true);
    expect(SELECTION_PAYLOAD_V2.oidFormat).toBe('uuid');
    expect(SELECTION_PAYLOAD_V2.oidSource).toBe('authenticated_token_only');
    expect(SELECTION_PAYLOAD_V2.requiredFields).toContain('oid');
    expect(SELECTION_PAYLOAD_V1.requiredFields).not.toContain('oid');
    expect(isValidUuid(VALID_OID)).toBe(true);
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
  });

  it('v:1 e v:2 usam prefixo v1:; decrypt aceita ambos', () => {
    const token = encryptSelectionPayload(v1Payload());
    expect(token.startsWith(SELECTION_TOKEN_CRYPTO_PREFIX)).toBe(true);
    expect(decryptSelectionPayload(token).v).toBe(1);

    const v2 = encryptSelectionPayload(v1Payload({ v: 2, oid: VALID_OID }));
    expect(v2.startsWith(SELECTION_TOKEN_CRYPTO_PREFIX)).toBe(true);
    const decoded = decryptSelectionPayload(v2);
    expect(decoded.v).toBe(2);
    expect(decoded.oid).toBe(VALID_OID);
  });

  it('v:2 válido: decrypt aceita oid UUID e preserva uid/cid/opts/enc/exp', () => {
    const original = v1Payload({ v: 2, oid: VALID_OID });
    const decoded = decryptSelectionPayload(encryptSelectionPayload(original));
    expect(decoded.v).toBe(2);
    expect(decoded.oid).toBe(VALID_OID);
    expect(decoded.uid).toBe(original.uid);
    expect(decoded.cid).toBe(original.cid);
    expect(decoded.exp).toBe(original.exp);
    expect(decoded.opts).toEqual(original.opts);
    expect(decoded.enc).toBe(original.enc);
  });

  it('v:2 sem oid: rejeitado', () => {
    const p = v1Payload({ v: 2 });
    expect(() => decryptSelectionPayload(encryptSelectionPayload(p))).toThrow();
  });

  it('v:2 com oid inválido: rejeitado', () => {
    expect(() => decryptSelectionPayload(encryptSelectionPayload(
      v1Payload({ v: 2, oid: 'not-a-uuid' }),
    ))).toThrow();
  });

  it('token adulterado: rejeitado pela integridade AES-GCM', () => {
    const token = encryptSelectionPayload(v1Payload({ v: 2, oid: VALID_OID }));
    const b64 = token.slice(SELECTION_TOKEN_CRYPTO_PREFIX.length);
    const flipped = (b64[4] === 'A' ? 'B' : 'A') + b64.slice(5);
    expect(() => decryptSelectionPayload(
      SELECTION_TOKEN_CRYPTO_PREFIX + b64.slice(0, 4) + flipped,
    )).toThrow();
  });

  it('token expirado: rejeitado', () => {
    expect(() => decryptSelectionPayload(encryptSelectionPayload(
      v1Payload({ v: 2, oid: VALID_OID, exp: Date.now() - 1 }),
    ))).toThrow();
  });
});

describe('contrato: helper de persistência', () => {
  it('declara RPC dispatcher, params obrigatórios e proibições', () => {
    expect(HELPER_NAME).toBe('connectOrReuseMetaWhatsAppConnection');
    expect(DISPATCHER_RPC).toBe('rpc_connect_or_reuse_meta_whatsapp_connection');
    expect(LEGACY_CREATE_RPC).toBe('rpc_create_meta_whatsapp_connection');
    expect(HELPER_REQUIRED_PARAMS).toEqual([
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
    expect(HELPER_FORBIDDEN).toEqual({
      graphApi: true,
      onboardingClaim: true,
      jwtAuthInsideHelper: true,
      clientChosenInstanceId: true,
      returnCiphertext: true,
      fallbackToLegacyCreateRpc: true,
    });
  });

  it('mapeia 23505 e P0003+authorization_stale; demais P0003 ficam internos', () => {
    expect(resolveHelperPublicError('23505', 'duplicate key').publicError).toBe(
      'phone_number_already_connected'
    );
    expect(resolveHelperPublicError('23505', 'duplicate key').http).toBe(409);

    const stale = resolveHelperPublicError('P0003', 'authorization_stale');
    expect(stale.publicError).toBe('authorization_stale');
    expect(stale.http).toBe(409);

    const otherP0003 = resolveHelperPublicError('P0003', 'some_other_raise');
    expect(otherP0003.publicError).toBe('internal_error');
    expect(otherP0003.http).toBe(500);

    expect(resolveHelperPublicError('P0002', 'no row').publicError).toBe('internal_error');
    expect(resolveHelperPublicError('22023', 'bad arg').publicError).toBe('internal_error');
    expect(resolveHelperPublicError('42883', 'function does not exist').publicError).toBe(
      'internal_error'
    );
    expect(resolveHelperPublicError('XX000', 'boom').publicError).toBe('internal_error');
  });

  it('não mapeia P0003 indiscriminadamente e não vaza SQLSTATE no publicError', () => {
    const p0003Rows = HELPER_ERROR_MAP.filter((row) => row.sqlstate === 'P0003');
    expect(p0003Rows).toHaveLength(1);
    expect(p0003Rows[0].messageIncludes).toBe('authorization_stale');

    for (const row of HELPER_ERROR_MAP) {
      expect(row.publicError).not.toMatch(/P000|23505|22023|42883|sqlstate/i);
    }
  });
});

describe('contrato: complete.js', () => {
  it('p_onboarding_id vem do state claimado; company/user não vêm do cliente', () => {
    expect(COMPLETE_CONTRACT.onboardingIdSource).toBe('claimed_state');
    expect(COMPLETE_CONTRACT.companyIdSource).toBe('claimed_row.company_id');
    expect(COMPLETE_CONTRACT.connectedBySource).toBe('jwt.user_id');
    expect(COMPLETE_CONTRACT.helperCalls).toBe(1);
    expect(COMPLETE_CONTRACT.legacyCreateRpcCallsAfterCutover).toBe(0);
    expect(COMPLETE_CONTRACT.preserveSuccessShape).toBe(true);
    expect(SUCCESS_INSTANCE_SHAPE).toEqual([
      'id',
      'phone_number_id',
      'waba_id',
      'phone_number',
      'verified_name',
      'status',
    ]);
  });
});

describe('contrato: resolve-waba.js', () => {
  it('oid só do token autenticado; cid/uid/opts não são livres', () => {
    expect(RESOLVE_WABA_CONTRACT.oidSource).toBe('authenticated_token.oid');
    expect(RESOLVE_WABA_CONTRACT.onboardingIdSource).toBe('token.oid');
    expect(RESOLVE_WABA_CONTRACT.uidComparedToJwt).toBe(true);
    expect(RESOLVE_WABA_CONTRACT.cidValidatedByGuard).toBe(true);
    expect(RESOLVE_WABA_CONTRACT.optsFromAuthenticatedTokenOnly).toBe(true);
    expect(RESOLVE_WABA_CONTRACT.helperCalls).toBe(1);
    expect(RESOLVE_WABA_CONTRACT.legacyCreateRpcCallsAfterCutover).toBe(0);
    expect(RESOLVE_WABA_CONTRACT.preserveSuccessShape).toBe(true);
  });
});

describe('contrato: compatibilidade v:1 após cutover', () => {
  it('cutover v:1 está ativo: token legado é invalid_continuation sem inventar oid', () => {
    expect(V1_AFTER_CUTOVER.activeInThisSlice).toBe(true);
    expect(V1_AFTER_CUTOVER.publicError).toBe('invalid_continuation');
    expect(V1_AFTER_CUTOVER.http).toBe(400);
    expect(V1_AFTER_CUTOVER.restartEmbeddedSignup).toBe(true);
    expect(V1_AFTER_CUTOVER.incompatibilityWindowMinutes).toBe(10);
    expect(V1_AFTER_CUTOVER.inventOid).toBe(false);
    expect(V1_AFTER_CUTOVER.acceptClientOid).toBe(false);
    expect(V1_AFTER_CUTOVER.fallbackToLegacyCreateRpc).toBe(false);
  });
});

describe('contrato: replay e OCC', () => {
  it('distingue conflito 23505, OCC stale, claim consumido e retry de resolve', () => {
    expect(REPLAY_SCENARIOS.A.sqlstate).toBe('23505');
    expect(REPLAY_SCENARIOS.A.http).toBe(409);
    expect(REPLAY_SCENARIOS.A.publicError).toBe('phone_number_already_connected');

    expect(REPLAY_SCENARIOS.B.sqlstate).toBe('P0003');
    expect(REPLAY_SCENARIOS.B.messageIncludes).toBe('authorization_stale');
    expect(REPLAY_SCENARIOS.B.http).toBe(409);
    expect(REPLAY_SCENARIOS.B.publicError).toBe('authorization_stale');

    expect(REPLAY_SCENARIOS.C.sqlstate).toBeNull();
    expect(REPLAY_SCENARIOS.C.http).toBe(400);
    expect(REPLAY_SCENARIOS.C.publicError).toBe('invalid_or_expired_state');

    expect(REPLAY_SCENARIOS.D.sqlstate).toBe('P0003');
    expect(REPLAY_SCENARIOS.D.messageIncludes).toBe('authorization_stale');
    expect(REPLAY_SCENARIOS.D.http).toBe(409);
    expect(REPLAY_SCENARIOS.D.publicError).toBe('authorization_stale');

    expect(REPLAY_SCENARIOS.B.publicError).toBe(REPLAY_SCENARIOS.D.publicError);
    expect(REPLAY_SCENARIOS.A.publicError).not.toBe(REPLAY_SCENARIOS.B.publicError);
    expect(REPLAY_SCENARIOS.C.publicError).not.toBe(REPLAY_SCENARIOS.B.publicError);
  });
});

describe('contrato: inventário de cobertura dos 22 cenários', () => {
  it('preserva IDs originais únicos, com referência e classificação explícita', () => {
    const expectedIds = [
      'C-T1', 'C-T2', 'C-T3', 'C-T4',
      'H-T1', 'H-T2', 'H-T3', 'H-T4',
      'K-T1', 'K-T2', 'K-T3', 'K-T4', 'K-T5', 'K-T6', 'K-T7',
      'R-T1', 'R-T2', 'R-T3', 'R-T4', 'R-T5', 'R-T6', 'R-T7',
    ];

    expect(DISPATCHER_SCENARIO_IDS).toEqual(expectedIds);
    expect(DISPATCHER_SCENARIO_COVERAGE.map((row) => row.id)).toEqual(expectedIds);
    expect(new Set(DISPATCHER_SCENARIO_COVERAGE.map((row) => row.id)).size).toBe(
      expectedIds.length
    );

    const allowedCoverage = new Set([COVERAGE.integral, COVERAGE.partial]);
    for (const row of DISPATCHER_SCENARIO_COVERAGE) {
      expect(row.required).toMatch(/\S/);
      expect(row.file).toMatch(/__tests__\//);
      expect(row.test).toMatch(/\S/);
      expect(allowedCoverage.has(row.coverage)).toBe(true);
      if (row.coverage === COVERAGE.integral) {
        expect(row.file).toMatch(/\.(js|ts)$/);
        expect(row.test.trim().length).toBeGreaterThan(5);
      }
    }

    const partialIds = DISPATCHER_SCENARIO_COVERAGE
      .filter((row) => row.coverage === COVERAGE.partial)
      .map((row) => row.id);
    expect(partialIds).toEqual(['C-T4', 'K-T7', 'R-T3']);

    const cT4 = DISPATCHER_SCENARIO_COVERAGE.find((row) => row.id === 'C-T4');
    expect(cT4.notes).toMatch(/OCC/);
    expect(cT4.notes).toMatch(/23505/);
    expect(cT4.notes).toMatch(/authorization_stale/);

    const rT3 = DISPATCHER_SCENARIO_COVERAGE.find((row) => row.id === 'R-T3');
    expect(rT3.notes).toMatch(/OCC/);
    expect(rT3.notes).toMatch(/23505/);
    expect(rT3.test).toMatch(/R17b/);

    const kT7 = DISPATCHER_SCENARIO_COVERAGE.find((row) => row.id === 'K-T7');
    expect(kT7.file).toMatch(/connectOrReuseMetaWhatsAppConnection/);
    expect(kT7.notes).toMatch(/complete/);
    expect(kT7.coverage).toBe(COVERAGE.partial);
  });
});
