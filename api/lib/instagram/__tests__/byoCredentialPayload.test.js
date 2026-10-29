import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintByoCredentialRequest } from '../byoCredentialFingerprint.js';
import { validateByoCredentialBody, validateByoRevokeBody } from '../byoCredentialPayload.js';

const COMPANY = 'CCCCCCCC-0000-4000-8000-000000000003';
const COMPANY_LOWER = COMPANY.toLowerCase();
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const SECRET = 'fixture-app-secret-not-real';
const SUAT = 'fixture-suat-not-real';
const REJECTED = { ok: false, error: 'rejected' };

function credential(overrides = {}) {
  return {
    company_id: COMPANY,
    request_id: REQUEST,
    operation: 'set',
    meta_app_id: '1234567890',
    app_secret: SECRET,
    suat: SUAT,
    ...overrides,
  };
}

function rotateSecret(overrides = {}) {
  return {
    company_id: COMPANY,
    request_id: REQUEST,
    operation: 'rotate_secret',
    expected_version: 2,
    app_secret: SECRET,
    ...overrides,
  };
}

describe('byoCredentialPayload', () => {
  const saved = {};

  beforeEach(() => {
    saved.key = process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
    process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = 'ab'.repeat(32);
  });

  afterEach(() => {
    if (saved.key === undefined) delete process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
    else process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = saved.key;
  });

  it('aceita cada operação e normaliza UUIDs', () => {
    const set = validateByoCredentialBody(credential());
    const replaced = validateByoCredentialBody(credential({
      operation: 'replace_app',
      expected_version: 4,
    }));
    const secret = validateByoCredentialBody(rotateSecret());
    const suat = validateByoCredentialBody({
      company_id: COMPANY,
      request_id: REQUEST,
      operation: 'rotate_suat',
      expected_version: 5,
      suat: SUAT,
    });
    const revoked = validateByoRevokeBody({
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 6,
    });

    expect(set).toMatchObject({
      ok: true,
      value: { operation: 'set', companyId: COMPANY_LOWER, requestId: REQUEST, expectedVersion: null },
    });
    expect(replaced.value).toMatchObject({ operation: 'replace_app', expectedVersion: 4 });
    expect(secret.value).toEqual({
      operation: 'rotate_secret',
      companyId: COMPANY_LOWER,
      requestId: REQUEST,
      expectedVersion: 2,
      appSecret: SECRET,
    });
    expect(suat.value).toMatchObject({ operation: 'rotate_suat', suat: SUAT });
    expect(revoked.value).toEqual({
      operation: 'revoke',
      companyId: COMPANY_LOWER,
      requestId: REQUEST,
      expectedVersion: 6,
    });
    expect(fingerprintByoCredentialRequest(set.value)).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(fingerprintByoCredentialRequest(revoked.value)).toMatch(/^s1:[0-9a-f]{64}$/);
  });

  it('trata versão ausente e null só no primeiro set', () => {
    expect(validateByoCredentialBody(credential({ expected_version: null })).value.expectedVersion).toBeNull();
    for (const operation of ['replace_app', 'rotate_secret', 'rotate_suat']) {
      const body = credential({ operation });
      delete body.expected_version;
      if (operation === 'rotate_secret') {
        delete body.meta_app_id;
        delete body.suat;
      }
      if (operation === 'rotate_suat') {
        delete body.meta_app_id;
        delete body.app_secret;
      }
      expect(validateByoCredentialBody(body)).toEqual(REJECTED);
      expect(validateByoCredentialBody({ ...body, expected_version: null })).toEqual(REJECTED);
    }
    expect(validateByoRevokeBody({ company_id: COMPANY, request_id: REQUEST })).toEqual(REJECTED);
  });

  it('rejeita versão inválida, UUID inválido e meta_app_id fora do intervalo', () => {
    for (const expected_version of [0, -1, 1.5, '2', 2147483648]) {
      expect(validateByoCredentialBody(credential({ operation: 'replace_app', expected_version }))).toEqual(REJECTED);
    }
    expect(validateByoCredentialBody(credential({ expected_version: 2147483647 })).ok).toBe(true);
    const reactivated = validateByoCredentialBody(credential({ expected_version: 2 }));
    expect(reactivated.ok).toBe(true);
    expect(reactivated.value.expectedVersion).toBe(2);
    expect(validateByoCredentialBody(credential({ company_id: 'nao-uuid' }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(credential({ request_id: `${REQUEST} ` }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(credential({ meta_app_id: '1234' }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(credential({ meta_app_id: '12345' })).ok).toBe(true);
    expect(validateByoCredentialBody(credential({ meta_app_id: '1'.repeat(32) })).ok).toBe(true);
    expect(validateByoCredentialBody(credential({ meta_app_id: '1'.repeat(33) }))).toEqual(REJECTED);
  });

  it('preserva segredos e recusa tamanho, nulo e surrogate', () => {
    const spaced = validateByoCredentialBody(rotateSecret({ app_secret: ' fixture ' }));
    expect(spaced.value.appSecret).toBe(' fixture ');
    const composed = validateByoCredentialBody(rotateSecret({ app_secret: 'caf\u00e9' }));
    const decomposed = validateByoCredentialBody(rotateSecret({ app_secret: 'cafe\u0301' }));
    expect(composed.value.appSecret).not.toBe(decomposed.value.appSecret);
    expect(validateByoCredentialBody(rotateSecret({ app_secret: 'a'.repeat(4096) })).ok).toBe(true);
    expect(validateByoCredentialBody(rotateSecret({ app_secret: '😀'.repeat(1024) })).ok).toBe(true);

    const hostile = 'a\u0000fixture-app-secret-not-real';
    const broken = validateByoCredentialBody(rotateSecret({ app_secret: hostile }));
    expect(broken).toEqual(REJECTED);
    expect(JSON.stringify(broken)).not.toContain('fixture-app-secret-not-real');
    expect(validateByoCredentialBody(rotateSecret({ app_secret: '' }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(rotateSecret({ app_secret: 'a'.repeat(4097) }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(rotateSecret({ app_secret: 'prefixo-\uD800' }))).toEqual(REJECTED);
  });

  it('rejeita campos desconhecidos, proibidos e corpos que não são objeto plano', () => {
    expect(validateByoCredentialBody(credential({ actor_user_id: 'user-1' }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(credential({ role: 'admin' }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(credential({ origin_project_id: 'prj_test' }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(credential({ request_fingerprint: 'h1:ab' }))).toEqual(REJECTED);
    expect(validateByoCredentialBody(credential({ app_secret_enc: 'byo1:abc' }))).toEqual(REJECTED);
    expect(validateByoCredentialBody({ ...rotateSecret(), suat: null })).toEqual(REJECTED);
    expect(validateByoCredentialBody({ ...rotateSecret(), meta_app_id: null })).toEqual(REJECTED);
    expect(validateByoCredentialBody({
      company_id: COMPANY,
      request_id: REQUEST,
      operation: 'rotate_suat',
      expected_version: 2,
      suat: SUAT,
      app_secret: null,
    })).toEqual(REJECTED);
    expect(validateByoRevokeBody({
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
      operation: 'revoke',
    })).toEqual(REJECTED);
    expect(validateByoRevokeBody({
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
      app_secret: null,
    })).toEqual(REJECTED);
    expect(validateByoCredentialBody(credential({ operation: 'revoke' }))).toEqual(REJECTED);

    const inherited = Object.create({ leaked: true });
    Object.assign(inherited, credential());
    expect(validateByoCredentialBody(inherited)).toEqual(REJECTED);
    expect(validateByoCredentialBody([credential()])).toEqual(REJECTED);
    expect(validateByoCredentialBody(null)).toEqual(REJECTED);
    expect(validateByoCredentialBody(new URLSearchParams())).toEqual(REJECTED);
    expect(validateByoRevokeBody(Object.create(null))).toEqual(REJECTED);

    const proto = JSON.parse(`{"__proto__":{"admin":true},${JSON.stringify(credential()).slice(1)}`);
    expect(Object.hasOwn(proto, '__proto__')).toBe(true);
    expect(Object.prototype).not.toHaveProperty('admin');
    expect(validateByoCredentialBody(proto)).toEqual(REJECTED);

    const constructed = credential();
    Object.defineProperty(constructed, 'constructor', {
      value: { admin: true },
      enumerable: true,
    });
    expect(Object.hasOwn(constructed, 'constructor')).toBe(true);
    expect(validateByoCredentialBody(constructed)).toEqual(REJECTED);

    const secretWithSuat = rotateSecret();
    secretWithSuat.suat = undefined;
    expect(Object.hasOwn(secretWithSuat, 'suat')).toBe(true);
    expect(validateByoCredentialBody(secretWithSuat)).toEqual(REJECTED);

    const suatWithSecret = {
      company_id: COMPANY,
      request_id: REQUEST,
      operation: 'rotate_suat',
      expected_version: 2,
      suat: SUAT,
    };
    suatWithSecret.app_secret = undefined;
    expect(Object.hasOwn(suatWithSecret, 'app_secret')).toBe(true);
    expect(validateByoCredentialBody(suatWithSecret)).toEqual(REJECTED);
  });
});
