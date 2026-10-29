import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintByoCredentialRequest } from '../byoCredentialFingerprint.js';

const BYO_KEY = 'ab'.repeat(32);
const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER_COMPANY = 'dddddddd-0000-4000-8000-000000000004';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const OTHER_REQUEST = 'ffffffff-0000-4000-8000-000000000006';
const META = '1234567890';
const APP_SECRET = 'fixture-app-secret-not-real';
const SUAT = 'fixture-suat-not-real';
const FINGERPRINT_RE = /^(h1|s1):[0-9a-f]{64}$/;

const SET_VECTOR = 'h1:9cae39aab206c554fbbb656c55d1932c1d5763583b22d2ffb4d3b51282a84665';
const REVOKE_VECTOR = 's1:9c6e56c6a2897d2b98cb3e70620553e18371d484568341dd7c3fd9c52cd16fd8';
const UNICODE_VECTOR = 'h1:462648a6b377c2cde01e816168816e423c735035b40a7c7eaeb2520e108b258d';

const saved = {};

function base(overrides = {}) {
  return {
    operation: 'set',
    companyId: COMPANY,
    requestId: REQUEST,
    expectedVersion: null,
    metaAppId: META,
    appSecret: APP_SECRET,
    suat: SUAT,
    ...overrides,
  };
}

beforeEach(() => {
  saved.byo = process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
  saved.official = process.env.INSTAGRAM_TOKEN_ENC_KEY_V1;
  process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = BYO_KEY;
  delete process.env.INSTAGRAM_TOKEN_ENC_KEY_V1;
});

afterEach(() => {
  if (saved.byo === undefined) delete process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
  else process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = saved.byo;
  if (saved.official === undefined) delete process.env.INSTAGRAM_TOKEN_ENC_KEY_V1;
  else process.env.INSTAGRAM_TOKEN_ENC_KEY_V1 = saved.official;
  vi.restoreAllMocks();
});

describe('byoCredentialFingerprint', () => {
  it('repete o mesmo fingerprint e casa com o vetor HKDF independente', () => {
    const first = fingerprintByoCredentialRequest(base());
    const second = fingerprintByoCredentialRequest(base({ expectedVersion: undefined }));
    expect(first).toBe(SET_VECTOR);
    expect(second).toBe(first);
    expect(first).toMatch(FINGERPRINT_RE);
  });

  it('muda com operação, empresa, pedido, versão ou um byte do segredo', () => {
    const original = fingerprintByoCredentialRequest(base());
    expect(fingerprintByoCredentialRequest(base({ operation: 'replace_app', expectedVersion: 1 }))).not.toBe(original);
    expect(fingerprintByoCredentialRequest(base({ companyId: OTHER_COMPANY }))).not.toBe(original);
    expect(fingerprintByoCredentialRequest(base({ requestId: OTHER_REQUEST }))).not.toBe(original);
    expect(fingerprintByoCredentialRequest(base({ expectedVersion: 1 }))).not.toBe(original);
    expect(fingerprintByoCredentialRequest(base({ appSecret: `${APP_SECRET}x` }))).not.toBe(original);
  });

  it('aceita Unicode válido e rejeita surrogate inválido', () => {
    const secret = 'segredo-á-não-real';
    const fingerprint = fingerprintByoCredentialRequest({
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 2,
      appSecret: secret,
    });
    expect(fingerprint).toBe(UNICODE_VECTOR);
    expect(fingerprint).toMatch(FINGERPRINT_RE);

    expect(() => fingerprintByoCredentialRequest({
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 2,
      appSecret: 'prefixo-\uD800',
    })).toThrow('[byoCredentialFingerprint] Valor inválido');
  });

  it('mantém dois-pontos, barras, aspas e quebra de linha no segredo', () => {
    const marked = 'a:b/c\\d"e\nf';
    const plain = 'abcde';
    const withMarks = fingerprintByoCredentialRequest({
      operation: 'rotate_suat',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 4,
      suat: marked,
    });
    const withoutMarks = fingerprintByoCredentialRequest({
      operation: 'rotate_suat',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 4,
      suat: plain,
    });
    expect(withMarks).not.toBe(withoutMarks);
    expect(withMarks).toMatch(/^h1:[0-9a-f]{64}$/);
  });

  it('aplica o limite de 4096 bytes UTF-8', () => {
    const max = 'a'.repeat(4096);
    const over = 'a'.repeat(4097);
    const emojiMax = '😀'.repeat(1024);
    expect(fingerprintByoCredentialRequest({
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 1,
      appSecret: max,
    })).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(Buffer.byteLength(emojiMax, 'utf8')).toBe(4096);
    expect(fingerprintByoCredentialRequest({
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 1,
      appSecret: emojiMax,
    })).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(() => fingerprintByoCredentialRequest({
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 1,
      appSecret: over,
    })).toThrow('[byoCredentialFingerprint] Valor inválido');
    expect(() => fingerprintByoCredentialRequest({
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 1,
      appSecret: '',
    })).toThrow('[byoCredentialFingerprint] Valor inválido');
    expect(() => fingerprintByoCredentialRequest({
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 1,
      appSecret: 'a\u0000b',
    })).toThrow('[byoCredentialFingerprint] Valor inválido');
  });

  it('exige versão nas operações que não são o primeiro set', () => {
    for (const operation of ['replace_app', 'rotate_secret', 'rotate_suat', 'revoke']) {
      const payload = {
        operation,
        companyId: COMPANY,
        requestId: REQUEST,
        expectedVersion: null,
      };
      if (operation === 'replace_app') {
        payload.metaAppId = META;
        payload.appSecret = APP_SECRET;
        payload.suat = SUAT;
      }
      if (operation === 'rotate_secret') payload.appSecret = APP_SECRET;
      if (operation === 'rotate_suat') payload.suat = SUAT;
      expect(() => fingerprintByoCredentialRequest(payload)).toThrow('[byoCredentialFingerprint] Valor inválido');
    }
    expect(() => fingerprintByoCredentialRequest(base({ expectedVersion: 0 }))).toThrow('[byoCredentialFingerprint] Valor inválido');
    expect(() => fingerprintByoCredentialRequest(base({ expectedVersion: 1.5 }))).toThrow('[byoCredentialFingerprint] Valor inválido');
  });

  it('recusa chave ausente ou inválida nas operações secretas', () => {
    delete process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
    process.env.INSTAGRAM_TOKEN_ENC_KEY_V1 = 'cd'.repeat(32);
    expect(() => fingerprintByoCredentialRequest(base())).toThrow('[byoCredentialFingerprint] Chave indisponível');

    for (const invalid of ['abc', 'zz'.repeat(32), 'ab'.repeat(31), 'ab'.repeat(33)]) {
      process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = invalid;
      expect(() => fingerprintByoCredentialRequest(base())).toThrow('[byoCredentialFingerprint] Chave indisponível');
    }
  });

  it('calcula revoke sem chave e casa com o vetor SHA-256', () => {
    delete process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
    const input = {
      operation: 'revoke',
      companyId: COMPANY.toUpperCase(),
      requestId: REQUEST,
      expectedVersion: 3,
    };
    expect(fingerprintByoCredentialRequest(input)).toBe(REVOKE_VECTOR);
    process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = 'cd'.repeat(32);
    expect(fingerprintByoCredentialRequest(input)).toBe(REVOKE_VECTOR);
    expect(REVOKE_VECTOR).toMatch(/^s1:[0-9a-f]{64}$/);
  });

  it('não registra segredo, chave ou fingerprint', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    fingerprintByoCredentialRequest(base());
    try {
      fingerprintByoCredentialRequest(base({ appSecret: '' }));
    } catch (caught) {
      expect(caught.message).toBe('[byoCredentialFingerprint] Valor inválido');
      expect(caught.message).not.toContain(APP_SECRET);
      expect(caught.message).not.toContain(BYO_KEY);
    }
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('rejeita propriedade desconhecida', () => {
    expect(() => fingerprintByoCredentialRequest(base({ ciphertext: 'byo1:fixture' }))).toThrow('[byoCredentialFingerprint] Valor inválido');
  });

  it('rejeita campos proibidos em vez de ignorá-los', () => {
    const rotateSecret = {
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 2,
      appSecret: APP_SECRET,
    };
    const cleanSecret = fingerprintByoCredentialRequest(rotateSecret);
    for (const suat of ['fixture-extra', null]) {
      expect(() => fingerprintByoCredentialRequest({ ...rotateSecret, suat })).toThrow('[byoCredentialFingerprint] Valor inválido');
    }
    expect(cleanSecret).toMatch(/^h1:[0-9a-f]{64}$/);

    const rotateSuat = {
      operation: 'rotate_suat',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 2,
      suat: SUAT,
    };
    fingerprintByoCredentialRequest(rotateSuat);
    for (const appSecret of ['fixture-extra', null]) {
      expect(() => fingerprintByoCredentialRequest({ ...rotateSuat, appSecret })).toThrow('[byoCredentialFingerprint] Valor inválido');
    }

    const revoke = {
      operation: 'revoke',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 3,
    };
    fingerprintByoCredentialRequest(revoke);
    for (const extra of [
      { appSecret: APP_SECRET },
      { suat: SUAT },
      { metaAppId: META },
      { appSecret: null },
      { metaAppId: null },
    ]) {
      expect(() => fingerprintByoCredentialRequest({ ...revoke, ...extra })).toThrow('[byoCredentialFingerprint] Valor inválido');
    }
  });

  it('aceita metaAppId de 5 e 32 dígitos e rejeita 4 e 33', () => {
    const withAppId = (metaAppId) => base({ expectedVersion: 1, metaAppId });
    expect(fingerprintByoCredentialRequest(withAppId('12345'))).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(fingerprintByoCredentialRequest(withAppId('1'.repeat(32)))).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(() => fingerprintByoCredentialRequest(withAppId('1234'))).toThrow('[byoCredentialFingerprint] Valor inválido');
    expect(() => fingerprintByoCredentialRequest(withAppId('1'.repeat(33)))).toThrow('[byoCredentialFingerprint] Valor inválido');
  });

  it('aceita a versão máxima e rejeita o inteiro seguinte', () => {
    expect(fingerprintByoCredentialRequest(base({ expectedVersion: 2147483647 }))).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(() => fingerprintByoCredentialRequest(base({ expectedVersion: 2147483648 }))).toThrow('[byoCredentialFingerprint] Valor inválido');
  });

  it('preserva espaços, Unicode decomposto e um byte no meio do segredo', () => {
    const rotate = (appSecret) => fingerprintByoCredentialRequest({
      operation: 'rotate_secret',
      companyId: COMPANY,
      requestId: REQUEST,
      expectedVersion: 2,
      appSecret,
    });
    expect(rotate(' fixture ')).not.toBe(rotate('fixture'));
    expect(rotate('caf\u00e9')).not.toBe(rotate('cafe\u0301'));

    const chars = APP_SECRET.split('');
    const index = Math.floor(chars.length / 2);
    chars[index] = chars[index] === 'a' ? 'b' : 'a';
    const flipped = chars.join('');
    expect(flipped).toHaveLength(APP_SECRET.length);
    expect(fingerprintByoCredentialRequest(base({ appSecret: flipped }))).not.toBe(fingerprintByoCredentialRequest(base()));
  });

  it('separa set e replace_app com a mesma versão e os mesmos campos', () => {
    const shared = { expectedVersion: 7 };
    expect(fingerprintByoCredentialRequest(base({ ...shared, operation: 'set' }))).not.toBe(
      fingerprintByoCredentialRequest(base({ ...shared, operation: 'replace_app' })),
    );
  });
});
