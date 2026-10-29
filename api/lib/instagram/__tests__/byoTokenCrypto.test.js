import { createDecipheriv } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptInstagramToken, encryptInstagramToken } from '../tokenCrypto.js';
import { decryptByoSecret, encryptByoSecret } from '../byoTokenCrypto.js';

const BYO_KEY = 'ab'.repeat(32);
const OTHER_BYO_KEY = 'cd'.repeat(32);
const OFFICIAL_KEY = 'ef'.repeat(32);
const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER_COMPANY = 'dddddddd-0000-4000-8000-000000000004';
const APP_SECRET = 'fixture-app-secret-not-real';
const SUAT = 'fixture-suat-not-real';

const saved = {};

function context(field, companyId = COMPANY) {
  return { companyId, field };
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
});

describe('byoTokenCrypto', () => {
  it('cifra e decifra App Secret e SUAT', () => {
    const secret = encryptByoSecret(APP_SECRET, context('app_secret'));
    const suat = encryptByoSecret(SUAT, context('suat'));
    expect(secret.startsWith('byo1:')).toBe(true);
    expect(suat.startsWith('byo1:')).toBe(true);
    expect(decryptByoSecret(secret, context('app_secret'))).toBe(APP_SECRET);
    expect(decryptByoSecret(suat, context('suat'))).toBe(SUAT);
  });

  it('gera IV diferente em operações repetidas', () => {
    const first = encryptByoSecret(APP_SECRET, context('app_secret'));
    const second = encryptByoSecret(APP_SECRET, context('app_secret'));
    expect(first).not.toBe(second);
    const firstIv = Buffer.from(first.slice(5), 'base64').subarray(0, 12);
    const secondIv = Buffer.from(second.slice(5), 'base64').subarray(0, 12);
    expect(firstIv.equals(secondIv)).toBe(false);
  });

  it('rejeita ciphertext adulterado, chave incorreta e prefixo ou payload inválidos', () => {
    const encrypted = encryptByoSecret(APP_SECRET, context('app_secret'));
    const bytes = Buffer.from(encrypted.slice(5), 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = `byo1:${bytes.toString('base64')}`;

    expect(() => decryptByoSecret(tampered, context('app_secret'))).toThrow('[byoTokenCrypto] Falha na descriptografia');
    process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = OTHER_BYO_KEY;
    expect(() => decryptByoSecret(encrypted, context('app_secret'))).toThrow('[byoTokenCrypto] Falha na descriptografia');

    process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = BYO_KEY;
    expect(() => decryptByoSecret('v1:AAAA', context('app_secret'))).toThrow('[byoTokenCrypto] Falha na descriptografia');
    expect(() => decryptByoSecret('byo2:AAAA', context('app_secret'))).toThrow('[byoTokenCrypto] Falha na descriptografia');
    expect(() => decryptByoSecret('byo1:!!!', context('app_secret'))).toThrow('[byoTokenCrypto] Falha na descriptografia');
    expect(() => decryptByoSecret('byo1:', context('app_secret'))).toThrow('[byoTokenCrypto] Falha na descriptografia');
  });

  it('rejeita chave ausente ou com formato inválido', () => {
    delete process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
    expect(() => encryptByoSecret(APP_SECRET, context('app_secret'))).toThrow('[byoTokenCrypto] Chave indisponível');

    for (const invalid of ['abc', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = invalid;
      expect(() => encryptByoSecret(APP_SECRET, context('app_secret'))).toThrow('[byoTokenCrypto] Chave indisponível');
    }
  });

  it('rejeita company_id ou campo diferentes', () => {
    const encrypted = encryptByoSecret(APP_SECRET, context('app_secret'));
    expect(() => decryptByoSecret(encrypted, context('app_secret', OTHER_COMPANY))).toThrow('[byoTokenCrypto] Falha na descriptografia');
    expect(() => decryptByoSecret(encrypted, context('suat'))).toThrow('[byoTokenCrypto] Falha na descriptografia');
  });

  it('não usa a chave oficial do Instagram', () => {
    process.env.INSTAGRAM_TOKEN_ENC_KEY_V1 = OFFICIAL_KEY;
    delete process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1;
    expect(() => encryptByoSecret(APP_SECRET, context('app_secret'))).toThrow('[byoTokenCrypto] Chave indisponível');

    process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = BYO_KEY;
    const byo = encryptByoSecret(APP_SECRET, context('app_secret'));
    expect(() => decryptInstagramToken(byo)).toThrow();

    const official = encryptInstagramToken(APP_SECRET);
    expect(() => decryptByoSecret(official, context('app_secret'))).toThrow('[byoTokenCrypto] Falha na descriptografia');
    expect(decryptInstagramToken(official)).toBe(APP_SECRET);
  });

  it('não coloca segredo, chave ou ciphertext na mensagem de erro', () => {
    const encrypted = encryptByoSecret(APP_SECRET, context('app_secret'));
    process.env.INSTAGRAM_BYO_TOKEN_ENC_KEY_V1 = OTHER_BYO_KEY;
    try {
      decryptByoSecret(encrypted, context('app_secret'));
      throw new Error('deveria falhar');
    } catch (error) {
      const message = error.message;
      expect(message).not.toContain(APP_SECRET);
      expect(message).not.toContain(BYO_KEY);
      expect(message).not.toContain(OTHER_BYO_KEY);
      expect(message).not.toContain(encrypted);
      expect(message).not.toContain(COMPANY);
    }
  });

  it('grava IV, tag e ciphertext nessa ordem', () => {
    const encrypted = encryptByoSecret(APP_SECRET, context('app_secret'));
    const combined = Buffer.from(encrypted.slice(5), 'base64');
    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const ciphertext = combined.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(BYO_KEY, 'hex'), iv);
    decipher.setAAD(Buffer.from(`${COMPANY}|app_secret`, 'utf8'));
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    expect(plain).toBe(APP_SECRET);
  });
});
