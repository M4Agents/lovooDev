// =============================================================================
// graphClient.test.js
//
// Testes unitários para api/lib/meta-whatsapp/graphClient.js
// Todos os valores são fictícios — sem secrets reais, sem rede, sem banco.
//
// COBERTURA:
//   exchangeCodeForToken:
//     TC-E01 … TC-E22
//
//   listWabaPhoneNumbers:
//     TC-L01 … TC-L32
//
//   Paginação (dentro de listWabaPhoneNumbers):
//     TC-P01 … TC-P12
//
//   Segurança de erros:
//     TC-S01 … TC-S05
// =============================================================================

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock do módulo de config — permite injetar graphVersion e appSecret fictícios
vi.mock('../config.js', () => ({
  getMetaServerConfig: vi.fn(),
}));

import { getMetaServerConfig } from '../config.js';
import { exchangeCodeForToken, listWabaPhoneNumbers } from '../graphClient.js';

// =============================================================================
// Fixtures — todos fictícios, nunca reais
// =============================================================================

const FAKE_APP_ID    = '111111111111111';
const FAKE_SECRET    = 'fake_app_secret_fixture_not_real';
const FAKE_CONFIG_ID = '222222222222222';
const FAKE_VERSION   = 'v26.0';

const FAKE_CONFIG = {
  appId:        FAKE_APP_ID,
  appSecret:    FAKE_SECRET,
  configId:     FAKE_CONFIG_ID,
  graphVersion: FAKE_VERSION,
};

const FAKE_CODE      = 'FAKE_CODE_NOT_REAL_ABC123XYZ';
const FAKE_TOKEN     = 'EAAAN_fake_business_token_not_real_XYZ789';
const FAKE_WABA      = '102290129340398';
const EVIL_URL       = 'https://evil.example/steal-token';

const PHONE_1 = { id: '1906385232743451', display_phone_number: '+1 631-555-5555', verified_name: 'Jasper Market' };
const PHONE_2 = { id: '1913623884432103', display_phone_number: '+1 631-555-5556', verified_name: 'Jasper Ice Cream' };

// =============================================================================
// Helpers de mock de resposta HTTP
// =============================================================================

function makeOkResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function makeErrorResponse(status) {
  return { ok: false, status, json: async () => ({ error: { code: 190, message: 'Fake error' } }) };
}

function makeJsonErrorResponse() {
  return { ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token')) };
}

function makePhoneListResponse(phones, pagingNext, cursorAfter) {
  const paging = {};
  if (cursorAfter !== undefined) {
    paging.cursors = { before: 'BEFORE_CUR', after: cursorAfter };
  }
  if (pagingNext !== undefined) {
    paging.next = pagingNext;
  }
  return makeOkResponse({ data: phones, paging });
}

function makeAbortError() {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
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
// exchangeCodeForToken
// =============================================================================

describe('exchangeCodeForToken', () => {
  // ── Sucesso ──────────────────────────────────────────────────────────────────

  it('TC-E01: 200 com access_token → resolve { accessToken }', async () => {
    fetch.mockResolvedValue(makeOkResponse({ access_token: FAKE_TOKEN }));
    const result = await exchangeCodeForToken(FAKE_CODE);
    expect(result).toEqual({ accessToken: FAKE_TOKEN });
  });

  it('TC-E13: retorna somente { accessToken } — sem token_type, expires_in ou payload bruto', async () => {
    fetch.mockResolvedValue(makeOkResponse({ access_token: FAKE_TOKEN, token_type: 'bearer', expires_in: 0 }));
    const result = await exchangeCodeForToken(FAKE_CODE);
    expect(Object.keys(result)).toEqual(['accessToken']);
  });

  // ── Falhas de token ──────────────────────────────────────────────────────────

  it('TC-E02: 200 sem access_token → code_exchange_no_token', async () => {
    fetch.mockResolvedValue(makeOkResponse({ other_field: 'value' }));
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toMatchObject({ code: 'code_exchange_no_token' });
  });

  it('TC-E03: 200 com access_token vazio → code_exchange_no_token', async () => {
    fetch.mockResolvedValue(makeOkResponse({ access_token: '' }));
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toMatchObject({ code: 'code_exchange_no_token' });
  });

  // ── Falhas HTTP ──────────────────────────────────────────────────────────────

  it('TC-E04: HTTP 400 → code_exchange_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toMatchObject({ code: 'code_exchange_failed' });
  });

  it('TC-E05: HTTP 500 → code_exchange_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(500));
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toMatchObject({ code: 'code_exchange_failed' });
  });

  // ── Falhas de rede ───────────────────────────────────────────────────────────

  it('TC-E06: AbortError → code_exchange_network_error', async () => {
    fetch.mockRejectedValue(makeAbortError());
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toMatchObject({ code: 'code_exchange_network_error' });
  });

  it('TC-E07: TypeError de rede → code_exchange_network_error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toMatchObject({ code: 'code_exchange_network_error' });
  });

  it('TC-E08: JSON inválido na resposta → code_exchange_failed', async () => {
    fetch.mockResolvedValue(makeJsonErrorResponse());
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toMatchObject({ code: 'code_exchange_failed' });
  });

  // ── Validação de input ───────────────────────────────────────────────────────

  it('TC-E09: code vazio → falha antes do fetch', async () => {
    await expect(exchangeCodeForToken('')).rejects.toMatchObject({ code: 'code_exchange_failed' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-E10: code null → falha antes do fetch', async () => {
    await expect(exchangeCodeForToken(null)).rejects.toMatchObject({ code: 'code_exchange_failed' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-E11: code não-string (number) → falha antes do fetch', async () => {
    await expect(exchangeCodeForToken(12345)).rejects.toMatchObject({ code: 'code_exchange_failed' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-E12: fetch não é chamado em input inválido', async () => {
    try { await exchangeCodeForToken(undefined); } catch { /* expected */ }
    expect(fetch).not.toHaveBeenCalled();
  });

  // ── Parâmetros da request ────────────────────────────────────────────────────

  it('TC-E14+E15: redirect_uri e grant_type NÃO são enviados', async () => {
    fetch.mockResolvedValue(makeOkResponse({ access_token: FAKE_TOKEN }));
    await exchangeCodeForToken(FAKE_CODE);
    const callUrl = fetch.mock.calls[0][0];
    expect(callUrl.searchParams.has('redirect_uri')).toBe(false);
    expect(callUrl.searchParams.has('grant_type')).toBe(false);
  });

  it('TC-E16+E17+E18: client_id, client_secret e code são enviados como query params', async () => {
    fetch.mockResolvedValue(makeOkResponse({ access_token: FAKE_TOKEN }));
    await exchangeCodeForToken(FAKE_CODE);
    const callUrl = fetch.mock.calls[0][0];
    expect(callUrl.searchParams.get('client_id')).toBe(FAKE_APP_ID);
    expect(callUrl.searchParams.get('client_secret')).toBe(FAKE_SECRET);
    expect(callUrl.searchParams.get('code')).toBe(FAKE_CODE);
  });

  it('TC-E19: graphVersion vindo de getMetaServerConfig', async () => {
    getMetaServerConfig.mockReturnValue({ ...FAKE_CONFIG, graphVersion: 'v99.0' });
    fetch.mockResolvedValue(makeOkResponse({ access_token: FAKE_TOKEN }));
    await exchangeCodeForToken(FAKE_CODE);
    const callUrl = fetch.mock.calls[0][0];
    expect(callUrl.toString()).toContain('/v99.0/');
  });

  // ── Segurança de erros ───────────────────────────────────────────────────────

  it('TC-E20: mensagem de erro não contém o code', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toSatisfy(
      (err) => !err.message.includes(FAKE_CODE),
    );
  });

  it('TC-E21: mensagem de erro não contém appSecret', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toSatisfy(
      (err) => !err.message.includes(FAKE_SECRET),
    );
  });

  it('TC-E22: mensagem de erro não contém o token', async () => {
    fetch.mockResolvedValue(makeOkResponse({ access_token: '' }));
    await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toSatisfy(
      (err) => !err.message.includes(FAKE_TOKEN),
    );
  });
});

// =============================================================================
// listWabaPhoneNumbers
// =============================================================================

describe('listWabaPhoneNumbers', () => {
  // ── Sucesso e normalização ───────────────────────────────────────────────────

  it('TC-L01: sucesso com 1 número', async () => {
    fetch.mockResolvedValue(makePhoneListResponse([PHONE_1]));
    const result = await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(PHONE_1.id);
  });

  it('TC-L02: múltiplos números retornados', async () => {
    fetch.mockResolvedValue(makePhoneListResponse([PHONE_1, PHONE_2]));
    const result = await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    expect(result).toHaveLength(2);
  });

  it('TC-L03: data vazio retorna []', async () => {
    fetch.mockResolvedValue(makePhoneListResponse([]));
    const result = await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    expect(result).toEqual([]);
  });

  it('TC-L04: normalização camelCase — id, displayPhoneNumber, verifiedName', async () => {
    fetch.mockResolvedValue(makePhoneListResponse([PHONE_1]));
    const [item] = await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    expect(item).toEqual({
      id:                 PHONE_1.id,
      displayPhoneNumber: PHONE_1.display_phone_number,
      verifiedName:       PHONE_1.verified_name,
    });
  });

  it('TC-L05: verified_name ausente → verifiedName null', async () => {
    const phone = { id: '111', display_phone_number: '+1 555', /* sem verified_name */ };
    fetch.mockResolvedValue(makePhoneListResponse([phone]));
    const [item] = await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    expect(item.verifiedName).toBeNull();
  });

  it('TC-L06: verified_name null → verifiedName null', async () => {
    const phone = { id: '111', display_phone_number: '+1 555', verified_name: null };
    fetch.mockResolvedValue(makePhoneListResponse([phone]));
    const [item] = await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    expect(item.verifiedName).toBeNull();
  });

  // ── Validação de item inválido ───────────────────────────────────────────────

  it('TC-L07: verified_name tipo inválido (number) → graph_invalid_response', async () => {
    const phone = { id: '111', display_phone_number: '+1 555', verified_name: 42 };
    fetch.mockResolvedValue(makePhoneListResponse([phone]));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-L08: item sem id → graph_invalid_response (falha toda a operação)', async () => {
    const phone = { display_phone_number: '+1 555', verified_name: 'Test' };
    fetch.mockResolvedValue(makePhoneListResponse([phone]));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-L09: id vazio → graph_invalid_response', async () => {
    const phone = { id: '', display_phone_number: '+1 555', verified_name: 'Test' };
    fetch.mockResolvedValue(makePhoneListResponse([phone]));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-L10: item sem display_phone_number → graph_invalid_response', async () => {
    const phone = { id: '111', verified_name: 'Test' };
    fetch.mockResolvedValue(makePhoneListResponse([phone]));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-L11: display_phone_number vazio → graph_invalid_response', async () => {
    const phone = { id: '111', display_phone_number: '', verified_name: 'Test' };
    fetch.mockResolvedValue(makePhoneListResponse([phone]));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-L27: item inválido causa falha total — lista não é filtrada silenciosamente', async () => {
    // 1 item válido + 1 sem id → deve lançar, não retornar somente o válido
    const phones = [PHONE_1, { display_phone_number: '+1 556', verified_name: 'No ID' }];
    fetch.mockResolvedValue(makePhoneListResponse(phones));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  // ── Falhas de payload ────────────────────────────────────────────────────────

  it('TC-L12: data null → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ data: null }));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-L13: data objeto (não array) → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ data: { id: '111' } }));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-L14: JSON inválido → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeJsonErrorResponse());
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  // ── Falhas HTTP ──────────────────────────────────────────────────────────────

  it('TC-L15a: HTTP 400 → graph_waba_inaccessible', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_waba_inaccessible' });
  });

  it('TC-L15b: HTTP 401 → graph_waba_inaccessible', async () => {
    fetch.mockResolvedValue(makeErrorResponse(401));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_waba_inaccessible' });
  });

  it('TC-L15c: HTTP 403 → graph_waba_inaccessible', async () => {
    fetch.mockResolvedValue(makeErrorResponse(403));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_waba_inaccessible' });
  });

  it('TC-L15d: HTTP 404 → graph_waba_inaccessible', async () => {
    fetch.mockResolvedValue(makeErrorResponse(404));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_waba_inaccessible' });
  });

  it('TC-L16: HTTP 500 → graph_waba_inaccessible', async () => {
    fetch.mockResolvedValue(makeErrorResponse(500));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_waba_inaccessible' });
  });

  // ── Falhas de rede ───────────────────────────────────────────────────────────

  it('TC-L17: AbortError → graph_timeout', async () => {
    fetch.mockRejectedValue(makeAbortError());
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_timeout' });
  });

  it('TC-L18: TypeError de rede → graph_network_error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_network_error' });
  });

  // ── Validação de inputs (falha antes do fetch) ────────────────────────────────

  it('TC-L19: wabaId vazio → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, ''))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-L20: wabaId com slash → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, '102290/evil'))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-L21: wabaId com query string → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, '102290?x=1'))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-L22: wabaId URL completa → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, 'https://evil.example'))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-L23: wabaId com letras → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, '102abc290'))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-L24: wabaId number (não string) → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, 102290129340398))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-L25: accessToken vazio → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers('', FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-L26: accessToken não-string → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers(null, FAKE_WABA))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  // ── Inputs inválidos combinados ──────────────────────────────────────────────

  it('TC-L27b: wabaId com espaço → falha antes do fetch', async () => {
    await expect(listWabaPhoneNumbers(FAKE_TOKEN, ' 102290129'))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  // ── Headers e URL ────────────────────────────────────────────────────────────

  it('TC-L28: token vai no header Authorization: Bearer', async () => {
    fetch.mockResolvedValue(makePhoneListResponse([PHONE_1]));
    await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it('TC-L29: token NÃO aparece na URL', async () => {
    fetch.mockResolvedValue(makePhoneListResponse([PHONE_1]));
    await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.toString()).not.toContain(FAKE_TOKEN);
  });

  it('TC-L30: fields explícitos na URL', async () => {
    fetch.mockResolvedValue(makePhoneListResponse([PHONE_1]));
    await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.searchParams.get('fields')).toBe('id,display_phone_number,verified_name');
  });

  it('TC-L31: limit=100 na URL', async () => {
    fetch.mockResolvedValue(makePhoneListResponse([PHONE_1]));
    await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.searchParams.get('limit')).toBe('100');
  });

  it('TC-L32: graphVersion vindo de getMetaServerConfig', async () => {
    getMetaServerConfig.mockReturnValue({ ...FAKE_CONFIG, graphVersion: 'v99.0' });
    fetch.mockResolvedValue(makePhoneListResponse([PHONE_1]));
    await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.toString()).toContain('/v99.0/');
  });

  // =============================================================================
  // Paginação
  // =============================================================================

  describe('paginação', () => {
    it('TC-P01: paging.next ausente + cursors.after presente → termina, somente 1 fetch', async () => {
      // Sem paging.next → fim dos dados, even com cursors.after presente
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: { cursors: { before: 'BEFORE', after: 'CURSOR_ABC' } },
        // paging.next ausente
      }));
      const result = await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });

    it('TC-P02: paging.next válido + after válido → faz segundo fetch', async () => {
      fetch
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_1], 'https://graph.facebook.com/...', 'CURSOR_1'))
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_2])); // sem paging.next
      await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('TC-P03: segunda URL reconstruída internamente — hostname, path, fields, limit, after corretos', async () => {
      fetch
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_1], 'https://graph.facebook.com/...', 'CURSOR_1'))
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_2]));
      await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);

      const secondUrl = fetch.mock.calls[1][0];
      const str = secondUrl.toString();
      expect(str).toContain('graph.facebook.com');
      expect(str).toContain(FAKE_VERSION);
      expect(str).toContain(FAKE_WABA);
      expect(str).toContain('phone_numbers');
      expect(secondUrl.searchParams.get('fields')).toBe('id,display_phone_number,verified_name');
      expect(secondUrl.searchParams.get('limit')).toBe('100');
      expect(secondUrl.searchParams.get('after')).toBe('CURSOR_1');
    });

    it('TC-P04 (anti-SSRF): paging.next malicioso nunca é usado como destino de fetch', async () => {
      fetch
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_1], EVIL_URL, 'CURSOR_SAFE'))
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_2]));
      await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);

      // Ambas as calls devem ir para graph.facebook.com — nunca evil.example
      for (const [callUrl] of fetch.mock.calls) {
        expect(callUrl.toString()).toContain('graph.facebook.com');
        expect(callUrl.toString()).not.toContain('evil.example');
      }
    });

    it('TC-P05: paging.next presente + after ausente → graph_invalid_response', async () => {
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: {
          next: 'https://graph.facebook.com/...',
          cursors: { before: 'BEFORE' }, // sem after
        },
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-P06: paging.next presente + after vazio → graph_invalid_response', async () => {
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: {
          next: 'https://graph.facebook.com/...',
          cursors: { after: '' },
        },
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-P07: paging.next presente + after não-string → graph_invalid_response', async () => {
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: {
          next: 'https://graph.facebook.com/...',
          cursors: { after: 42 },
        },
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-P08: paging.next null → graph_invalid_response (não é fim normal)', async () => {
      // null é valor presente inválido — somente undefined (ausência) sinaliza fim
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: { next: null, cursors: { after: 'CURSOR_ABC' } },
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-P09: paging.next string vazia → graph_invalid_response', async () => {
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: { next: '', cursors: { after: 'CURSOR_ABC' } },
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-PD: paging.next número (123) → graph_invalid_response', async () => {
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: { next: 123, cursors: { after: 'CURSOR_ABC' } },
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-PE: paging.next boolean (false) → graph_invalid_response', async () => {
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: { next: false, cursors: { after: 'CURSOR_ABC' } },
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-PF: paging.next objeto ({}) → graph_invalid_response', async () => {
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: { next: {}, cursors: { after: 'CURSOR_ABC' } },
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-P10: cursor after repetido → graph_invalid_response (loop detectado)', async () => {
      const repeatedCursor = 'CURSOR_REPEAT';
      fetch
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_1], 'https://graph.facebook.com/...', repeatedCursor))
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_2], 'https://graph.facebook.com/...', repeatedCursor)); // mesmo cursor
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
    });

    it('TC-P11: MAX_PAGES excedido → graph_invalid_response', async () => {
      // 10 páginas consecutivas com paging.next — 11ª iteração deve lançar
      for (let i = 1; i <= 10; i++) {
        fetch.mockResolvedValueOnce(
          makePhoneListResponse([], `https://graph.facebook.com/...`, `CURSOR_${i}`),
        );
      }
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA))
        .rejects.toMatchObject({ code: 'graph_invalid_response' });
      // Somente 10 fetches foram feitos (11ª iteração lança antes do fetch)
      expect(fetch).toHaveBeenCalledTimes(10);
    });

    it('TC-P12: dados de múltiplas páginas acumulados na ordem correta', async () => {
      fetch
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_1], 'https://graph.facebook.com/...', 'CURSOR_1'))
        .mockResolvedValueOnce(makePhoneListResponse([PHONE_2]));
      const result = await listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(PHONE_1.id);
      expect(result[1].id).toBe(PHONE_2.id);
    });
  });

  // =============================================================================
  // Segurança dos erros
  // =============================================================================

  describe('segurança de erros', () => {
    it('TC-S01: erro HTTP não contém o accessToken', async () => {
      fetch.mockResolvedValue(makeErrorResponse(403));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA)).rejects.toSatisfy(
        (err) => !err.message.includes(FAKE_TOKEN),
      );
    });

    it('TC-S02: erro HTTP não contém o wabaId', async () => {
      fetch.mockResolvedValue(makeErrorResponse(403));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA)).rejects.toSatisfy(
        (err) => !err.message.includes(FAKE_WABA),
      );
    });

    it('TC-S03: erro de paginação não contém evil URL', async () => {
      fetch.mockResolvedValue(makeOkResponse({
        data: [PHONE_1],
        paging: { next: EVIL_URL, cursors: { after: '' } }, // after vazio → graph_invalid_response
      }));
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, FAKE_WABA)).rejects.toSatisfy(
        (err) => !err.message.includes(EVIL_URL),
      );
    });

    it('TC-S04: erro de input inválido não contém wabaId inválido na mensagem', async () => {
      const badWaba = 'https://evil.example/path';
      await expect(listWabaPhoneNumbers(FAKE_TOKEN, badWaba)).rejects.toSatisfy(
        (err) => !err.message.includes('evil.example'),
      );
    });

    it('TC-S05: erro de exchange não contém appSecret', async () => {
      fetch.mockResolvedValue(makeErrorResponse(400));
      await expect(exchangeCodeForToken(FAKE_CODE)).rejects.toSatisfy(
        (err) => !err.message.includes(FAKE_SECRET),
      );
    });
  });
});
