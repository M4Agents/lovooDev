// =============================================================================
// graphClient-download.test.js  (INBOUND-MEDIA-A)
//
// Testes unitários isolados para as primitivas de media download:
//   downloadMediaMetadata  — DM-01..06
//   validateMediaDownloadUrl (via downloadMediaBytes) — DU-07..12
//   downloadMediaBytes     — DB-13..22
//   Segurança              — DS-23..25
//
// Todos os valores são fictícios — sem secrets reais, sem rede, sem banco.
// fetch é mockado via vi.fn() em global.fetch.
// =============================================================================

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  getMetaServerConfig: vi.fn(),
}));

import { getMetaServerConfig }                      from '../config.js';
import { downloadMediaMetadata, downloadMediaBytes } from '../graphClient.js';

// =============================================================================
// Fixtures — fictícios, nunca reais
// =============================================================================

const FAKE_TOKEN    = 'EAAAN_fake_media_inbound_token_not_real_XYZ789';
const FAKE_MEDIA_ID = '123456789012345';
const FAKE_CDN_URL  = 'https://cdn.fbcdn.net/fake-media-fixture.pdf';
const FAKE_CDN_URL2 = 'https://cdn2.fbcdn.net/fake-redir-fixture.pdf';
const FAKE_VERSION  = 'v26.0';

const FAKE_CONFIG = { graphVersion: FAKE_VERSION };

// =============================================================================
// Helpers de mock
// =============================================================================

/** Resposta JSON simples (para downloadMediaMetadata) */
function makeOkJson(body) {
  return { ok: true, status: 200, json: async () => body };
}

/** Resposta de erro HTTP (não-2xx) */
function makeErrorResponse(status) {
  return { ok: false, status, json: async () => ({ error: { code: 190 } }) };
}

/** Resposta com JSON inválido */
function makeJsonError() {
  return { ok: true, status: 200, json: () => Promise.reject(new SyntaxError('bad json')) };
}

/** AbortError simulado (timeout) */
function makeAbortError() {
  const err = new Error('The operation was aborted');
  err.name  = 'AbortError';
  return err;
}

/**
 * Resposta de redirect manual (3xx).
 * Usa objeto plain — não precisa de body/ReadableStream.
 */
function makeRedirectResponse(location, status = 302) {
  return {
    ok:      false,
    status,
    headers: new Headers({ location }),
    body:    null,
  };
}

/**
 * Resposta de download bem-sucedida com body stream real.
 * Necessário para testar res.body.getReader() no downloadMediaBytes.
 *
 * @param {Uint8Array|number[]} data   Bytes do conteúdo
 * @param {object} [opts]
 * @param {number} [opts.contentLength]  Valor do header Content-Length (pode diferir de data.length)
 */
function makeStreamResponse(data, { contentLength } = {}) {
  const bytes   = data instanceof Uint8Array ? data : new Uint8Array(data);
  const headers = new Headers();
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength));
  }
  // Response com ArrayBuffer como body — Node.js 24 expõe via res.body.getReader()
  return new Response(bytes.buffer, { status: 200, headers });
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  getMetaServerConfig.mockReturnValue(FAKE_CONFIG);
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

// =============================================================================
// downloadMediaMetadata
// =============================================================================

describe('downloadMediaMetadata', () => {
  // DM-01: happy path
  it('DM-01: sucesso → retorna url + campos auxiliares normalizados', async () => {
    fetch.mockResolvedValueOnce(makeOkJson({
      url:       FAKE_CDN_URL,
      mime_type: 'application/pdf',
      sha256:    'abc123',
      file_size: 39313,
    }));

    const result = await downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID);

    expect(result).toEqual({
      url:       FAKE_CDN_URL,
      mime_type: 'application/pdf',
      sha256:    'abc123',
      file_size: 39313,
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [calledUrl, calledOpts] = fetch.mock.calls[0];
    expect(calledUrl.toString()).toContain(FAKE_MEDIA_ID);
    expect(calledUrl.toString()).toContain(FAKE_VERSION);
    expect(calledOpts.headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it('DM-01b: campos opcionais ausentes → null', async () => {
    fetch.mockResolvedValueOnce(makeOkJson({ url: FAKE_CDN_URL }));
    const result = await downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID);
    expect(result.mime_type).toBeNull();
    expect(result.sha256).toBeNull();
    expect(result.file_size).toBeNull();
  });

  it('DM-01c: file_size não-número → null', async () => {
    fetch.mockResolvedValueOnce(makeOkJson({ url: FAKE_CDN_URL, file_size: 'grande' }));
    const result = await downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID);
    expect(result.file_size).toBeNull();
  });

  // DM-02: mediaId inválido
  it('DM-02: mediaId não-numérico → media_metadata_invalid (sem fetch)', async () => {
    for (const bad of ['', 'not-numeric', 'wamid.xxx', null, undefined, 123]) {
      await expect(downloadMediaMetadata(FAKE_TOKEN, bad))
        .rejects.toMatchObject({ code: 'media_metadata_invalid' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  // DM-03: HTTP 4xx/5xx
  it('DM-03: HTTP 4xx → media_metadata_failed', async () => {
    fetch.mockResolvedValueOnce(makeErrorResponse(403));
    await expect(downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'media_metadata_failed' });
  });

  it('DM-03b: HTTP 5xx → media_metadata_failed', async () => {
    fetch.mockResolvedValueOnce(makeErrorResponse(500));
    await expect(downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'media_metadata_failed' });
  });

  // DM-04: JSON inválido
  it('DM-04: JSON inválido → media_metadata_invalid', async () => {
    fetch.mockResolvedValueOnce(makeJsonError());
    await expect(downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'media_metadata_invalid' });
  });

  // DM-05: url ausente
  it('DM-05: url ausente no payload → media_metadata_invalid', async () => {
    fetch.mockResolvedValueOnce(makeOkJson({ id: FAKE_MEDIA_ID })); // sem url
    await expect(downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'media_metadata_invalid' });
  });

  it('DM-05b: url string vazia → media_metadata_invalid', async () => {
    fetch.mockResolvedValueOnce(makeOkJson({ url: '' }));
    await expect(downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'media_metadata_invalid' });
  });

  // DM-06: timeout
  it('DM-06: AbortError → media_metadata_timeout', async () => {
    fetch.mockRejectedValueOnce(makeAbortError());
    await expect(downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'media_metadata_timeout' });
  });

  it('DM-06b: erro de rede não-timeout → media_metadata_network', async () => {
    fetch.mockRejectedValueOnce(new TypeError('network failure'));
    await expect(downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID))
      .rejects.toMatchObject({ code: 'media_metadata_network' });
  });
});

// =============================================================================
// URL validation — testada via downloadMediaBytes (validateMediaDownloadUrl é privada)
// Para testes de rejeição: fetch NÃO deve ser chamado.
// =============================================================================

describe('URL validation (via downloadMediaBytes)', () => {
  const VALID_OPTS = { maxBytes: 1000 };

  // DU-07: http: rejeitado
  it('DU-07: protocolo http: → media_download_url_invalid, sem fetch', async () => {
    await expect(
      downloadMediaBytes(FAKE_TOKEN, 'http://cdn.fbcdn.net/file.pdf', VALID_OPTS),
    ).rejects.toMatchObject({ code: 'media_download_url_invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  // DU-08: localhost rejeitado
  it('DU-08: localhost → media_download_url_invalid, sem fetch', async () => {
    for (const bad of [
      'https://localhost/file.pdf',
      'https://LOCALHOST/file.pdf',
    ]) {
      await expect(
        downloadMediaBytes(FAKE_TOKEN, bad, VALID_OPTS),
      ).rejects.toMatchObject({ code: 'media_download_url_invalid' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  // DU-09: IP literal rejeitado
  it('DU-09: IPv4 literal → media_download_url_invalid, sem fetch', async () => {
    for (const bad of [
      'https://127.0.0.1/file.pdf',
      'https://10.0.0.1/file.pdf',
      'https://192.168.1.1/file.pdf',
    ]) {
      await expect(
        downloadMediaBytes(FAKE_TOKEN, bad, VALID_OPTS),
      ).rejects.toMatchObject({ code: 'media_download_url_invalid' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('DU-09b: IPv6 literal → media_download_url_invalid, sem fetch', async () => {
    await expect(
      downloadMediaBytes(FAKE_TOKEN, 'https://[::1]/file.pdf', VALID_OPTS),
    ).rejects.toMatchObject({ code: 'media_download_url_invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  // DU-10: hostname parecido com domínio autorizado mas sem boundary check
  it('DU-10: evilfbcdn.net (sem boundary) → rejeitado, sem fetch', async () => {
    // 'evilfbcdn.net' terminaria com 'fbcdn.net' mas NÃO é subdomínio real
    await expect(
      downloadMediaBytes(FAKE_TOKEN, 'https://evilfbcdn.net/file.pdf', VALID_OPTS),
    ).rejects.toMatchObject({ code: 'media_download_url_invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('DU-10b: evil.fbcdn.net.attacker.com → rejeitado, sem fetch', async () => {
    await expect(
      downloadMediaBytes(FAKE_TOKEN, 'https://evil.fbcdn.net.attacker.com/file.pdf', VALID_OPTS),
    ).rejects.toMatchObject({ code: 'media_download_url_invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('DU-10c: example.com → rejeitado, sem fetch', async () => {
    await expect(
      downloadMediaBytes(FAKE_TOKEN, 'https://example.com/file.pdf', VALID_OPTS),
    ).rejects.toMatchObject({ code: 'media_download_url_invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  // DU-11: username/password embutidos
  it('DU-11: user:pass@fbcdn.net → media_download_url_invalid, sem fetch', async () => {
    for (const bad of [
      'https://user:pass@cdn.fbcdn.net/file.pdf',
      'https://user@cdn.fbcdn.net/file.pdf',
    ]) {
      await expect(
        downloadMediaBytes(FAKE_TOKEN, bad, VALID_OPTS),
      ).rejects.toMatchObject({ code: 'media_download_url_invalid' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  // DU-12: hostname autorizado aceito
  it('DU-12: cdn.fbcdn.net → aceito (validation passes, fetch chamado)', async () => {
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF magic bytes
    fetch.mockResolvedValueOnce(makeStreamResponse(data));

    const result = await downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, VALID_OPTS);
    expect(result).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('DU-12b: subdomínio fbsbx.com → aceito', async () => {
    const data = new Uint8Array([1, 2, 3]);
    fetch.mockResolvedValueOnce(makeStreamResponse(data));

    await expect(
      downloadMediaBytes(FAKE_TOKEN, 'https://cdn.fbsbx.com/file.pdf', VALID_OPTS),
    ).resolves.toBeInstanceOf(Blob);
  });

  it('DU-12c: fbcdn.net sem subdomínio → aceito', async () => {
    const data = new Uint8Array([1]);
    fetch.mockResolvedValueOnce(makeStreamResponse(data));

    await expect(
      downloadMediaBytes(FAKE_TOKEN, 'https://fbcdn.net/file.pdf', VALID_OPTS),
    ).resolves.toBeInstanceOf(Blob);
  });
});

// =============================================================================
// downloadMediaBytes
// =============================================================================

describe('downloadMediaBytes', () => {
  // DB-13: sucesso
  it('DB-13: sucesso → Blob com tamanho correto', async () => {
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    fetch.mockResolvedValueOnce(makeStreamResponse(data));

    const result = await downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 });

    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBe(5);

    const [, opts] = fetch.mock.calls[0];
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(opts.redirect).toBe('manual');
  });

  // DB-14: Content-Length > maxBytes → abort rápido (antes de ler stream)
  it('DB-14: Content-Length > maxBytes → media_download_too_large (sem ler bytes)', async () => {
    // Corpo vazio — não deve chegar a ser lido
    fetch.mockResolvedValueOnce(makeStreamResponse(new Uint8Array(0), { contentLength: 2000 }));

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'media_download_too_large' });
  });

  // DB-15: sem Content-Length, bytes <= limite → sucesso
  it('DB-15: sem Content-Length + bytes <= maxBytes → retorna Blob', async () => {
    const data = new Uint8Array(100);
    fetch.mockResolvedValueOnce(makeStreamResponse(data)); // sem contentLength

    const result = await downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 200 });
    expect(result.size).toBe(100);
  });

  // DB-16: sem Content-Length, stream excede limite
  it('DB-16: sem Content-Length + stream > maxBytes → media_download_too_large', async () => {
    const data = new Uint8Array(300);
    fetch.mockResolvedValueOnce(makeStreamResponse(data)); // sem contentLength

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 100 }),
    ).rejects.toMatchObject({ code: 'media_download_too_large' });
  });

  // DB-17: Content-Length mentiroso + stream excede
  it('DB-17: Content-Length<actual + stream > maxBytes → media_download_too_large', async () => {
    // Content-Length=50 (mente); corpo real=300 bytes; maxBytes=200
    // Check CL: 50 <= 200 → passa
    // Check stream: 300 > 200 → rejeita
    const data = new Uint8Array(300);
    fetch.mockResolvedValueOnce(makeStreamResponse(data, { contentLength: 50 }));

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 200 }),
    ).rejects.toMatchObject({ code: 'media_download_too_large' });
  });

  // DB-18: HTTP não-2xx
  it('DB-18: HTTP 4xx → media_download_failed', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers() });

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'media_download_failed' });
  });

  it('DB-18b: HTTP 5xx → media_download_failed', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers() });

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'media_download_failed' });
  });

  // DB-19: timeout
  it('DB-19: AbortError → media_download_timeout', async () => {
    fetch.mockRejectedValueOnce(makeAbortError());

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'media_download_timeout' });
  });

  it('DB-19b: erro de rede não-timeout → media_download_failed', async () => {
    fetch.mockRejectedValueOnce(new TypeError('network error'));

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'media_download_failed' });
  });

  // DB-20: redirect autorizado seguido → sucesso
  it('DB-20: redirect 302 para host autorizado → seguido, retorna Blob', async () => {
    const data = new Uint8Array([1, 2, 3]);
    fetch
      .mockResolvedValueOnce(makeRedirectResponse(FAKE_CDN_URL2))   // 302 → fbcdn.net
      .mockResolvedValueOnce(makeStreamResponse(data));              // 200 OK

    const result = await downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 });

    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(2);
    // Segunda chamada deve ser para o URL do redirect
    expect(fetch.mock.calls[1][0]).toBe(FAKE_CDN_URL2);
    // Authorization enviada também para o URL do redirect (host autorizado)
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(fetch.mock.calls[1][1].redirect).toBe('manual');
  });

  // DB-21: redirect para host não autorizado → rejeitado
  it('DB-21: redirect 302 para host não autorizado → media_download_url_invalid', async () => {
    fetch.mockResolvedValueOnce(makeRedirectResponse('https://evil.com/steal.pdf'));

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'media_download_url_invalid' });

    // Apenas a primeira requisição (URL autorizada) deve ter ocorrido
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // DB-22: muitos redirects → rejeitado
  it('DB-22: excede MAX_MEDIA_REDIRECTS (3) → media_download_failed', async () => {
    // Cada chamada retorna redirect para host autorizado
    const redir = makeRedirectResponse('https://cdn.fbcdn.net/redir.pdf');
    fetch.mockResolvedValue(redir);

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ code: 'media_download_failed' });

    // MAX_MEDIA_REDIRECTS=3: 1 inicial + 3 seguidos (o 4º dispara o limite)
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  // maxBytes inválido → falha antes de fetch
  it('DB-extra: maxBytes inválido → media_download_failed sem fetch', async () => {
    for (const bad of [0, -1, 1.5, 'grande', null, undefined, MAX_MEDIA_BYTES_CEILING + 1]) {
      await expect(
        downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: bad }),
      ).rejects.toMatchObject({ code: 'media_download_failed' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

// Helper para obter o valor de MAX_MEDIA_BYTES_CEILING (30 MB) sem expô-lo diretamente
const MAX_MEDIA_BYTES_CEILING = 30 * 1024 * 1024;

// =============================================================================
// Segurança
// =============================================================================

describe('Segurança — token e URL nunca expostos em erros', () => {
  // DS-23: Authorization não encaminhado para host não autorizado
  it('DS-23: redirect para host não autorizado — segundo fetch nunca ocorre', async () => {
    fetch.mockResolvedValueOnce(makeRedirectResponse('https://evil.attacker.com/steal.pdf'));

    await expect(
      downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 }),
    ).rejects.toHaveProperty('code', 'media_download_url_invalid');

    // evil.attacker.com nunca recebeu request — validação ocorre antes do fetch
    expect(fetch).toHaveBeenCalledTimes(1);
    // Única chamada foi para o URL autorizado inicial
    expect(fetch.mock.calls[0][0]).toBe(FAKE_CDN_URL);
  });

  // DS-24: nenhum erro inclui token
  it('DS-24: erro HTTP de download → mensagem não contém token', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() });

    try {
      await downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 });
      expect.fail('deveria ter lançado');
    } catch (err) {
      expect(err.message).not.toContain(FAKE_TOKEN);
      if (err.code) expect(String(err.code)).not.toContain(FAKE_TOKEN);
    }
  });

  it('DS-24b: erro de metadata → mensagem não contém token', async () => {
    fetch.mockResolvedValueOnce(makeErrorResponse(403));

    try {
      await downloadMediaMetadata(FAKE_TOKEN, FAKE_MEDIA_ID);
      expect.fail('deveria ter lançado');
    } catch (err) {
      expect(err.message).not.toContain(FAKE_TOKEN);
    }
  });

  // DS-25: nenhum erro inclui URL temporária
  it('DS-25: erro de download → mensagem não contém URL temporária', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() });

    try {
      await downloadMediaBytes(FAKE_TOKEN, FAKE_CDN_URL, { maxBytes: 1000 });
      expect.fail('deveria ter lançado');
    } catch (err) {
      expect(err.message).not.toContain(FAKE_CDN_URL);
      expect(err.message).not.toContain('fbcdn.net');
    }
  });

  it('DS-25b: URL inválida → mensagem não contém rawUrl', async () => {
    const evilUrl = 'https://evil.com/sensitive-path?token=abc';

    try {
      await downloadMediaBytes(FAKE_TOKEN, evilUrl, { maxBytes: 1000 });
      expect.fail('deveria ter lançado');
    } catch (err) {
      expect(err.message).not.toContain('evil.com');
      expect(err.message).not.toContain('sensitive-path');
      expect(err.message).not.toContain('token=abc');
    }
  });
});
