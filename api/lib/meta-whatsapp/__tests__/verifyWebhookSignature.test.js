// =============================================================================
// verifyWebhookSignature.test.js
//
// Testes unitários para api/lib/meta-whatsapp/verifyWebhookSignature.js
// Todos os secrets e corpos são fictícios — sem dados reais.
//
// COBERTURA — verifyMetaWebhookSignature:
//   SIG-U01  assinatura válida → true
//   SIG-U02  body alterado → false
//   SIG-U03  signature alterada → false
//   SIG-U04  prefixo incorreto → false
//   SIG-U05  hex inválido (chars não-hex) → false
//   SIG-U06  tamanho incorreto (< 64 hex chars) → false
//   SIG-U07  signature ausente (undefined / null / '') → false
//   SIG-U08  appSecret vazio → false
//   SIG-U09  rawBody não é Buffer → false
//   SIG-U10  não lança exceção com qualquer input malformado
//   SIG-U11  rawBody Buffer vazio → false
//   SIG-U12  case-insensitive no hex recebido → true
//   SIG-U13  secret diferente → false
//
// COBERTURA — readRawBody:
//   RRB-01  lê body pequeno corretamente
//   RRB-02  lê body exatamente no limite → aceito
//   RRB-03  body 1 byte acima do limite → body_too_large
//   RRB-04  erro tem code='body_too_large'
//   RRB-05  chunks são concatenados corretamente
//   RRB-06  body vazio → Buffer vazio
//   RRB-07  limite customizado respeitado
// =============================================================================

import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyMetaWebhookSignature, readRawBody } from '../verifyWebhookSignature.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_SECRET  = 'fake_meta_app_secret_for_tests_only_not_real';
const OTHER_SECRET = 'other_secret_for_negative_tests_not_real_xxxx';
const FAKE_BODY    = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

/**
 * Gera uma assinatura HMAC SHA-256 válida para os parâmetros fornecidos.
 * Usado apenas nos testes para produzir o header esperado.
 */
function makeSignature(body, secret) {
  const hex = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hex}`;
}

// =============================================================================
// Testes
// =============================================================================

describe('verifyMetaWebhookSignature', () => {

  // ── Caso positivo ────────────────────────────────────────────────────────────

  it('SIG-U01: assinatura válida → true', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(verifyMetaWebhookSignature(FAKE_BODY, sig, FAKE_SECRET)).toBe(true);
  });

  it('SIG-U12: hex recebido em uppercase → true (case-insensitive)', () => {
    // Gerar assinatura com uppercase para verificar tolerância de case
    const hexLower = createHmac('sha256', FAKE_SECRET).update(FAKE_BODY).digest('hex');
    const sigUpper = `sha256=${hexLower.toUpperCase()}`;
    expect(verifyMetaWebhookSignature(FAKE_BODY, sigUpper, FAKE_SECRET)).toBe(true);
  });

  // ── Body alterado ────────────────────────────────────────────────────────────

  it('SIG-U02: body alterado (1 byte diferente) → false', () => {
    const sig         = makeSignature(FAKE_BODY, FAKE_SECRET);
    const alteredBody = Buffer.from(FAKE_BODY.toString('utf8').replace('{', '['));
    expect(verifyMetaWebhookSignature(alteredBody, sig, FAKE_SECRET)).toBe(false);
  });

  // ── Signature alterada ───────────────────────────────────────────────────────

  it('SIG-U03: signature alterada (último char diferente) → false', () => {
    const sig    = makeSignature(FAKE_BODY, FAKE_SECRET);
    const last   = sig.slice(-1);
    const newLast = last === 'a' ? 'b' : 'a';
    const altSig = sig.slice(0, -1) + newLast;
    expect(verifyMetaWebhookSignature(FAKE_BODY, altSig, FAKE_SECRET)).toBe(false);
  });

  // ── Prefixo incorreto ────────────────────────────────────────────────────────

  it('SIG-U04a: prefixo "sha1=" em vez de "sha256=" → false', () => {
    const hexOnly = createHmac('sha256', FAKE_SECRET).update(FAKE_BODY).digest('hex');
    expect(verifyMetaWebhookSignature(FAKE_BODY, `sha1=${hexOnly}`, FAKE_SECRET)).toBe(false);
  });

  it('SIG-U04b: sem prefixo (hex puro) → false', () => {
    const hexOnly = createHmac('sha256', FAKE_SECRET).update(FAKE_BODY).digest('hex');
    expect(verifyMetaWebhookSignature(FAKE_BODY, hexOnly, FAKE_SECRET)).toBe(false);
  });

  // ── Hex inválido ─────────────────────────────────────────────────────────────

  it('SIG-U05: chars não-hex na signature → false', () => {
    // Substituir últimos 2 chars por 'GG' (não-hex)
    const hexOnly    = createHmac('sha256', FAKE_SECRET).update(FAKE_BODY).digest('hex');
    const invalidHex = hexOnly.slice(0, 62) + 'GG';
    expect(verifyMetaWebhookSignature(FAKE_BODY, `sha256=${invalidHex}`, FAKE_SECRET)).toBe(false);
  });

  // ── Tamanho incorreto ────────────────────────────────────────────────────────

  it('SIG-U06a: hex muito curto (< 64 chars) → false', () => {
    expect(verifyMetaWebhookSignature(FAKE_BODY, 'sha256=abc123', FAKE_SECRET)).toBe(false);
  });

  it('SIG-U06b: hex muito longo (> 64 chars) → false', () => {
    const hexOnly = createHmac('sha256', FAKE_SECRET).update(FAKE_BODY).digest('hex');
    expect(verifyMetaWebhookSignature(FAKE_BODY, `sha256=${hexOnly}ff`, FAKE_SECRET)).toBe(false);
  });

  // ── Signature ausente ────────────────────────────────────────────────────────

  it('SIG-U07a: signature undefined → false', () => {
    expect(verifyMetaWebhookSignature(FAKE_BODY, undefined, FAKE_SECRET)).toBe(false);
  });

  it('SIG-U07b: signature null → false', () => {
    expect(verifyMetaWebhookSignature(FAKE_BODY, null, FAKE_SECRET)).toBe(false);
  });

  it('SIG-U07c: signature string vazia → false', () => {
    expect(verifyMetaWebhookSignature(FAKE_BODY, '', FAKE_SECRET)).toBe(false);
  });

  // ── appSecret vazio ──────────────────────────────────────────────────────────

  it('SIG-U08a: appSecret string vazia → false', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(verifyMetaWebhookSignature(FAKE_BODY, sig, '')).toBe(false);
  });

  it('SIG-U08b: appSecret undefined → false', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(verifyMetaWebhookSignature(FAKE_BODY, sig, undefined)).toBe(false);
  });

  it('SIG-U08c: appSecret null → false', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(verifyMetaWebhookSignature(FAKE_BODY, sig, null)).toBe(false);
  });

  // ── rawBody inválido ─────────────────────────────────────────────────────────

  it('SIG-U09a: rawBody string (não Buffer) → false', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(verifyMetaWebhookSignature(FAKE_BODY.toString('utf8'), sig, FAKE_SECRET)).toBe(false);
  });

  it('SIG-U09b: rawBody null → false', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(verifyMetaWebhookSignature(null, sig, FAKE_SECRET)).toBe(false);
  });

  it('SIG-U09c: rawBody undefined → false', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(verifyMetaWebhookSignature(undefined, sig, FAKE_SECRET)).toBe(false);
  });

  it('SIG-U11: rawBody Buffer vazio → false', () => {
    const sig = makeSignature(Buffer.alloc(0), FAKE_SECRET);
    expect(verifyMetaWebhookSignature(Buffer.alloc(0), sig, FAKE_SECRET)).toBe(false);
  });

  // ── Secret incorreto ─────────────────────────────────────────────────────────

  it('SIG-U13: secret diferente do usado para assinar → false', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(verifyMetaWebhookSignature(FAKE_BODY, sig, OTHER_SECRET)).toBe(false);
  });

  // ── Nunca lança exceção ──────────────────────────────────────────────────────

  it('SIG-U10a: não lança com todos os parâmetros undefined', () => {
    expect(() => verifyMetaWebhookSignature(undefined, undefined, undefined)).not.toThrow();
    expect(verifyMetaWebhookSignature(undefined, undefined, undefined)).toBe(false);
  });

  it('SIG-U10b: não lança com rawBody como número', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(() => verifyMetaWebhookSignature(12345, sig, FAKE_SECRET)).not.toThrow();
    expect(verifyMetaWebhookSignature(12345, sig, FAKE_SECRET)).toBe(false);
  });

  it('SIG-U10c: não lança com signature como objeto', () => {
    expect(() => verifyMetaWebhookSignature(FAKE_BODY, { sha256: 'x' }, FAKE_SECRET)).not.toThrow();
    expect(verifyMetaWebhookSignature(FAKE_BODY, { sha256: 'x' }, FAKE_SECRET)).toBe(false);
  });

  it('SIG-U10d: não lança com appSecret como número', () => {
    const sig = makeSignature(FAKE_BODY, FAKE_SECRET);
    expect(() => verifyMetaWebhookSignature(FAKE_BODY, sig, 42)).not.toThrow();
    expect(verifyMetaWebhookSignature(FAKE_BODY, sig, 42)).toBe(false);
  });
});

// =============================================================================
// readRawBody
// =============================================================================

/**
 * Cria um async iterable simulando um Node.js IncomingMessage stream.
 * Útil para testar readRawBody sem uma request HTTP real.
 */
function makeStream(chunks) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          if (i < chunks.length) {
            return Promise.resolve({ value: chunks[i++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

describe('readRawBody', () => {
  it('RRB-01: lê body pequeno corretamente como Buffer', async () => {
    const data = Buffer.from('{"object":"whatsapp_business_account"}');
    const req  = makeStream([data]);
    const result = await readRawBody(req);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.equals(data)).toBe(true);
  });

  it('RRB-02: body exatamente no limite padrão (1 MB) → aceito', async () => {
    const MAX = 1_048_576;
    const data = Buffer.alloc(MAX, 0x61); // 1 MB de 'a'
    const req  = makeStream([data]);
    const result = await readRawBody(req);
    expect(result.length).toBe(MAX);
  });

  it('RRB-03: body 1 byte acima do limite → rejeita com erro', async () => {
    const MAX  = 1_048_576;
    const data = Buffer.alloc(MAX + 1, 0x61);
    const req  = makeStream([data]);
    await expect(readRawBody(req)).rejects.toThrow();
  });

  it('RRB-04: erro de body_too_large tem code=body_too_large', async () => {
    const data = Buffer.alloc(1_048_577, 0x61);
    const req  = makeStream([data]);
    try {
      await readRawBody(req);
      expect.fail('deveria ter lançado');
    } catch (err) {
      expect(err.code).toBe('body_too_large');
    }
  });

  it('RRB-05: múltiplos chunks são concatenados corretamente', async () => {
    const c1 = Buffer.from('hello');
    const c2 = Buffer.from(' ');
    const c3 = Buffer.from('world');
    const req = makeStream([c1, c2, c3]);
    const result = await readRawBody(req);
    expect(result.toString('utf8')).toBe('hello world');
  });

  it('RRB-06: stream vazio → Buffer vazio', async () => {
    const req = makeStream([]);
    const result = await readRawBody(req);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('RRB-07: limite customizado respeitado (100 bytes)', async () => {
    const data = Buffer.alloc(101, 0x61);
    const req  = makeStream([data]);
    await expect(readRawBody(req, 100)).rejects.toMatchObject({ code: 'body_too_large' });
  });
});
