import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptByoSecret, encryptByoSecret } from '../byoTokenCrypto.js';

const SQL_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20261029170000_instagram_byo_company_credentials.sql',
);
const sql = readFileSync(SQL_PATH, 'utf8');

const BYO_KEY = 'ab'.repeat(32);
const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const PREFIX = 'byo1:';
const SQL_SHAPE = /^byo1:[A-Za-z0-9+/]+={0,2}$/;

function context(field) {
  return { companyId: COMPANY, field };
}

function payloadOf(encrypted) {
  return encrypted.slice(PREFIX.length);
}

function sqlAccepts(encrypted) {
  const payload = payloadOf(encrypted);
  return SQL_SHAPE.test(encrypted)
    && encrypted.length >= 45
    && payload.length % 4 === 0;
}

function layout(encrypted) {
  const payload = payloadOf(encrypted);
  const raw = Buffer.from(payload, 'base64');
  return {
    full: encrypted.length,
    payload: payload.length,
    raw: raw.length,
    ciphertext: raw.length - 28,
    canonical: raw.toString('base64') === payload,
  };
}

describe('ciphertext BYO aceito pela constraint SQL', () => {
  const saved = process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;

  beforeEach(() => {
    process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = BYO_KEY;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
    else process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = saved;
  });

  it('mede o mínimo na string completa e o múltiplo de 4 no payload', () => {
    expect(sql).toContain("app_secret_enc ~ '^byo1:[A-Za-z0-9+/]+={0,2}$'");
    expect(sql).toContain("suat_enc ~ '^byo1:[A-Za-z0-9+/]+={0,2}$'");
    expect(sql).toContain('length(app_secret_enc) >= 45');
    expect(sql).toContain('length(suat_enc) >= 45');
    expect(sql).toContain('length(substring(app_secret_enc FROM 6)) % 4 = 0');
    expect(sql).toContain('length(substring(suat_enc FROM 6)) % 4 = 0');
  });

  it('aceita o menor plaintext do módulo: 1 byte, payload 40, string 45', () => {
    const encrypted = encryptByoSecret('x', context('app_secret'));
    const info = layout(encrypted);
    expect(info).toMatchObject({
      full: 45,
      payload: 40,
      raw: 29,
      ciphertext: 1,
      canonical: true,
    });
    expect(sqlAccepts(encrypted)).toBe(true);
    expect(decryptByoSecret(encrypted, context('app_secret'))).toBe('x');
  });

  it('aceita padding 0, 1 e 2 e plaintext longo', () => {
    const cases = [
      ['aa', 'suat', 2, 0],
      ['你', 'app_secret', 3, 2],
      ['s'.repeat(4000), 'suat', 4000, null],
    ];
    const pads = new Set();
    for (const [plain, field, bytes, expectedPad] of cases) {
      const encrypted = encryptByoSecret(plain, context(field));
      const payload = payloadOf(encrypted);
      const info = layout(encrypted);
      const pad = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
      expect(Buffer.byteLength(plain)).toBe(bytes);
      expect(info.ciphertext).toBe(bytes);
      expect(info.raw).toBe(28 + bytes);
      expect(info.canonical).toBe(true);
      expect(sqlAccepts(encrypted)).toBe(true);
      expect(decryptByoSecret(encrypted, context(field))).toBe(plain);
      if (expectedPad !== null) expect(pad).toBe(expectedPad);
      pads.add(pad);
    }
    const one = encryptByoSecret('x', context('app_secret'));
    pads.add(one.slice(PREFIX.length).endsWith('==') ? 2 : one.slice(PREFIX.length).endsWith('=') ? 1 : 0);
    expect(pads).toEqual(new Set([0, 1, 2]));
  });

  it('aceita de 1 a 64 bytes, com + e / no alfabeto base64', () => {
    let sawPlus = false;
    let sawSlash = false;
    for (let size = 1; size <= 64; size += 1) {
      const plain = 'a'.repeat(size);
      const encrypted = encryptByoSecret(plain, context('app_secret'));
      const info = layout(encrypted);
      expect(info.ciphertext).toBe(size);
      expect(info.canonical).toBe(true);
      expect(sqlAccepts(encrypted)).toBe(true);
      const payload = payloadOf(encrypted);
      sawPlus ||= payload.includes('+');
      sawSlash ||= payload.includes('/');
    }
    expect(sawPlus).toBe(true);
    expect(sawSlash).toBe(true);
  });

  it('rejeita vazio no módulo e formato curto ou estranho na regra SQL', () => {
    expect(() => encryptByoSecret('', context('app_secret'))).toThrow('[byoTokenCrypto] Valor inválido para criptografia');
    expect(sqlAccepts('fixture-app-secret-not-real')).toBe(false);
    expect(sqlAccepts(`v1:${'A'.repeat(40)}`)).toBe(false);
    expect(sqlAccepts(`${PREFIX}${'A'.repeat(36)}`)).toBe(false);
    expect(sqlAccepts(`${PREFIX}${'A'.repeat(41)}`)).toBe(false);

    const fake = `${PREFIX}${'A'.repeat(40)}`;
    expect(sqlAccepts(fake)).toBe(true);
    expect(() => decryptByoSecret(fake, context('app_secret'))).toThrow('[byoTokenCrypto] Falha na descriptografia');
  });
});
