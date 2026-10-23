/**
 * Contratos e especificações futuras da integração Embedded Signup.
 *
 * it() = invariantes do contrato (passam agora).
 * it.todo() = comportamento a implementar nas etapas seguintes.
 * Nenhum teste ativo altera endpoints, crypto ou RPC.
 *
 * Ativação futura: promover it.todo → it quando helper/crypto/endpoints
 * forem implementados (após aplicar a migration no Supabase compartilhado).
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
  HELPER_NAME,
  HELPER_REQUIRED_PARAMS,
  HELPER_FORBIDDEN,
  HELPER_ERROR_MAP,
  SUCCESS_INSTANCE_SHAPE,
  COMPLETE_CONTRACT,
  RESOLVE_WABA_CONTRACT,
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

describe('contrato: token de continuação v:2 (especificação)', () => {
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

  it('v:1 atual continua criptografável; decrypt legado rejeita payload v:2', () => {
    const token = encryptSelectionPayload(v1Payload());
    expect(token.startsWith(SELECTION_TOKEN_CRYPTO_PREFIX)).toBe(true);
    expect(decryptSelectionPayload(token).v).toBe(1);

    const forgedV2 = encryptSelectionPayload(v1Payload({ v: 2, oid: VALID_OID }));
    expect(forgedV2.startsWith(SELECTION_TOKEN_CRYPTO_PREFIX)).toBe(true);
    expect(() => decryptSelectionPayload(forgedV2)).toThrow();
  });

  it.todo('v:2 válido: decrypt aceita oid UUID e preserva uid/cid/opts/enc/exp');
  it.todo('v:2 sem oid: rejeitado');
  it.todo('v:2 com oid inválido: rejeitado');
  it.todo('token adulterado: rejeitado pela integridade AES-GCM');
  it.todo('token expirado: rejeitado');
  it.todo('uid divergente do JWT: rejeitado no endpoint, não no helper');
  it.todo('cid divergente: rejeitado pelo validateMetaCaller');
  it.todo('v:1 legado após cutover: invalid_continuation (sem inventar oid)');
  it.todo('replay de token: RPC valida oid + company_id + user_id + used_at');
});

describe('contrato: helper de persistência (especificação)', () => {
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

  it.todo('helper invoca somente a RPC dispatcher com os 10 params validados');
  it.todo('helper não chama Graph API, claim, JWT, nem a RPC antiga');
  it.todo('helper não aceita instance_id do cliente e não retorna ciphertext');
  it.todo('RPC ausente (42883) → internal_error controlado');
});

describe('contrato: complete.js (especificação futura)', () => {
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

  it.todo('completa com p_onboarding_id igual ao state efetivamente claimado');
  it.todo('company_id derivado da row claimada; connected_by derivado do JWT');
  it.todo('uma única chamada ao helper; zero chamadas à RPC antiga após cutover');
  it.todo('sucesso preserva o shape atual de instance');
  it.todo('authorization_stale → HTTP 409');
  it.todo('conflito cross-tenant (23505) → HTTP 409 phone_number_already_connected');
  it.todo('RPC ausente → falha interna controlada');
});

describe('contrato: resolve-waba.js (especificação futura)', () => {
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

  it.todo('v:2 válido: oid do token vira p_onboarding_id do helper');
  it.todo('v:1 legado após cutover: invalid_continuation');
  it.todo('replay: recusado pela RPC (used_at / vínculo oid+company+user)');
  it.todo('token adulterado: rejeitado');
  it.todo('token expirado: rejeitado');
  it.todo('erros da RPC mapeados pelo helper sem vazar SQL');
  it.todo('sucesso preserva o shape atual');
});

describe('contrato: compatibilidade v:1 (não ativar agora)', () => {
  it('cutover v:1 está documentado e inativo nesta etapa', () => {
    expect(V1_AFTER_CUTOVER.activeInThisSlice).toBe(false);
    expect(V1_AFTER_CUTOVER.publicError).toBe('invalid_continuation');
    expect(V1_AFTER_CUTOVER.http).toBe(400);
    expect(V1_AFTER_CUTOVER.restartEmbeddedSignup).toBe(true);
    expect(V1_AFTER_CUTOVER.incompatibilityWindowMinutes).toBe(10);
    expect(V1_AFTER_CUTOVER.inventOid).toBe(false);
    expect(V1_AFTER_CUTOVER.acceptClientOid).toBe(false);
    expect(V1_AFTER_CUTOVER.fallbackToLegacyCreateRpc).toBe(false);
  });
});
