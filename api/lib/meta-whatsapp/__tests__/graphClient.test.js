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
import { exchangeCodeForToken, listWabaPhoneNumbers, discoverAuthorizedWabas, sendTextMessage, registerPhoneNumber, setTwoStepVerificationPin } from '../graphClient.js';

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
const FAKE_WABA_2    = '987654321098765';
const FAKE_APP_TOKEN = `${FAKE_APP_ID}|${FAKE_SECRET}`; // App Access Token composto
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

// =============================================================================
// discoverAuthorizedWabas
// =============================================================================

// Helpers para respostas do debug_token
function makeDebugTokenOk(granularScopes) {
  return makeOkResponse({ data: { granular_scopes: granularScopes } });
}

function makeDebugTokenOkNoScopes() {
  // granular_scopes ausente — token sem scope granular
  return makeOkResponse({ data: {} });
}

function makeWaScope(targetIds) {
  return { scope: 'whatsapp_business_management', target_ids: targetIds };
}

describe('discoverAuthorizedWabas', () => {

  // ── Sucesso ──────────────────────────────────────────────────────────────────

  it('TC-D01: 1 WABA válida → ["<id>"]', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([FAKE_WABA])]));
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    expect(result).toEqual([FAKE_WABA]);
  });

  it('TC-D02: scope whatsapp_business_management ausente → []', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([
      { scope: 'instagram_basic', target_ids: ['999'] },
    ]));
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    expect(result).toEqual([]);
  });

  it('TC-D03: scope presente com target_ids=[] → []', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([])]));
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    expect(result).toEqual([]);
  });

  it('TC-D04: múltiplas WABAs → array completo', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([FAKE_WABA, FAKE_WABA_2])]));
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    expect(result).toHaveLength(2);
    expect(result).toContain(FAKE_WABA);
    expect(result).toContain(FAKE_WABA_2);
  });

  it('TC-D05: target_ids duplicados → deduplicados', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([
      makeWaScope([FAKE_WABA, FAKE_WABA]), // mesmo ID repetido
    ]));
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    expect(result).toEqual([FAKE_WABA]);
  });

  it('TC-D05b: duplicatas entre múltiplos entries → deduplicados', async () => {
    // Dois entries do mesmo scope (possível na API) — ID repetido entre eles
    fetch.mockResolvedValue(makeDebugTokenOk([
      makeWaScope([FAKE_WABA]),
      makeWaScope([FAKE_WABA, FAKE_WABA_2]),
    ]));
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    expect(result).toHaveLength(2);
    expect(new Set(result).size).toBe(2); // sem duplicatas
  });

  it('TC-D15: granular_scopes ausente em data → []', async () => {
    fetch.mockResolvedValue(makeDebugTokenOkNoScopes());
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    expect(result).toEqual([]);
  });

  it('TC-D19: outros scopes presentes junto com WA → somente WABA IDs extraídos', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([
      { scope: 'pages_read_engagement', target_ids: ['111'] },
      makeWaScope([FAKE_WABA]),
      { scope: 'instagram_basic', target_ids: ['222'] },
    ]));
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    expect(result).toEqual([FAKE_WABA]); // somente WABA ID — outros scopes ignorados
  });

  // ── Falhas HTTP ──────────────────────────────────────────────────────────────

  it('TC-D06a: HTTP 400 → graph_debug_token_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_debug_token_failed' });
  });

  it('TC-D06b: HTTP 401 → graph_debug_token_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(401));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_debug_token_failed' });
  });

  it('TC-D06c: HTTP 500 → graph_debug_token_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(500));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_debug_token_failed' });
  });

  // ── Falhas de rede ───────────────────────────────────────────────────────────

  it('TC-D07: AbortError → graph_timeout', async () => {
    fetch.mockRejectedValue(makeAbortError());
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_timeout' });
  });

  it('TC-D08: TypeError de rede → graph_network_error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_network_error' });
  });

  // ── Falhas estruturais ───────────────────────────────────────────────────────

  it('TC-D09: JSON inválido → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeJsonErrorResponse());
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D13a: data ausente → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({}));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D13b: data null → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ data: null }));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D13c: data é array → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ data: [] }));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D14: granular_scopes presente mas não é array → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ data: { granular_scopes: 'invalid' } }));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D14b: granular_scopes é null → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ data: { granular_scopes: null } }));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D16: target_ids não é array em entry WA → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([
      { scope: 'whatsapp_business_management', target_ids: FAKE_WABA }, // string em vez de array
    ]));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D16b: target_ids null em entry WA → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([
      { scope: 'whatsapp_business_management', target_ids: null },
    ]));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  // ── Política fail-closed para target_id inválido ─────────────────────────────
  // Comportamento documentado: não aceitar silenciosamente resposta estruturalmente
  // inconsistente. Qualquer ID inválido em entry válido → rejeita operação inteira.

  it('TC-D09b (fail-closed): target_id não-string → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([12345])]));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D09c (fail-closed): target_id vazio → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([''])]));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D09d (fail-closed): target_id com letras → graph_invalid_response', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope(['abc123'])]));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  it('TC-D09e (fail-closed): ID inválido junto com ID válido → rejeita tudo, não filtra', async () => {
    // Confirma que não há filtragem silenciosa — operação inteira é rejeitada
    fetch.mockResolvedValue(makeDebugTokenOk([
      makeWaScope([FAKE_WABA, 'not-a-number']),
    ]));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN))
      .rejects.toMatchObject({ code: 'graph_invalid_response' });
  });

  // ── Validação de input ────────────────────────────────────────────────────────

  it('TC-D17a: accessToken vazio → falha antes do fetch', async () => {
    await expect(discoverAuthorizedWabas('')).rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-D17b: accessToken null → falha antes do fetch', async () => {
    await expect(discoverAuthorizedWabas(null)).rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-D18: accessToken não-string (number) → falha antes do fetch', async () => {
    await expect(discoverAuthorizedWabas(12345)).rejects.toMatchObject({ code: 'graph_invalid_response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  // ── Parâmetros e URL ──────────────────────────────────────────────────────────

  it('TC-D10: graphVersion vindo de getMetaServerConfig é usado na URL', async () => {
    getMetaServerConfig.mockReturnValue({ ...FAKE_CONFIG, graphVersion: 'v99.0' });
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([FAKE_WABA])]));
    await discoverAuthorizedWabas(FAKE_TOKEN);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.toString()).toContain('/v99.0/');
    expect(callUrl.toString()).toContain('debug_token');
  });

  it('TC-D10b: path é /{graphVersion}/debug_token', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([FAKE_WABA])]));
    await discoverAuthorizedWabas(FAKE_TOKEN);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.pathname).toBe(`/${FAKE_VERSION}/debug_token`);
  });

  it('TC-D10c: input_token é o accessToken recebido', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([FAKE_WABA])]));
    await discoverAuthorizedWabas(FAKE_TOKEN);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.searchParams.get('input_token')).toBe(FAKE_TOKEN);
  });

  it('TC-D10d: access_token é App Access Token construído como appId|appSecret', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([FAKE_WABA])]));
    await discoverAuthorizedWabas(FAKE_TOKEN);
    const [callUrl] = fetch.mock.calls[0];
    // Verificável em testes pois usa fixture — nunca logado em runtime
    expect(callUrl.searchParams.get('access_token')).toBe(FAKE_APP_TOKEN);
  });

  // ── Segurança de secrets ─────────────────────────────────────────────────────

  it('TC-D11a: resultado nunca contém appSecret, appToken ou accessToken', async () => {
    fetch.mockResolvedValue(makeDebugTokenOk([makeWaScope([FAKE_WABA])]));
    const result = await discoverAuthorizedWabas(FAKE_TOKEN);
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(FAKE_SECRET);
    expect(resultStr).not.toContain(FAKE_APP_TOKEN);
    expect(resultStr).not.toContain(FAKE_TOKEN);
  });

  it('TC-D11b: erro HTTP não contém appSecret', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN)).rejects.toSatisfy(
      (err) => !err.message.includes(FAKE_SECRET),
    );
  });

  it('TC-D11c: erro HTTP não contém accessToken', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN)).rejects.toSatisfy(
      (err) => !err.message.includes(FAKE_TOKEN),
    );
  });

  it('TC-D11d: erro HTTP não contém App Access Token composto', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN)).rejects.toSatisfy(
      (err) => !err.message.includes(FAKE_APP_TOKEN),
    );
  });

  it('TC-D11e: erro estrutural não contém appSecret', async () => {
    fetch.mockResolvedValue(makeOkResponse({ data: null }));
    await expect(discoverAuthorizedWabas(FAKE_TOKEN)).rejects.toSatisfy(
      (err) => !err.message.includes(FAKE_SECRET),
    );
  });
});

// =============================================================================
// sendTextMessage
// =============================================================================
//
// Fixtures adicionais
//
// FAKE_TOKEN  — reutilizado dos fixtures globais (business token fictício)
// FAKE_CONFIG — reutilizado dos fixtures globais

const FAKE_PHONE_NUMBER_ID = '106540352242922';     // numeric string, fictício
const FAKE_TO              = '5511987654321';        // dígitos apenas, sem '+'
const FAKE_TEXT            = 'Olá, esta é uma mensagem de teste MVP2.';
const FAKE_WAMID           = 'wamid.HBgLNTU1MTk4NzY1NDMyMQIVAgARGBI4NzY1NDMyMQ==';

/** Resposta Graph de sucesso para envio de mensagem */
function makeSendOkResponse(wamid = FAKE_WAMID) {
  return makeOkResponse({
    messaging_product: 'whatsapp',
    contacts: [{ input: FAKE_TO, wa_id: FAKE_TO }],
    messages: [{ id: wamid }],
  });
}

describe('sendTextMessage', () => {

  // ── Sucesso ──────────────────────────────────────────────────────────────────

  it('TC-M01: sucesso → { messageId: wamid }', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    const result = await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    expect(result).toEqual({ messageId: FAKE_WAMID });
  });

  it('TC-M01b: retorna somente { messageId } — sem token, to, text ou payload bruto', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    const result = await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    expect(Object.keys(result)).toEqual(['messageId']);
  });

  // ── URL e request ────────────────────────────────────────────────────────────

  it('TC-M02: URL usa graphVersion e phoneNumberId corretamente', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.toString()).toContain(`/${FAKE_VERSION}/`);
    expect(callUrl.toString()).toContain(`/${FAKE_PHONE_NUMBER_ID}/messages`);
  });

  it('TC-M02b: graphVersion vindo de getMetaServerConfig é usado', async () => {
    getMetaServerConfig.mockReturnValue({ ...FAKE_CONFIG, graphVersion: 'v99.0' });
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    const [callUrl] = fetch.mock.calls[0];
    expect(callUrl.toString()).toContain('/v99.0/');
  });

  it('TC-M03: Authorization header é "Bearer <accessToken>"', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    const [, callOpts] = fetch.mock.calls[0];
    expect(callOpts.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it('TC-M03b: Content-Type é application/json', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    const [, callOpts] = fetch.mock.calls[0];
    expect(callOpts.headers['Content-Type']).toBe('application/json');
  });

  it('TC-M04: payload enviado ao Graph contém campos obrigatórios exatos', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    const [, callOpts] = fetch.mock.calls[0];
    const body = JSON.parse(callOpts.body);
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.recipient_type).toBe('individual');
    expect(body.to).toBe(FAKE_TO);
    expect(body.type).toBe('text');
    expect(body.text.body).toBe(FAKE_TEXT.trim());
  });

  it('TC-M04b: payload não contém campos além dos definidos internamente', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    const [, callOpts] = fetch.mock.calls[0];
    const body = JSON.parse(callOpts.body);
    const allowedKeys = ['messaging_product', 'recipient_type', 'to', 'type', 'text'];
    expect(Object.keys(body).sort()).toEqual(allowedKeys.sort());
  });

  it('TC-M04c: method é POST', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    await sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT);
    const [, callOpts] = fetch.mock.calls[0];
    expect(callOpts.method).toBe('POST');
  });

  // ── Validação de input (sem fetch) ───────────────────────────────────────────

  it('TC-M05a: phoneNumberId vazio → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, '', FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M05b: phoneNumberId com letras → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, 'abc123', FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M05c: phoneNumberId null → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, null, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M06a: to vazio → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, '', FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M06b: to com "+" → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, '+5511987654321', FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M06c: to com letras → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, 'abc5511987654321', FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M06d: to muito curto (< 7 dígitos) → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, '123456', FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M06e: to muito longo (> 15 dígitos) → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, '1234567890123456', FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M07a: text vazio → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, ''))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M07b: text somente espaços (trim vazio) → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, '   '))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M07c: text null → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, null))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M07d: text acima de 4096 chars → send_invalid_input sem fetch', async () => {
    const longText = 'A'.repeat(4097);
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, longText))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M07e: text exatamente 4096 chars → fetch executado (limite inclusivo)', async () => {
    fetch.mockResolvedValue(makeSendOkResponse());
    const maxText = 'A'.repeat(4096);
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, maxText))
      .resolves.toMatchObject({ messageId: FAKE_WAMID });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('TC-M-TOKEN-01: accessToken vazio → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage('', FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-M-TOKEN-02: accessToken null → send_invalid_input sem fetch', async () => {
    await expect(sendTextMessage(null, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  // ── Falhas HTTP ──────────────────────────────────────────────────────────────

  it('TC-M08a: HTTP 400 → send_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_failed' });
  });

  it('TC-M08b: HTTP 401 → send_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(401));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_failed' });
  });

  it('TC-M08c: HTTP 500 → send_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(500));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_failed' });
  });

  it('TC-M08d: erro send_failed não contém accessToken', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toSatisfy((err) => !err.message.includes(FAKE_TOKEN));
  });

  it('TC-M08e: erro send_failed não contém to', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toSatisfy((err) => !err.message.includes(FAKE_TO));
  });

  // ── Timeout e rede ───────────────────────────────────────────────────────────

  it('TC-M09a: AbortError → send_timeout', async () => {
    fetch.mockRejectedValue(makeAbortError());
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_timeout' });
  });

  it('TC-M09b: TypeError de rede → send_network_error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_network_error' });
  });

  // ── Resposta inválida ────────────────────────────────────────────────────────

  it('TC-M10a: HTTP 200 sem messages → send_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ messaging_product: 'whatsapp' }));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_response' });
  });

  it('TC-M10b: HTTP 200 com messages array vazio → send_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ messaging_product: 'whatsapp', messages: [] }));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_response' });
  });

  it('TC-M10c: HTTP 200 com message id vazio → send_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ messaging_product: 'whatsapp', messages: [{ id: '' }] }));
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_response' });
  });

  it('TC-M10d: JSON inválido na resposta 200 → send_invalid_response', async () => {
    fetch.mockResolvedValue(makeJsonErrorResponse());
    await expect(sendTextMessage(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID, FAKE_TO, FAKE_TEXT))
      .rejects.toMatchObject({ code: 'send_invalid_response' });
  });
});

// =============================================================================
// registerPhoneNumber
// =============================================================================

const FAKE_PHONE_NUMBER_ID_REG = '1906385232743451';
const FAKE_PIN = '042731';

describe('registerPhoneNumber', () => {

  // ── Sucesso ─────────────────────────────────────────────────────────────────

  it('TC-R01: 200 com {success:true} → { ok: true }', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    const result = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN);
    expect(result).toEqual({ ok: true });
  });

  it('TC-R02: 200 com body vazio (JSON parse falha) → { ok: true } — aceita 201 empty', async () => {
    fetch.mockResolvedValue(makeJsonErrorResponse()); // json() rejeita
    // makeJsonErrorResponse usa ok:true, então JSON parse error em 2xx → { ok: true }
    const result = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN);
    expect(result).toEqual({ ok: true });
  });

  it('TC-R03: 200 com {success:false} → register_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: false }));
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_invalid_response' });
  });

  // ── Construção de URL e request ─────────────────────────────────────────────

  it('TC-R04: URL inclui graphVersion e phoneNumberId', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN);
    const [calledUrl] = fetch.mock.calls[0];
    expect(calledUrl.toString()).toContain(`/${FAKE_VERSION}/${FAKE_PHONE_NUMBER_ID_REG}/register`);
  });

  it('TC-R05: method é POST', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN);
    const [, options] = fetch.mock.calls[0];
    expect(options.method).toBe('POST');
  });

  it('TC-R06: Authorization header contém o token', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it('TC-R07: Content-Type é application/json', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('TC-R08: body contém exatamente messaging_product e pin', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN);
    const [, options] = fetch.mock.calls[0];
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody).toEqual({ messaging_product: 'whatsapp', pin: FAKE_PIN });
  });

  it('TC-R09: body não contém campos extras', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN);
    const [, options] = fetch.mock.calls[0];
    const parsedBody = JSON.parse(options.body);
    expect(Object.keys(parsedBody)).toEqual(['messaging_product', 'pin']);
  });

  // ── Validação de input — sem fetch ──────────────────────────────────────────

  it('TC-R10: accessToken vazio → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber('', FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R11: accessToken non-string → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber(null, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R12: phoneNumberId com letras → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber(FAKE_TOKEN, 'abc123', FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R13: phoneNumberId vazio → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber(FAKE_TOKEN, '', FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R14: PIN com 5 dígitos → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, '12345'))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R15: PIN com 7 dígitos → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, '1234567'))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R16: PIN com letras → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, '12345a'))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R17: PIN vazio → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, ''))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R18: PIN non-string → register_invalid_input, zero fetch', async () => {
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, 123456))
      .rejects.toMatchObject({ code: 'register_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-R19: "000000" é aceito como PIN válido', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    const result = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, '000000');
    expect(result).toEqual({ ok: true });
  });

  // ── Erros de rede ────────────────────────────────────────────────────────────

  it('TC-R20: AbortError → register_timeout', async () => {
    fetch.mockRejectedValue(makeAbortError());
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_timeout' });
  });

  it('TC-R21: erro de rede genérico → register_network_error', async () => {
    fetch.mockRejectedValue(new Error('Network failure'));
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_network_error' });
  });

  // ── Erros Graph non-2xx — captura segura ────────────────────────────────────

  it('TC-R22: Graph 400 → register_failed com graphStatus=400', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 131009, error_subcode: 2494010, message: 'PIN required' } }),
    });
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_failed', graphStatus: 400, metaErrorCode: 131009, metaSubcode: 2494010 });
  });

  it('TC-R23: Graph 401 → register_failed com graphStatus=401', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 401,
      json: async () => ({ error: { code: 190, message: 'Token expired' } }),
    });
    await expect(registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN))
      .rejects.toMatchObject({ code: 'register_failed', graphStatus: 401, metaErrorCode: 190 });
  });

  it('TC-R24: Graph non-2xx sem metaErrorCode → register_failed sem metaErrorCode', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const err = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN)
      .catch(e => e);
    expect(err.code).toBe('register_failed');
    expect(err.graphStatus).toBe(500);
    expect(err.metaErrorCode).toBeUndefined();
    expect(err.metaSubcode).toBeUndefined();
  });

  it('TC-R25: provider message não é preservado no erro', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 131009, message: 'Sensitive provider message' } }),
    });
    const err = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN)
      .catch(e => e);
    // err.message deve ser genérico — nunca refletir o message do provider
    expect(err.message).not.toContain('Sensitive provider message');
    expect(err.message).not.toContain('provider');
  });

  it('TC-R26: fbtrace_id nunca preservado no erro', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 131009, fbtrace_id: 'TRACE_ABC123' } }),
    });
    const err = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain('TRACE_ABC123');
  });

  it('TC-R27: Graph non-2xx com body não-JSON → register_failed sem metaErrorCode', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 503,
      json: () => Promise.reject(new SyntaxError('Not JSON')),
    });
    const err = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN)
      .catch(e => e);
    expect(err.code).toBe('register_failed');
    expect(err.graphStatus).toBe(503);
    expect(err.metaErrorCode).toBeUndefined();
  });

  // ── Segurança — secrets não expostos ────────────────────────────────────────

  it('TC-R28: token não aparece no erro lançado', async () => {
    fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const err = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain(FAKE_TOKEN);
  });

  it('TC-R29: PIN não aparece no erro lançado', async () => {
    fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const err = await registerPhoneNumber(FAKE_TOKEN, FAKE_PHONE_NUMBER_ID_REG, FAKE_PIN)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain(FAKE_PIN);
  });
});

// =============================================================================
// setTwoStepVerificationPin
// =============================================================================

// Fixtures locais — fictícios, nunca reais
const FAKE_PHONE_ID_SP = '2065473892011234'; // phoneNumberId para set-pin (diferente de REG)
const FAKE_PIN_SP      = '150954';           // PIN fictício para set-pin
const FAKE_TOKEN_SP    = 'EAAAN_fake_set_pin_token_not_real_ABCDEF';

describe('setTwoStepVerificationPin', () => {

  // ── Sucesso ─────────────────────────────────────────────────────────────────

  it('SP-18: HTTP 200 {success:true} → {ok:true}', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    const result = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    expect(result).toEqual({ ok: true });
  });

  // ── Construção de URL e request ─────────────────────────────────────────────

  it('SP-01: URL contém graphVersion e phoneNumberId SEM /register', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    const [calledUrl] = fetch.mock.calls[0];
    const urlStr = calledUrl.toString();
    expect(urlStr).toContain(`/${FAKE_VERSION}/${FAKE_PHONE_ID_SP}`);
    expect(urlStr).not.toContain('/register');
  });

  it('SP-02: método é POST', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    const [, options] = fetch.mock.calls[0];
    expect(options.method).toBe('POST');
  });

  it('SP-03: Authorization header contém o token', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN_SP}`);
  });

  it('SP-04: Content-Type é application/json', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('SP-05: body contém exatamente { pin } com valor correto', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    const [, options] = fetch.mock.calls[0];
    const parsed = JSON.parse(options.body);
    expect(parsed).toEqual({ pin: FAKE_PIN_SP });
  });

  it('SP-06: body NÃO contém messaging_product', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    const [, options] = fetch.mock.calls[0];
    const parsed = JSON.parse(options.body);
    expect(parsed).not.toHaveProperty('messaging_product');
  });

  // ── Validação de input — zero fetch ────────────────────────────────────────

  it('SP-07: accessToken vazio → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin('', FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-08: accessToken whitespace → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin('   ', FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-09: phoneNumberId vazio → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, '', FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-10: phoneNumberId não numérico → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, 'abc-123', FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-11: PIN 5 dígitos → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, '12345'))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-12: PIN 7 dígitos → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, '1234567'))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-13: PIN com letras → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, '12345a'))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-14: PIN com espaços → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, '12 345'))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-15: PIN number (não string) → set_pin_invalid_input + zero fetch', async () => {
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, 123456))
      .rejects.toMatchObject({ code: 'set_pin_invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('SP-16: PIN "000000" é aceito (leading zeros válidos)', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, '000000'))
      .resolves.toEqual({ ok: true });
  });

  it('SP-17: PIN "999999" é aceito', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, '999999'))
      .resolves.toEqual({ ok: true });
  });

  // ── Validação de resposta 2xx ───────────────────────────────────────────────

  it('SP-19: HTTP 200 {success:false} → set_pin_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: false }));
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_response' });
  });

  it('SP-20: HTTP 200 {} (sem success) → set_pin_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse({}));
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_response' });
  });

  it('SP-21: HTTP 200 null → set_pin_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse(null));
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_response' });
  });

  it('SP-22: HTTP 200 array → set_pin_invalid_response', async () => {
    fetch.mockResolvedValue(makeOkResponse([{ success: true }]));
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_response' });
  });

  it('SP-23: JSON inválido em 2xx → set_pin_invalid_response', async () => {
    fetch.mockResolvedValue(makeJsonErrorResponse()); // json() rejeita
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_invalid_response' });
  });

  // ── Non-2xx ─────────────────────────────────────────────────────────────────

  it('SP-24: non-2xx → set_pin_failed', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_failed' });
  });

  it('SP-25: graphStatus seguro preservado em non-2xx', async () => {
    fetch.mockResolvedValue(makeErrorResponse(422));
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(err.graphStatus).toBe(422);
  });

  it('SP-26: metaErrorCode preservado se numérico', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 190, error_subcode: 460 } }),
    });
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(err.metaErrorCode).toBe(190);
  });

  it('SP-27: metaSubcode preservado se numérico', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 190, error_subcode: 460 } }),
    });
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(err.metaSubcode).toBe(460);
  });

  it('SP-28: provider message NÃO preservado no erro', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 190, message: 'Sensitive provider message for set-pin' } }),
    });
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain('Sensitive provider message');
  });

  it('SP-29: fbtrace_id NÃO preservado no erro', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 190, fbtrace_id: 'TRACE123ABC' } }),
    });
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain('TRACE123ABC');
    expect(err).not.toHaveProperty('fbtrace_id');
  });

  it('SP-30: error_data NÃO preservado no erro', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 190, error_data: { details: 'secret data' } } }),
    });
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain('secret data');
  });

  it('SP-31: provider body NÃO preservado no erro (non-2xx)', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 190, message: 'Raw body content' }, raw: 'provider raw' }),
    });
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain('provider raw');
    expect(err).not.toHaveProperty('raw');
  });

  // ── Timeout / Network ────────────────────────────────────────────────────────

  it('SP-32: AbortError → set_pin_timeout', async () => {
    fetch.mockRejectedValue(makeAbortError());
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_timeout' });
  });

  it('SP-33: network failure → set_pin_network_error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP))
      .rejects.toMatchObject({ code: 'set_pin_network_error' });
  });

  // ── Segurança — secrets não expostos ────────────────────────────────────────

  it('SP-34: token não aparece no erro lançado (non-2xx)', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain(FAKE_TOKEN_SP);
  });

  it('SP-35: PIN não aparece no erro lançado (non-2xx)', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain(FAKE_PIN_SP);
  });

  it('SP-36: phoneNumberId não aparece no erro lançado (non-2xx)', async () => {
    fetch.mockResolvedValue(makeErrorResponse(400));
    const err = await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP)
      .catch(e => e);
    expect(JSON.stringify(err)).not.toContain(FAKE_PHONE_ID_SP);
  });

  it('SP-37: primitive faz no máximo um fetch por chamada', async () => {
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('SP-38: nenhum console.log chamado durante a primitive', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetch.mockResolvedValue(makeOkResponse({ success: true }));
    await setTwoStepVerificationPin(FAKE_TOKEN_SP, FAKE_PHONE_ID_SP, FAKE_PIN_SP);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
