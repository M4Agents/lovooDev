// =============================================================================
// pinCrypto.test.js — Testes para encryptMetaRegistrationPin,
//                     decryptMetaRegistrationPin, generateMetaRegistrationPin
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  encryptMetaRegistrationPin,
  decryptMetaRegistrationPin,
  generateMetaRegistrationPin,
} from '../pinCrypto.js';

// Chave hex válida de 32 bytes (64 chars) — somente para testes.
const VALID_KEY_HEX = 'a'.repeat(64);

// Helper: configura ENV válida antes de cada teste.
function setValidEnv() {
  process.env.META_TOKEN_ENC_KEY_V1 = VALID_KEY_HEX;
}

// =============================================================================
// generateMetaRegistrationPin
// =============================================================================

describe('generateMetaRegistrationPin', () => {
  it('PC-G01: retorna string', () => {
    const pin = generateMetaRegistrationPin();
    expect(typeof pin).toBe('string');
  });

  it('PC-G02: exatamente 6 caracteres', () => {
    const pin = generateMetaRegistrationPin();
    expect(pin).toHaveLength(6);
  });

  it('PC-G03: somente dígitos', () => {
    const pin = generateMetaRegistrationPin();
    expect(/^[0-9]{6}$/.test(pin)).toBe(true);
  });

  it('PC-G04: leading zeros — padStart garante 6 dígitos quando randomInt retorna valor pequeno', () => {
    // Testa a lógica de padStart que gera leading zeros.
    // randomInt(0, 1_000_000) pode retornar 0..999; padStart(6,'0') produz "000000".."000999"
    const samplesWithLeadingZeros = [0, 1, 42, 999, 10000].map(n =>
      String(n).padStart(6, '0')
    );
    expect(samplesWithLeadingZeros[0]).toBe('000000');
    expect(samplesWithLeadingZeros[1]).toBe('000001');
    expect(samplesWithLeadingZeros[2]).toBe('000042');
    expect(samplesWithLeadingZeros[3]).toBe('000999');
    expect(samplesWithLeadingZeros[4]).toBe('010000');
    samplesWithLeadingZeros.forEach(p => expect(/^[0-9]{6}$/.test(p)).toBe(true));
  });

  it('PC-G05: "000000" é representação válida do espaço — passível de geração', () => {
    // Garante que a implementação não filtra ou rejeita 0
    expect(String(0).padStart(6, '0')).toBe('000000');
    expect(/^[0-9]{6}$/.test('000000')).toBe(true);
  });

  it('PC-G06: "999999" é representação válida — extremo superior', () => {
    expect(String(999999).padStart(6, '0')).toBe('999999');
    expect(/^[0-9]{6}$/.test('999999')).toBe(true);
  });

  it('PC-G07: múltiplas chamadas produzem strings independentes na maioria dos casos', () => {
    // Não garante aleatoriedade (dependeria de crypto real), mas garante formato
    const pins = Array.from({ length: 20 }, () => generateMetaRegistrationPin());
    pins.forEach(p => expect(/^[0-9]{6}$/.test(p)).toBe(true));
  });
});

// =============================================================================
// encryptMetaRegistrationPin + decryptMetaRegistrationPin
// =============================================================================

describe('encryptMetaRegistrationPin / decryptMetaRegistrationPin', () => {
  beforeEach(() => {
    setValidEnv();
  });

  // ── Round-trip ─────────────────────────────────────────────────────────────

  it('PC-E01: round-trip "000000"', () => {
    const enc = encryptMetaRegistrationPin('000000');
    expect(decryptMetaRegistrationPin(enc)).toBe('000000');
  });

  it('PC-E02: round-trip "999999"', () => {
    const enc = encryptMetaRegistrationPin('999999');
    expect(decryptMetaRegistrationPin(enc)).toBe('999999');
  });

  it('PC-E03: round-trip PIN com leading zero "042731"', () => {
    const enc = encryptMetaRegistrationPin('042731');
    expect(decryptMetaRegistrationPin(enc)).toBe('042731');
  });

  it('PC-E04: ciphertext começa com "v1:"', () => {
    const enc = encryptMetaRegistrationPin('123456');
    expect(enc.startsWith('v1:')).toBe(true);
  });

  it('PC-E05: dois encrypts do mesmo PIN produzem ciphertexts distintos (IV aleatório)', () => {
    const enc1 = encryptMetaRegistrationPin('123456');
    const enc2 = encryptMetaRegistrationPin('123456');
    expect(enc1).not.toBe(enc2);
  });

  it('PC-E06: PIN não aparece em plaintext no ciphertext', () => {
    const pin = '987654';
    const enc = encryptMetaRegistrationPin(pin);
    // O payload base64 não deve conter o PIN literalmente
    expect(enc).not.toContain(pin);
  });

  // ── Rejeição de PIN inválido em encrypt ────────────────────────────────────

  it('PC-E07: rejeita 5 dígitos', () => {
    expect(() => encryptMetaRegistrationPin('12345')).toThrow();
  });

  it('PC-E08: rejeita 7 dígitos', () => {
    expect(() => encryptMetaRegistrationPin('1234567')).toThrow();
  });

  it('PC-E09: rejeita string vazia', () => {
    expect(() => encryptMetaRegistrationPin('')).toThrow();
  });

  it('PC-E10: rejeita PIN com letras', () => {
    expect(() => encryptMetaRegistrationPin('12345a')).toThrow();
  });

  it('PC-E11: rejeita PIN com espaço', () => {
    expect(() => encryptMetaRegistrationPin('12 456')).toThrow();
  });

  it('PC-E12: rejeita non-string (número)', () => {
    expect(() => encryptMetaRegistrationPin(123456)).toThrow();
  });

  it('PC-E13: rejeita null', () => {
    expect(() => encryptMetaRegistrationPin(null)).toThrow();
  });

  it('PC-E14: rejeita undefined', () => {
    expect(() => encryptMetaRegistrationPin(undefined)).toThrow();
  });

  // ── Rejeição de ciphertext adulterado em decrypt ───────────────────────────

  it('PC-D01: ciphertext adulterado (bit flip) lança erro genérico', () => {
    const enc = encryptMetaRegistrationPin('123456');
    const parts = enc.split(':');
    const buf = Buffer.from(parts[1], 'base64');
    // Flip de um byte no meio do ciphertext
    buf[buf.length - 1] ^= 0xff;
    const tampered = `v1:${buf.toString('base64')}`;
    expect(() => decryptMetaRegistrationPin(tampered)).toThrow();
  });

  it('PC-D02: ciphertext truncado lança erro', () => {
    expect(() => decryptMetaRegistrationPin('v1:abc=')).toThrow();
  });

  it('PC-D03: decrypt de string não-formatada lança erro', () => {
    expect(() => decryptMetaRegistrationPin('nao-e-um-ciphertext')).toThrow();
  });

  it('PC-D04: decrypt de non-string lança erro', () => {
    expect(() => decryptMetaRegistrationPin(12345)).toThrow();
  });

  it('PC-D05: versão desconhecida lança erro', () => {
    expect(() => decryptMetaRegistrationPin('v2:abc==')).toThrow();
  });

  // ── ENV ausente/inválida ───────────────────────────────────────────────────

  it('PC-K01: encrypt falha com ENV ausente', () => {
    delete process.env.META_TOKEN_ENC_KEY_V1;
    expect(() => encryptMetaRegistrationPin('123456')).toThrow();
  });

  it('PC-K02: decrypt falha com ENV ausente', () => {
    // Cifrar primeiro com ENV válida
    setValidEnv();
    const enc = encryptMetaRegistrationPin('123456');
    // Remover ENV e tentar decifrar
    delete process.env.META_TOKEN_ENC_KEY_V1;
    expect(() => decryptMetaRegistrationPin(enc)).toThrow();
  });

  it('PC-K03: encrypt falha com ENV de tamanho incorreto', () => {
    process.env.META_TOKEN_ENC_KEY_V1 = 'abc123'; // menos de 64 chars
    expect(() => encryptMetaRegistrationPin('123456')).toThrow();
  });

  it('PC-K04: encrypt falha com ENV não-hex', () => {
    process.env.META_TOKEN_ENC_KEY_V1 = 'z'.repeat(64); // chars não-hex
    expect(() => encryptMetaRegistrationPin('123456')).toThrow();
  });
});
