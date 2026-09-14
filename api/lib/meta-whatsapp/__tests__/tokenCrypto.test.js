// =============================================================================
// tokenCrypto.test.js
//
// Testes unitários para api/lib/meta-whatsapp/tokenCrypto.js
// Todos os testes usam chave e plaintext fictícios — sem secrets reais.
//
// COBERTURA:
//   TC-A   Round-trip encrypt → decrypt
//   TC-B   Ciphertext começa com "v1:"
//   TC-C   IVs aleatórios produzem ciphertexts distintos
//   TC-D   Ambos os ciphertexts descriptografam corretamente
//   TC-E   ENV ausente → falha em encrypt e decrypt
//   TC-F   ENV vazia → falha
//   TC-G   ENV < 64 hex chars → falha
//   TC-H   ENV > 64 hex chars → falha
//   TC-I   ENV com chars não-hex → falha
//   TC-J   Versão desconhecida → falha genérica (sem refletir input)
//   TC-K   Input sem prefixo/versionamento → falha
//   TC-L   Payload base64 resultando em comprimento insuficiente → falha
//   TC-M   Payload curto demais → falha
//   TC-N   authTag adulterada → falha
//   TC-O   Ciphertext adulterado → falha
//   TC-P   Chave diferente → falha na descriptografia
//   TC-Q   Plaintext vazio/inválido → falha em encrypt
//   TC-R   Unicode/acentos → round-trip correto
//   TC-S   Layout estrutural do payload (IV || authTag || ciphertext)
//   TC-T   Base64 estrito — chars inválidos, padding, não-canônico, round-trip
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptMetaToken, decryptMetaToken } from '../tokenCrypto.js';

// =============================================================================
// Fixtures — chaves fictícias, nunca secrets reais
// =============================================================================

// 64 chars hex = 32 bytes, repetível para testes
const VALID_KEY_HEX = 'a'.repeat(64); // aaaa...aaaa (64 chars)
const ALT_KEY_HEX   = 'b'.repeat(64); // bbbb...bbbb (chave diferente)

// =============================================================================
// Setup / Teardown
// =============================================================================

let originalEnv;

beforeEach(() => {
  // Salva a ENV atual para restaurar após cada teste
  originalEnv = process.env.META_TOKEN_ENC_KEY_V1;
  process.env.META_TOKEN_ENC_KEY_V1 = VALID_KEY_HEX;
});

afterEach(() => {
  // Restaura — não contamina outras suites
  if (originalEnv === undefined) {
    delete process.env.META_TOKEN_ENC_KEY_V1;
  } else {
    process.env.META_TOKEN_ENC_KEY_V1 = originalEnv;
  }
});

// =============================================================================
// Testes
// =============================================================================

describe('tokenCrypto — Meta WhatsApp', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // TC-A: Round-trip encrypt → decrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-A: round-trip encrypt → decrypt', () => {
    it('decrypt(encrypt(plaintext)) === plaintext', () => {
      const plaintext = 'EAAxxxxxxx_meta_access_token_fixture';

      const encrypted = encryptMetaToken(plaintext);
      const decrypted = decryptMetaToken(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-B: Ciphertext começa com "v1:"
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-B: formato do ciphertext', () => {
    it('resultado de encrypt começa com "v1:"', () => {
      const encrypted = encryptMetaToken('token-fixture');
      expect(encrypted).toMatch(/^v1:/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-C: IVs aleatórios — ciphertexts distintos
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-C: IVs aleatórios produzem ciphertexts distintos', () => {
    it('encrypt do mesmo plaintext duas vezes retorna strings diferentes', () => {
      const plaintext = 'token-fixture';

      const enc1 = encryptMetaToken(plaintext);
      const enc2 = encryptMetaToken(plaintext);

      expect(enc1).not.toBe(enc2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-D: Ambos os ciphertexts descriptografam corretamente
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-D: ambos os ciphertexts distintos descriptografam para o mesmo plaintext', () => {
    it('decrypt dos dois ciphertexts retorna o plaintext original', () => {
      const plaintext = 'token-fixture';

      const enc1 = encryptMetaToken(plaintext);
      const enc2 = encryptMetaToken(plaintext);

      expect(decryptMetaToken(enc1)).toBe(plaintext);
      expect(decryptMetaToken(enc2)).toBe(plaintext);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-E: ENV ausente → falha em encrypt e decrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-E: ENV ausente', () => {
    it('encrypt lança erro quando META_TOKEN_ENC_KEY_V1 está ausente', () => {
      delete process.env.META_TOKEN_ENC_KEY_V1;

      expect(() => encryptMetaToken('token')).toThrow('META_TOKEN_ENC_KEY_V1 não configurada');
    });

    it('decrypt lança erro quando META_TOKEN_ENC_KEY_V1 está ausente', () => {
      const encrypted = encryptMetaToken('token');

      delete process.env.META_TOKEN_ENC_KEY_V1;

      expect(() => decryptMetaToken(encrypted)).toThrow('META_TOKEN_ENC_KEY_V1 não configurada');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-F: ENV vazia → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-F: ENV vazia', () => {
    it('encrypt lança erro quando META_TOKEN_ENC_KEY_V1 é string vazia', () => {
      process.env.META_TOKEN_ENC_KEY_V1 = '';

      expect(() => encryptMetaToken('token')).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-G: ENV < 64 hex chars → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-G: ENV com menos de 64 hex chars', () => {
    it('encrypt lança erro com 62 chars hex (31 bytes)', () => {
      process.env.META_TOKEN_ENC_KEY_V1 = 'a'.repeat(62);

      expect(() => encryptMetaToken('token')).toThrow();
    });

    it('encrypt lança erro com apenas 1 char hex', () => {
      process.env.META_TOKEN_ENC_KEY_V1 = 'a';

      expect(() => encryptMetaToken('token')).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-H: ENV > 64 hex chars → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-H: ENV com mais de 64 hex chars', () => {
    it('encrypt lança erro com 66 chars hex', () => {
      process.env.META_TOKEN_ENC_KEY_V1 = 'a'.repeat(66);

      expect(() => encryptMetaToken('token')).toThrow();
    });

    it('encrypt lança erro com 65 chars hex (caso silencioso sem regex)', () => {
      // 65 chars hex → Buffer de 32 bytes (ignora o 65º char ímpar)
      // A regex HEX_64_RE rejeita explicitamente este caso
      process.env.META_TOKEN_ENC_KEY_V1 = 'a'.repeat(65);

      expect(() => encryptMetaToken('token')).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-I: ENV com chars não-hex → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-I: ENV com chars não-hex', () => {
    it('encrypt lança erro quando ENV contém chars não-hex (64 chars mas inválidos)', () => {
      process.env.META_TOKEN_ENC_KEY_V1 = 'g'.repeat(64);

      expect(() => encryptMetaToken('token')).toThrow();
    });

    it('encrypt lança erro quando ENV mistura chars válidos e inválidos', () => {
      process.env.META_TOKEN_ENC_KEY_V1 = 'a'.repeat(63) + 'z';

      expect(() => encryptMetaToken('token')).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-J: Versão desconhecida → falha genérica
  //
  // A mensagem de erro NÃO deve refletir o valor fornecido pelo caller.
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-J: versão de criptografia desconhecida', () => {
    it('decrypt lança erro genérico para prefixo "v2:" e não expõe "v2" na mensagem', () => {
      let errorMessage = '';
      try {
        decryptMetaToken('v2:qualquer-payload');
      } catch (err) {
        errorMessage = err.message;
      }
      expect(errorMessage).toMatch(/Versão de criptografia desconhecida/);
      // O valor "v2" do caller não deve aparecer na mensagem
      expect(errorMessage).not.toContain('v2');
    });

    it('decrypt lança erro genérico para prefixo "v99:" e não expõe "v99" na mensagem', () => {
      let errorMessage = '';
      try {
        decryptMetaToken('v99:qualquer-payload');
      } catch (err) {
        errorMessage = err.message;
      }
      expect(errorMessage).toMatch(/Versão de criptografia desconhecida/);
      expect(errorMessage).not.toContain('v99');
    });

    it('decrypt lança erro genérico para prefixo "vX:" e não expõe "X" na mensagem', () => {
      let errorMessage = '';
      try {
        decryptMetaToken('vX:qualquer-payload');
      } catch (err) {
        errorMessage = err.message;
      }
      expect(errorMessage).toMatch(/Versão de criptografia desconhecida/);
      expect(errorMessage).not.toContain('X:');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-K: Input sem prefixo/versionamento → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-K: input sem formato esperado', () => {
    it('decrypt lança erro para string sem ":"', () => {
      expect(() => decryptMetaToken('semcolondaqui')).toThrow('Formato de token desconhecido');
    });

    it('decrypt lança erro para string sem ":" (só letras)', () => {
      expect(() => decryptMetaToken('abc')).toThrow();
    });

    it('decrypt lança erro para tipo não-string', () => {
      expect(() => decryptMetaToken(null)).toThrow('Valor inválido para descriptografia');
      expect(() => decryptMetaToken(undefined)).toThrow('Valor inválido para descriptografia');
      expect(() => decryptMetaToken(123)).toThrow('Valor inválido para descriptografia');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-L: Payload base64 resultando em comprimento insuficiente → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-L: payload base64 insuficiente', () => {
    it('decrypt lança erro para base64 que decodifica em 28 bytes (< 29)', () => {
      // 28 bytes = IV(12) + authTag(16) — sem ciphertext
      const shortPayload = Buffer.alloc(28).toString('base64');
      expect(() => decryptMetaToken(`v1:${shortPayload}`)).toThrow('Falha na descriptografia do token');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-M: Payload curto demais → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-M: payload curto demais', () => {
    it('decrypt lança erro para payload de 1 byte', () => {
      const tiny = Buffer.alloc(1).toString('base64');
      expect(() => decryptMetaToken(`v1:${tiny}`)).toThrow('Falha na descriptografia do token');
    });

    it('decrypt lança erro para payload completamente vazio após v1:', () => {
      // Base64 de buffer vazio = "" → 0 bytes → abaixo do mínimo
      expect(() => decryptMetaToken('v1:')).toThrow('Falha na descriptografia do token');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-N: authTag adulterada → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-N: authTag adulterada', () => {
    it('decrypt lança erro quando authTag é modificada', () => {
      const encrypted = encryptMetaToken('token-fixture');
      const colonIdx  = encrypted.indexOf(':');
      const combined  = Buffer.from(encrypted.slice(colonIdx + 1), 'base64');

      // Inverte todos os bits do primeiro byte da authTag (byte 12)
      combined[12] ^= 0xff;

      const tampered = `v1:${combined.toString('base64')}`;
      expect(() => decryptMetaToken(tampered)).toThrow('Falha na descriptografia do token');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-O: Ciphertext adulterado → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-O: ciphertext adulterado', () => {
    it('decrypt lança erro quando ciphertext é modificado', () => {
      const encrypted = encryptMetaToken('token-fixture');
      const colonIdx  = encrypted.indexOf(':');
      const combined  = Buffer.from(encrypted.slice(colonIdx + 1), 'base64');

      // Inverte último byte (ciphertext começa no byte 28)
      combined[combined.length - 1] ^= 0xff;

      const tampered = `v1:${combined.toString('base64')}`;
      expect(() => decryptMetaToken(tampered)).toThrow('Falha na descriptografia do token');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-P: Chave diferente da usada na criptografia → falha
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-P: chave diferente → falha na descriptografia', () => {
    it('decrypt com chave B falha para ciphertext produzido com chave A', () => {
      const encrypted = encryptMetaToken('token-fixture');

      process.env.META_TOKEN_ENC_KEY_V1 = ALT_KEY_HEX;

      expect(() => decryptMetaToken(encrypted)).toThrow('Falha na descriptografia do token');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-Q: Plaintext vazio/inválido → falha em encrypt
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-Q: plaintext vazio ou inválido', () => {
    it('encrypt lança erro para string vazia', () => {
      expect(() => encryptMetaToken('')).toThrow('Token inválido para criptografia');
    });

    it('encrypt lança erro para null', () => {
      expect(() => encryptMetaToken(null)).toThrow('Token inválido para criptografia');
    });

    it('encrypt lança erro para undefined', () => {
      expect(() => encryptMetaToken(undefined)).toThrow('Token inválido para criptografia');
    });

    it('encrypt lança erro para número', () => {
      expect(() => encryptMetaToken(12345)).toThrow('Token inválido para criptografia');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-R: Unicode / acentos → round-trip correto
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-R: Unicode e acentos', () => {
    it('round-trip correto para plaintext com caracteres UTF-8 acentuados', () => {
      const plaintext = 'token_com_açúcar_ñoño_🔑_émoji';

      const encrypted = encryptMetaToken(plaintext);
      const decrypted = decryptMetaToken(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('round-trip correto para plaintext com caracteres CJK', () => {
      const plaintext = 'token_中文_日本語_한국어_fixture';

      const encrypted = encryptMetaToken(plaintext);
      const decrypted = decryptMetaToken(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-S: Layout estrutural do payload
  //
  // Valida que o formato persistido é exatamente:
  //   prefix = "v1"
  //   payload decodificado:
  //     [0..11]  = IV (12 bytes)
  //     [12..27] = authTag (16 bytes)
  //     [28..]   = ciphertext (≥ 1 byte)
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-S: layout estrutural do payload persistido', () => {
    it('prefixo é "v1"', () => {
      const encrypted = encryptMetaToken('token-layout-fixture');
      const [prefix]  = encrypted.split(':');
      expect(prefix).toBe('v1');
    });

    it('payload base64 decodifica para ≥ 29 bytes (12 IV + 16 authTag + ≥1 ciphertext)', () => {
      const encrypted = encryptMetaToken('x');
      const colonIdx  = encrypted.indexOf(':');
      const combined  = Buffer.from(encrypted.slice(colonIdx + 1), 'base64');

      expect(combined.length).toBeGreaterThanOrEqual(12 + 16 + 1);
    });

    it('bytes [0..11] correspondem ao IV de 12 bytes', () => {
      const encrypted = encryptMetaToken('token-layout-fixture');
      const colonIdx  = encrypted.indexOf(':');
      const combined  = Buffer.from(encrypted.slice(colonIdx + 1), 'base64');

      const iv = combined.subarray(0, 12);
      expect(iv.length).toBe(12);
    });

    it('bytes [12..27] correspondem à authTag de 16 bytes', () => {
      const encrypted = encryptMetaToken('token-layout-fixture');
      const colonIdx  = encrypted.indexOf(':');
      const combined  = Buffer.from(encrypted.slice(colonIdx + 1), 'base64');

      const authTag = combined.subarray(12, 28);
      expect(authTag.length).toBe(16);
    });

    it('bytes [28..] correspondem ao ciphertext (≥ 1 byte para qualquer plaintext não-vazio)', () => {
      const encrypted  = encryptMetaToken('x');
      const colonIdx   = encrypted.indexOf(':');
      const combined   = Buffer.from(encrypted.slice(colonIdx + 1), 'base64');

      const ciphertext = combined.subarray(28);
      expect(ciphertext.length).toBeGreaterThanOrEqual(1);
    });

    it('formato total: "v1:" + base64 canônico sem quebras', () => {
      const encrypted = encryptMetaToken('token-layout-fixture');
      expect(encrypted).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-T: Base64 estrito
  //
  // Valida que decryptMetaToken rejeita explicitamente payloads Base64
  // com sintaxe inválida, padding malformado e representações não canônicas
  // — inputs que Buffer.from(..., 'base64') aceitaria silenciosamente.
  //
  // Estratégia: partir de um ciphertext v1 real produzido por encrypt (A, B)
  //             ou construir payloads sintéticos (C-G) para casos isolados.
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-T: validação Base64 estrita', () => {

    // ── TC-T-A: Caractere inválido inserido no meio do Base64 ──────────────
    it('TC-T-A: char inválido ("*") no meio do payload → falha genérica', () => {
      const encrypted = encryptMetaToken('token-fixture');
      const colonIdx  = encrypted.indexOf(':');
      const b64       = encrypted.slice(colonIdx + 1);

      // Substitui o 5º caractere por "*" (inválido em Base64)
      const mid     = 4;
      const tampered = b64.slice(0, mid) + '*' + b64.slice(mid + 1);

      expect(() => decryptMetaToken(`v1:${tampered}`))
        .toThrow('Falha na descriptografia do token');
    });

    // ── TC-T-B: Whitespace inserido no Base64 ──────────────────────────────
    it('TC-T-B: espaço inserido no meio do payload → falha genérica', () => {
      const encrypted = encryptMetaToken('token-fixture');
      const colonIdx  = encrypted.indexOf(':');
      const b64       = encrypted.slice(colonIdx + 1);

      // Substitui o 4º caractere por espaço
      const mid     = 3;
      const tampered = b64.slice(0, mid) + ' ' + b64.slice(mid + 1);

      expect(() => decryptMetaToken(`v1:${tampered}`))
        .toThrow('Falha na descriptografia do token');
    });

    it('TC-T-B: tab inserido no payload → falha genérica', () => {
      const encrypted = encryptMetaToken('token-fixture');
      const colonIdx  = encrypted.indexOf(':');
      const b64       = encrypted.slice(colonIdx + 1);

      const tampered = b64.slice(0, 4) + '\t' + b64.slice(5);

      expect(() => decryptMetaToken(`v1:${tampered}`))
        .toThrow('Falha na descriptografia do token');
    });

    // ── TC-T-C: "=" no meio do payload ────────────────────────────────────
    it('TC-T-C: "=" no meio do Base64 (ex: "AAAA=AAAA") → falha genérica', () => {
      // "=" só pode aparecer no final; no meio é sempre inválido
      expect(() => decryptMetaToken('v1:AAAA=AAAA'))
        .toThrow('Falha na descriptografia do token');
    });

    it('TC-T-C: "AA=A" (= fora do padding) → falha genérica', () => {
      expect(() => decryptMetaToken('v1:AA=A'))
        .toThrow('Falha na descriptografia do token');
    });

    // ── TC-T-D: Padding excessivo ──────────────────────────────────────────
    it('TC-T-D: "===" padding triplo → falha genérica', () => {
      // Nenhum bloco Base64 válido precisa de 3 "="
      expect(() => decryptMetaToken('v1:AAAA==='))
        .toThrow('Falha na descriptografia do token');
    });

    it('TC-T-D: "====" padding quádruplo → falha genérica', () => {
      expect(() => decryptMetaToken('v1:AAAA===='))
        .toThrow('Falha na descriptografia do token');
    });

    // ── TC-T-E: Dados após padding ────────────────────────────────────────
    it('TC-T-E: "AA==BB" — conteúdo após padding → falha genérica', () => {
      expect(() => decryptMetaToken('v1:AA==BB'))
        .toThrow('Falha na descriptografia do token');
    });

    it('TC-T-E: "AAAA==BBBB" — conteúdo após padding falso → falha genérica', () => {
      // "AAAA" é um grupo completo; "==" não é um início válido de grupo
      expect(() => decryptMetaToken('v1:AAAA==BBBB'))
        .toThrow('Falha na descriptografia do token');
    });

    // ── TC-T-F: Comprimento Base64 estruturalmente inválido ───────────────
    it('TC-T-F: string de 1 char ("A") → length % 4 === 1, inválido', () => {
      // Length 1 não corresponde a nenhum grupo Base64 válido
      expect(() => decryptMetaToken('v1:A'))
        .toThrow('Falha na descriptografia do token');
    });

    it('TC-T-F: string de 5 chars ("AAAAA") → length % 4 === 1, inválido', () => {
      expect(() => decryptMetaToken('v1:AAAAA'))
        .toThrow('Falha na descriptografia do token');
    });

    it('TC-T-F: string de 2 chars sem padding ("AA") → inválido (falta "==")', () => {
      // Base64 canônico requer "AA==" para 1 byte, não "AA" nu
      expect(() => decryptMetaToken('v1:AA'))
        .toThrow('Falha na descriptografia do token');
    });

    // ── TC-T-G: Representação não canônica aceita por Buffer.from ─────────
    // Buffer.from('AB==', 'base64') e Buffer.from('AA==', 'base64') decodificam
    // para o mesmo byte (0x00) porque o bit inferior do 2º char de padding é
    // ignorado pelo decoder nativo do Node.js.
    // O round-trip canônico detecta que "AB==" ≠ decoded.toString('base64')="AA=="
    // e rejeita — sem depender da falha criptográfica posterior.
    it('TC-T-G: "AB==" não canônico (mesmo byte que "AA==") → falha genérica por round-trip', () => {
      // Verifica premissa: Buffer.from aceita silenciosamente
      const decoded = Buffer.from('AB==', 'base64');
      expect(decoded.length).toBe(1); // aceito pelo Node, decodifica 1 byte
      expect(decoded.toString('base64')).toBe('AA=='); // round-trip: canônico diferente

      // Helper deve rejeitar
      expect(() => decryptMetaToken('v1:AB=='))
        .toThrow('Falha na descriptografia do token');
    });

    // ── TC-T-H: Base64 canônico do encrypt continua funcionando ──────────
    it('TC-T-H: ciphertext produzido por encrypt passa pela validação e descriptografa', () => {
      const plaintext = 'token-canonico-fixture';

      const encrypted = encryptMetaToken(plaintext);
      // Não deve lançar — Base64 canônico produzido por combined.toString('base64')
      const decrypted = decryptMetaToken(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

});
