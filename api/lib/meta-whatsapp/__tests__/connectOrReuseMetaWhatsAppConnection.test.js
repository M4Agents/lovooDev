// =============================================================================
// connectOrReuseMetaWhatsAppConnection.test.js
//
// Testes unitários com mock de svc.rpc. Sem Supabase remoto, SQL, Graph
// ou credenciais reais.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectOrReuseMetaWhatsAppConnection } from '../connectOrReuseMetaWhatsAppConnection.js';
import {
  DISPATCHER_RPC,
  LEGACY_CREATE_RPC,
  HELPER_NAME,
  HELPER_REQUIRED_PARAMS,
  resolveHelperPublicError,
} from '../contracts/embeddedSignupDispatcher.contract.js';

const COMPANY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CONNECTED_BY = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const ONBOARDING_ID = 'cccccccc-dddd-4eee-8fff-000000000001';
const INSTANCE_ID = 'dddddddd-eeee-4fff-8aaa-111111111111';
const CIPHERTEXT = 'v1:TESTCIPHERTEXTONLY==';

const HELPER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../connectOrReuseMetaWhatsAppConnection.js'),
  'utf8',
);

function validParams(overrides = {}) {
  return {
    companyId: COMPANY_ID,
    connectedBy: CONNECTED_BY,
    onboardingId: ONBOARDING_ID,
    wabaId: '123456789012345',
    phoneNumberId: '987654321098765',
    phoneNumber: '+55 11 90000-0000',
    verifiedName: 'Empresa Teste',
    displayName: null,
    accessTokenEnc: CIPHERTEXT,
    encryptionVersion: 1,
    ...overrides,
  };
}

function successRow(overrides = {}) {
  return {
    instance_id: INSTANCE_ID,
    phone_number_id: '987654321098765',
    waba_id: '123456789012345',
    phone_number: '+55 11 90000-0000',
    verified_name: 'Empresa Teste',
    status: 'connected',
    ...overrides,
  };
}

function makeSvc(impl) {
  return {
    rpc: vi.fn(impl),
    auth: { getUser: vi.fn() },
  };
}

function makeSuccessSvc(row = successRow()) {
  return makeSvc(async () => ({ data: [row], error: null }));
}

async function expectPublicError(promise, sqlstate, message) {
  const mapped = resolveHelperPublicError(sqlstate, message);
  await expect(promise).rejects.toMatchObject({
    http: mapped.http,
    publicError: mapped.publicError,
  });
}

function assertNoLeak(err) {
  const serialized = `${err && err.message}\n${JSON.stringify(err)}`;
  expect(serialized).not.toMatch(/23505|P0002|P0003|22023|42883|XX000|sqlstate/i);
  expect(serialized).not.toMatch(/TESTCIPHERTEXT|access_token_enc|SECRET_SQL|CANARY/);
  expect(serialized).not.toContain(COMPANY_ID);
  expect(serialized).not.toContain(ONBOARDING_ID);
  expect(serialized).not.toContain(CONNECTED_BY);
}

let fetchSpy;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connectOrReuseMetaWhatsAppConnection', () => {
  it('sucesso: envia os dez parâmetros e retorna o shape público', async () => {
    const svc = makeSuccessSvc();
    const params = validParams();
    const result = await connectOrReuseMetaWhatsAppConnection(svc, params);

    expect(connectOrReuseMetaWhatsAppConnection.name).toBe(HELPER_NAME);
    expect(svc.rpc).toHaveBeenCalledTimes(1);
    expect(svc.rpc).toHaveBeenCalledWith(
      DISPATCHER_RPC,
      {
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
      },
    );
    expect(Object.keys(svc.rpc.mock.calls[0][1])).toEqual([
      'p_company_id',
      'p_connected_by',
      'p_onboarding_id',
      'p_waba_id',
      'p_phone_number_id',
      'p_phone_number',
      'p_verified_name',
      'p_display_name',
      'p_access_token_enc',
      'p_encryption_version',
    ]);
    expect(result).toEqual({
      instance_id: INSTANCE_ID,
      phone_number_id: '987654321098765',
      waba_id: '123456789012345',
      phone_number: '+55 11 90000-0000',
      verified_name: 'Empresa Teste',
      status: 'connected',
    });
    expect(Object.keys(result)).toEqual([
      'instance_id',
      'phone_number_id',
      'waba_id',
      'phone_number',
      'verified_name',
      'status',
    ]);
  });

  it('sucesso: não devolve ciphertext nem identificadores internos extras', async () => {
    const svc = makeSuccessSvc({
      ...successRow(),
      access_token_enc: CIPHERTEXT,
      company_id: COMPANY_ID,
      connected_by: CONNECTED_BY,
      onboarding_id: ONBOARDING_ID,
      encryption_version: 1,
    });
    const result = await connectOrReuseMetaWhatsAppConnection(svc, validParams());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CIPHERTEXT);
    expect(serialized).not.toContain(COMPANY_ID);
    expect(serialized).not.toContain(CONNECTED_BY);
    expect(serialized).not.toContain(ONBOARDING_ID);
    expect(result).not.toHaveProperty('access_token_enc');
    expect(result).not.toHaveProperty('company_id');
    expect(result).not.toHaveProperty('connected_by');
    expect(result).not.toHaveProperty('onboarding_id');
  });

  it('23505 → 409 phone_number_already_connected', async () => {
    const svc = makeSvc(async () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key — SECRET_SQL_CANARY' },
    }));
    try {
      await connectOrReuseMetaWhatsAppConnection(svc, validParams());
      expect.unreachable('deveria falhar');
    } catch (err) {
      expect(err.http).toBe(409);
      expect(err.publicError).toBe('phone_number_already_connected');
      assertNoLeak(err);
    }
  });

  it('P0003 + authorization_stale → 409 authorization_stale', async () => {
    const svc = makeSvc(async () => ({
      data: null,
      error: { code: 'P0003', message: 'authorization_stale' },
    }));
    try {
      await connectOrReuseMetaWhatsAppConnection(svc, validParams());
      expect.unreachable('deveria falhar');
    } catch (err) {
      expect(err.http).toBe(409);
      expect(err.publicError).toBe('authorization_stale');
      assertNoLeak(err);
    }
  });

  it('P0003 com outra mensagem → 500 internal_error', async () => {
    const svc = makeSvc(async () => ({
      data: null,
      error: { code: 'P0003', message: 'some_other_raise CANARY' },
    }));
    try {
      await connectOrReuseMetaWhatsAppConnection(svc, validParams());
      expect.unreachable('deveria falhar');
    } catch (err) {
      expect(err.http).toBe(500);
      expect(err.publicError).toBe('internal_error');
      assertNoLeak(err);
    }
  });

  it('P0002 → 500 internal_error', async () => {
    const svc = makeSvc(async () => ({
      data: null,
      error: { code: 'P0002', message: 'onboarding_not_usable' },
    }));
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams()),
      'P0002',
      'onboarding_not_usable',
    );
  });

  it('22023 → 500 internal_error', async () => {
    const svc = makeSvc(async () => ({
      data: null,
      error: { code: '22023', message: 'invalid_parameter' },
    }));
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams()),
      '22023',
      'invalid_parameter',
    );
  });

  it('42883 → 500 internal_error', async () => {
    const svc = makeSvc(async () => ({
      data: null,
      error: { code: '42883', message: 'function does not exist' },
    }));
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams()),
      '42883',
      'function does not exist',
    );
  });

  it('erro inesperado → 500 internal_error sem vazar detalhes', async () => {
    const svc = makeSvc(async () => {
      throw new Error('boom SECRET_SQL_CANARY');
    });
    try {
      await connectOrReuseMetaWhatsAppConnection(svc, validParams());
      expect.unreachable('deveria falhar');
    } catch (err) {
      expect(err.http).toBe(500);
      expect(err.publicError).toBe('internal_error');
      assertNoLeak(err);
    }
  });

  it('data null não é sucesso', async () => {
    const svc = makeSvc(async () => ({ data: null, error: null }));
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams()),
      null,
      null,
    );
  });

  it('array vazio não é sucesso', async () => {
    const svc = makeSvc(async () => ({ data: [], error: null }));
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams()),
      null,
      null,
    );
  });

  it('múltiplas linhas não são sucesso', async () => {
    const svc = makeSvc(async () => ({
      data: [successRow(), { ...successRow(), instance_id: 'eeeeeeee-ffff-4aaa-8bbb-222222222222' }],
      error: null,
    }));
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams()),
      null,
      null,
    );
  });

  it('shape inválido não é sucesso', async () => {
    const svc = makeSvc(async () => ({
      data: [{ phone_number_id: '987654321098765', status: 'connected' }],
      error: null,
    }));
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams()),
      null,
      null,
    );
  });

  it('companyId inválido é rejeitado sem chamar a RPC', async () => {
    const svc = makeSuccessSvc();
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams({ companyId: 'not-a-uuid' })),
      '22023',
      null,
    );
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('connectedBy inválido é rejeitado sem chamar a RPC', async () => {
    const svc = makeSuccessSvc();
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams({ connectedBy: '' })),
      '22023',
      null,
    );
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('onboardingId inválido é rejeitado sem chamar a RPC', async () => {
    const svc = makeSuccessSvc();
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams({ onboardingId: '123' })),
      '22023',
      null,
    );
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('wabaId inválido é rejeitado sem chamar a RPC', async () => {
    const svc = makeSuccessSvc();
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams({ wabaId: 'abc' })),
      '22023',
      null,
    );
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('phoneNumberId inválido é rejeitado sem chamar a RPC', async () => {
    const svc = makeSuccessSvc();
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams({ phoneNumberId: '' })),
      '22023',
      null,
    );
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('accessTokenEnc inválido é rejeitado sem descriptografar', async () => {
    const svc = makeSuccessSvc();
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(svc, validParams({ accessTokenEnc: 'plaintext-token' })),
      '22023',
      null,
    );
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('encryptionVersion inválido é rejeitado sem chamar a RPC', async () => {
    const svc = makeSuccessSvc();
    for (const encryptionVersion of [0, -1, 1.5, '1', 32768, null]) {
      await expectPublicError(
        connectOrReuseMetaWhatsAppConnection(svc, validParams({ encryptionVersion })),
        '22023',
        null,
      );
    }
    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('campos opcionais aceitam string e null', async () => {
    const svc = makeSuccessSvc();
    const withStrings = await connectOrReuseMetaWhatsAppConnection(
      svc,
      validParams({
        phoneNumber: '+55 11 98888-0000',
        verifiedName: 'Nome Verificado',
        displayName: 'Nome Exibido',
      }),
    );
    expect(withStrings.status).toBe('connected');

    const withNulls = await connectOrReuseMetaWhatsAppConnection(
      svc,
      validParams({
        phoneNumber: null,
        verifiedName: null,
        displayName: null,
      }),
    );
    expect(withNulls.status).toBe('connected');
    expect(svc.rpc).toHaveBeenCalledTimes(2);
    expect(svc.rpc.mock.calls[1][1].p_phone_number).toBeNull();
    expect(svc.rpc.mock.calls[1][1].p_verified_name).toBeNull();
    expect(svc.rpc.mock.calls[1][1].p_display_name).toBeNull();
  });

  it('svc.rpc ausente → 500 internal_error', async () => {
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection({}, validParams()),
      null,
      null,
    );
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(null, validParams()),
      null,
      null,
    );
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection({ rpc: 'nao-e-funcao' }, validParams()),
      null,
      null,
    );
  });

  it('nunca chama a RPC antiga', async () => {
    const names = [];
    const svc = makeSvc(async (name) => {
      names.push(name);
      return { data: [successRow()], error: null };
    });
    await connectOrReuseMetaWhatsAppConnection(svc, validParams());
    expect(names).toEqual([DISPATCHER_RPC]);
    expect(names).not.toContain(LEGACY_CREATE_RPC);
    expect(HELPER_SRC).not.toContain(LEGACY_CREATE_RPC);
    expect(HELPER_SRC).toContain(DISPATCHER_RPC);
  });

  it('não chama Graph API, JWT ou claim', async () => {
    const svc = makeSuccessSvc();
    await connectOrReuseMetaWhatsAppConnection(svc, validParams());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(svc.auth.getUser).not.toHaveBeenCalled();
    expect(HELPER_SRC).not.toMatch(/graphClient|validateMetaCaller|getUser|claimOnboarding|encryptSelectionPayload/);
  });

  it('rejeita instanceId e parâmetros extras sem chamar a RPC', async () => {
    const svc = makeSuccessSvc();
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(
        svc,
        validParams({ instanceId: INSTANCE_ID }),
      ),
      '22023',
      null,
    );
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(
        svc,
        validParams({ instance_id: INSTANCE_ID }),
      ),
      '22023',
      null,
    );
    await expectPublicError(
      connectOrReuseMetaWhatsAppConnection(
        svc,
        validParams({ extra: 'nope' }),
      ),
      '22023',
      null,
    );
    expect(svc.rpc).not.toHaveBeenCalled();
    expect(HELPER_REQUIRED_PARAMS).not.toContain('instanceId');
  });
});
