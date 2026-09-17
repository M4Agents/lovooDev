// =============================================================================
// selectionTokenCrypto.test.js
//
// Testes unitários para api/lib/meta-whatsapp/selectionTokenCrypto.js
// Todos os testes usam chave e payload fictícios — sem secrets reais.
//
// COBERTURA:
//   C1  key ausente → fail closed (encrypt e decrypt)
//   C2  key tamanho/formato inválido → fail closed
//   C3  encrypt/decrypt round-trip completo
//   C4  ciphertext adulterado (bit flip) → reject (GCM auth tag falha)
//   C5  versão de token inválida (v2:...) → reject
//   C6  token malformado (sem prefixo, base64 inválido, vazio) → reject
//   C7  payload com schema inválido → reject
//   C8  token expirado → reject
//   C9  mensagens de erro não contêm secrets (key, token, payload, IDs)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSelectionPayload, decryptSelectionPayload } from '../selectionTokenCrypto.js';

// =============================================================================
// Fixtures — chaves fictícias, nunca secrets reais
// =============================================================================

const VALID_KEY_HEX = 'c'.repeat(64); // cccc...cccc (64 chars hex = 32 bytes)
const ALT_KEY_HEX   = 'd'.repeat(64); // chave diferente para teste de mismatch

const FAKE_USER_ID    = 'aaaa0000-0000-0000-0000-000000000001';
const FAKE_COMPANY_ID = 'bbbb0000-0000-0000-0000-000000000002';
const FAKE_WABA_ID    = '123456789';
const FAKE_PHONE_ID   = '987654321';
const FAKE_CIPHERTEXT = 'v1:FAKECIPHERTEXT=='; // simula ciphertext de encryptMetaToken

const validPayload = () => ({
  v:    1,
  uid:  FAKE_USER_ID,
  cid:  FAKE_COMPANY_ID,
  exp:  Date.now() + 10 * 60 * 1000, // 10 minutos no futuro
  opts: [
    { w: FAKE_WABA_ID, p: FAKE_PHONE_ID, d: '+55 11 91234-5678', n: 'Empresa Fake' },
  ],
  enc: FAKE_CIPHERTEXT,
});

// =============================================================================
// Setup / Teardown
// =============================================================================

let savedKey;

beforeEach(() => {
  savedKey = process.env.META_SELECTION_ENC_KEY_V1;
  process.env.META_SELECTION_ENC_KEY_V1 = VALID_KEY_HEX;
});

afterEach(() => {
  if (savedKey === undefined) {
    delete process.env.META_SELECTION_ENC_KEY_V1;
  } else {
    process.env.META_SELECTION_ENC_KEY_V1 = savedKey;
  }
});

// =============================================================================
// C1 — Key ausente → fail closed
// =============================================================================
describe('C1: key ausente → fail closed', () => {
  it('encryptSelectionPayload lança se ENV ausente', () => {
    delete process.env.META_SELECTION_ENC_KEY_V1;
    expect(() => encryptSelectionPayload(validPayload())).toThrow();
  });

  it('decryptSelectionPayload lança se ENV ausente', () => {
    // Gerar token com chave válida, depois remover a chave
    const token = encryptSelectionPayload(validPayload());
    delete process.env.META_SELECTION_ENC_KEY_V1;
    expect(() => decryptSelectionPayload(token)).toThrow();
  });
});

// =============================================================================
// C2 — Key tamanho/formato inválido → fail closed
// =============================================================================
describe('C2: key formato inválido → fail closed', () => {
  it('key vazia → lança', () => {
    process.env.META_SELECTION_ENC_KEY_V1 = '';
    expect(() => encryptSelectionPayload(validPayload())).toThrow();
  });

  it('key < 64 chars hex → lança', () => {
    process.env.META_SELECTION_ENC_KEY_V1 = 'a'.repeat(62);
    expect(() => encryptSelectionPayload(validPayload())).toThrow();
  });

  it('key > 64 chars hex → lança', () => {
    process.env.META_SELECTION_ENC_KEY_V1 = 'a'.repeat(66);
    expect(() => encryptSelectionPayload(validPayload())).toThrow();
  });

  it('key com chars não-hex → lança', () => {
    process.env.META_SELECTION_ENC_KEY_V1 = 'z'.repeat(64); // 'z' não é hex
    expect(() => encryptSelectionPayload(validPayload())).toThrow();
  });
});

// =============================================================================
// C3 — Round-trip encrypt → decrypt
// =============================================================================
describe('C3: round-trip encrypt → decrypt', () => {
  it('decrypt(encrypt(payload)) retorna o payload original', () => {
    const original = validPayload();
    const token    = encryptSelectionPayload(original);
    const result   = decryptSelectionPayload(token);

    expect(result.v).toBe(1);
    expect(result.uid).toBe(original.uid);
    expect(result.cid).toBe(original.cid);
    expect(result.exp).toBe(original.exp);
    expect(result.opts).toHaveLength(1);
    expect(result.opts[0].w).toBe(FAKE_WABA_ID);
    expect(result.opts[0].p).toBe(FAKE_PHONE_ID);
    expect(result.opts[0].d).toBe('+55 11 91234-5678');
    expect(result.opts[0].n).toBe('Empresa Fake');
    expect(result.enc).toBe(FAKE_CIPHERTEXT);
  });

  it('token começa com "v1:"', () => {
    const token = encryptSelectionPayload(validPayload());
    expect(token).toMatch(/^v1:/);
  });

  it('dois encrypt do mesmo payload produzem tokens distintos (IV aleatório)', () => {
    const p   = validPayload();
    const t1  = encryptSelectionPayload(p);
    const t2  = encryptSelectionPayload(p);
    expect(t1).not.toBe(t2);
  });

  it('ambos os tokens descriptografam corretamente', () => {
    const p  = validPayload();
    const t1 = encryptSelectionPayload(p);
    const t2 = encryptSelectionPayload(p);
    expect(decryptSelectionPayload(t1).uid).toBe(FAKE_USER_ID);
    expect(decryptSelectionPayload(t2).uid).toBe(FAKE_USER_ID);
  });

  it('round-trip com opts múltiplos e verified_name null', () => {
    const p = {
      ...validPayload(),
      opts: [
        { w: '111', p: '222', d: '+55 11 99999-9999', n: null },
        { w: '333', p: '444', d: '+55 21 88888-8888', n: 'Empresa B' },
      ],
    };
    const r = decryptSelectionPayload(encryptSelectionPayload(p));
    expect(r.opts).toHaveLength(2);
    expect(r.opts[0].n).toBeNull();
    expect(r.opts[1].n).toBe('Empresa B');
  });

  it('round-trip com display_phone null', () => {
    const p = { ...validPayload(), opts: [{ w: '111', p: '222', d: null, n: null }] };
    const r = decryptSelectionPayload(encryptSelectionPayload(p));
    expect(r.opts[0].d).toBeNull();
  });
});

// =============================================================================
// C4 — Ciphertext adulterado → reject
// =============================================================================
describe('C4: ciphertext adulterado → reject', () => {
  it('modificar um byte no base64 → lança (GCM auth tag falha)', () => {
    const token  = encryptSelectionPayload(validPayload());
    // Alterar o 5º char do base64 (dentro do IV ou authTag → adulteração garantida)
    const prefix = 'v1:';
    const b64    = token.slice(prefix.length);
    // Trocar um char do base64 por outro caractere válido de base64
    const flipped = b64[4] === 'A' ? b64.slice(0, 4) + 'B' + b64.slice(5)
                                   : b64.slice(0, 4) + 'A' + b64.slice(5);
    expect(() => decryptSelectionPayload(prefix + flipped)).toThrow();
  });

  it('token de chave diferente → lança', () => {
    process.env.META_SELECTION_ENC_KEY_V1 = ALT_KEY_HEX;
    const tokenAlt = encryptSelectionPayload(validPayload());
    // Restaurar chave original para decryptSelectionPayload
    process.env.META_SELECTION_ENC_KEY_V1 = VALID_KEY_HEX;
    expect(() => decryptSelectionPayload(tokenAlt)).toThrow();
  });
});

// =============================================================================
// C5 — Versão inválida → reject
// =============================================================================
describe('C5: versão inválida → reject', () => {
  it('"v2:..." → lança (versão não suportada)', () => {
    const token    = encryptSelectionPayload(validPayload());
    const v2Token  = token.replace(/^v1:/, 'v2:');
    expect(() => decryptSelectionPayload(v2Token)).toThrow();
  });

  it('"v0:..." → lança', () => {
    const token   = encryptSelectionPayload(validPayload());
    const v0Token = token.replace(/^v1:/, 'v0:');
    expect(() => decryptSelectionPayload(v0Token)).toThrow();
  });
});

// =============================================================================
// C6 — Token malformado → reject
// =============================================================================
describe('C6: token malformado → reject', () => {
  it('string vazia → lança', () => {
    expect(() => decryptSelectionPayload('')).toThrow();
  });

  it('null → lança', () => {
    expect(() => decryptSelectionPayload(null)).toThrow();
  });

  it('number → lança', () => {
    expect(() => decryptSelectionPayload(42)).toThrow();
  });

  it('sem prefixo "v1:" → lança', () => {
    expect(() => decryptSelectionPayload('AAABBBCCC==')).toThrow();
  });

  it('"v1:" sem payload → lança', () => {
    expect(() => decryptSelectionPayload('v1:')).toThrow();
  });

  it('base64 com chars inválidos → lança', () => {
    expect(() => decryptSelectionPayload('v1:!!!!')).toThrow();
  });

  it('base64 curto demais (< IV + authTag + 1 byte) → lança', () => {
    // 12 + 16 + 1 = 29 bytes → base64 mínimo de 40 chars. Qualquer coisa menor falha.
    expect(() => decryptSelectionPayload('v1:AAAA')).toThrow();
  });
});

// =============================================================================
// C7 — Payload com schema inválido → reject
// =============================================================================
describe('C7: schema de payload inválido → reject', () => {
  function encryptRaw(obj) {
    return encryptSelectionPayload(obj);
  }

  it('v !== 1 → lança', () => {
    expect(() => decryptSelectionPayload(encryptRaw({ ...validPayload(), v: 2 }))).toThrow();
  });

  it('uid ausente → lança', () => {
    const p = validPayload();
    delete p.uid;
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('uid não-UUID → lança', () => {
    expect(() => decryptSelectionPayload(encryptRaw({ ...validPayload(), uid: 'not-a-uuid' }))).toThrow();
  });

  it('cid ausente → lança', () => {
    const p = validPayload();
    delete p.cid;
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('cid não-UUID → lança', () => {
    expect(() => decryptSelectionPayload(encryptRaw({ ...validPayload(), cid: 'not-a-uuid' }))).toThrow();
  });

  it('exp ausente → lança', () => {
    const p = validPayload();
    delete p.exp;
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('exp string → lança', () => {
    expect(() => decryptSelectionPayload(encryptRaw({ ...validPayload(), exp: 'tomorrow' }))).toThrow();
  });

  it('opts ausente → lança', () => {
    const p = validPayload();
    delete p.opts;
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('opts array vazio → lança', () => {
    expect(() => decryptSelectionPayload(encryptRaw({ ...validPayload(), opts: [] }))).toThrow();
  });

  it('opts com item sem w → lança', () => {
    const p = { ...validPayload(), opts: [{ p: '111', d: null, n: null }] };
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('opts com item sem p → lança', () => {
    const p = { ...validPayload(), opts: [{ w: '111', d: null, n: null }] };
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('opts com item d inválido (number) → lança', () => {
    const p = { ...validPayload(), opts: [{ w: '111', p: '222', d: 42, n: null }] };
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('opts com item n inválido (number) → lança', () => {
    const p = { ...validPayload(), opts: [{ w: '111', p: '222', d: null, n: 42 }] };
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('enc ausente → lança', () => {
    const p = validPayload();
    delete p.enc;
    expect(() => decryptSelectionPayload(encryptRaw(p))).toThrow();
  });

  it('enc não começa com "v" → lança', () => {
    expect(() => decryptSelectionPayload(encryptRaw({ ...validPayload(), enc: 'INVALID_CIPHERTEXT' }))).toThrow();
  });

  it('payload não-objeto (array) → lança', () => {
    // encryptSelectionPayload rejeita array diretamente
    expect(() => encryptSelectionPayload([])).toThrow();
  });

  it('payload não-objeto (string) → lança', () => {
    expect(() => encryptSelectionPayload('payload string')).toThrow();
  });
});

// =============================================================================
// C8 — Token expirado → reject
// =============================================================================
describe('C8: token expirado → reject', () => {
  it('exp no passado → lança', () => {
    const p = { ...validPayload(), exp: Date.now() - 1 }; // 1ms no passado
    const token = encryptSelectionPayload(p);
    expect(() => decryptSelectionPayload(token)).toThrow();
  });

  it('exp = 0 → lança', () => {
    const p = { ...validPayload(), exp: 0 };
    const token = encryptSelectionPayload(p);
    expect(() => decryptSelectionPayload(token)).toThrow();
  });
});

// =============================================================================
// C9 — Mensagens de erro não contêm secrets
// =============================================================================
describe('C9: erros não expõem secrets', () => {
  const sensitivePatterns = [
    VALID_KEY_HEX,
    VALID_KEY_HEX.slice(0, 8),  // fragmento da chave
    FAKE_USER_ID,
    FAKE_COMPANY_ID,
    FAKE_CIPHERTEXT,
    'META_SELECTION_ENC_KEY_V1',
    'accessToken',
  ];

  it('erro de key ausente não expõe secrets (valor da chave)', () => {
    delete process.env.META_SELECTION_ENC_KEY_V1;
    let errorMsg = '';
    try { encryptSelectionPayload(validPayload()); } catch (e) { errorMsg = e.message; }
    for (const s of sensitivePatterns) {
      expect(errorMsg).not.toContain(VALID_KEY_HEX);
    }
  });

  it('erro de adulteração não expõe payload plaintext', () => {
    const token = encryptSelectionPayload(validPayload());
    const bad   = token.replace(/^v1:/, 'v1:XXXX');
    let errorMsg = '';
    try { decryptSelectionPayload(bad); } catch (e) { errorMsg = e.message; }
    expect(errorMsg).not.toContain(FAKE_USER_ID);
    expect(errorMsg).not.toContain(FAKE_COMPANY_ID);
    expect(errorMsg).not.toContain(FAKE_WABA_ID);
  });

  it('erro de expiração não expõe uid/cid', () => {
    const p     = { ...validPayload(), exp: Date.now() - 1 };
    const token = encryptSelectionPayload(p);
    let errorMsg = '';
    try { decryptSelectionPayload(token); } catch (e) { errorMsg = e.message; }
    expect(errorMsg).not.toContain(FAKE_USER_ID);
    expect(errorMsg).not.toContain(FAKE_COMPANY_ID);
  });
});
