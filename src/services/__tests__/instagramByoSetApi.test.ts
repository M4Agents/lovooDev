// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import {
  getInstagramByoStatus,
  resolveByoSetMode,
  setInstagramByoCredentials,
  type ByoSetInput,
  type ByoStatusCredentials,
} from '../instagramByoApi';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const TOKEN = 'session-token-de-teste';
const SECRET = 'segredo-ficticio';
const SUAT = 'suat-ficticio';

function session(token = TOKEN) {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  } as never);
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
  } as Response;
}

function input(expectedVersion?: number): ByoSetInput {
  return {
    companyId: COMPANY,
    requestId: REQUEST,
    metaAppId: '1234567890',
    appSecret: SECRET,
    suat: SUAT,
    expectedVersion,
  };
}

function successBody(result: 'applied' | 'idempotent', stale = false) {
  return {
    ok: true,
    result,
    company_id: COMPANY,
    validation_status: 'saved',
    credential_version: 3,
    configured: true,
    stale,
    app_secret: SECRET,
    suat: SUAT,
  };
}

const credentials = (status: string, version: number | null, configured = false): ByoStatusCredentials => ({
  configured,
  validation_status: status,
  meta_app_id: null,
  validated_at: null,
  revoked_at: status === 'revoked' ? '2026-10-30T13:00:00.000Z' : null,
  credential_version: version,
  validation_error_code: null,
});

describe('setInstagramByoCredentials', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia o payload exato de set sem expected_version no cadastro inicial', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, successBody('applied')));
    vi.stubGlobal('fetch', fetchMock);

    const result = await setInstagramByoCredentials(input());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/instagram/byo-poc/credentials');
    expect(String(url)).not.toContain(SECRET);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      company_id: COMPANY,
      request_id: REQUEST,
      operation: 'set',
      meta_app_id: '1234567890',
      app_secret: SECRET,
      suat: SUAT,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.body).toEqual({
      ok: true,
      result: 'applied',
      company_id: COMPANY,
      validation_status: 'saved',
      credential_version: 3,
      configured: true,
      stale: false,
    });
  });

  it('inclui expected_version somente na reativação', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, successBody('idempotent', true)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await setInstagramByoCredentials(input(4));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.expected_version).toBe(4);
    expect(body.operation).toBe('set');
    expect(result).toMatchObject({
      kind: 'ok',
      body: { result: 'idempotent', stale: true, credential_version: 3 },
    });
  });

  it.each([
    [409, { error: 'conflict' }, 'conflict'],
    [409, { error: 'request_reused' }, 'request_reused'],
    [400, { error: 'rejected' }, 'rejected'],
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [403, { error: 'forbidden' }, 'forbidden'],
    [404, { error: 'not_found' }, 'unavailable'],
    [413, { error: 'too_large' }, 'too_large'],
    [415, { error: 'unsupported_media' }, 'unsupported_media'],
    [503, { error: 'unavailable' }, 'service_unavailable'],
  ] as const)('distingue HTTP %s', async (status, body, kind) => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(status, body));
    vi.stubGlobal('fetch', fetchMock);
    await expect(setInstagramByoCredentials(input())).resolves.toEqual({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não repete a chamada quando a rede falha', async () => {
    session();
    const fetchMock = vi.fn(async () => {
      throw new Error('falha de rede');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(setInstagramByoCredentials(input())).resolves.toEqual({ kind: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejeita company_id diferente e descarta segredos da resposta', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      ...successBody('applied'),
      company_id: 'dddddddd-0000-4000-8000-000000000004',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await setInstagramByoCredentials(input());
    expect(result).toEqual({ kind: 'temporary' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('não grava segredo em storage nem o escreve no console', async () => {
    session();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, successBody('applied'))));

    await setInstagramByoCredentials(input());

    const logged = [...log.mock.calls, ...info.mock.calls].flat().join(' ');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(TOKEN);
    const stored = setItem.mock.calls.flat().join(' ');
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain(SUAT);
  });

  it('preserva o mesmo JSON quando a sessão expira no retry e volta depois', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('falha de rede'))
      .mockResolvedValueOnce(jsonResponse(200, successBody('applied')));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(supabase.auth.getSession)
      .mockResolvedValueOnce({ data: { session: { access_token: TOKEN } } } as never)
      .mockResolvedValueOnce({ data: { session: null } } as never)
      .mockResolvedValueOnce({ data: { session: { access_token: TOKEN } } } as never);

    const payload = input();
    await expect(setInstagramByoCredentials(payload)).resolves.toEqual({ kind: 'network' });
    const expired = await setInstagramByoCredentials(payload);
    expect(expired).toEqual({ kind: 'session_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(expired)).not.toContain(SECRET);

    const recovered = await setInstagramByoCredentials(payload);
    expect(recovered.kind).toBe('ok');
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(secondBody).toEqual(firstBody);
  });

  it('não leva o segredo quando getSession lança exceção no retry', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error(SECRET));
    vi.stubGlobal('fetch', fetchMock);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(supabase.auth.getSession)
      .mockResolvedValueOnce({ data: { session: { access_token: TOKEN } } } as never)
      .mockRejectedValueOnce(new Error(SECRET));

    const payload = input();
    await expect(setInstagramByoCredentials(payload)).resolves.toEqual({ kind: 'network' });
    const failed = await setInstagramByoCredentials(payload);
    expect(failed).toEqual({ kind: 'session_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(failed)).not.toContain(SECRET);
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain(SECRET);
  });

  it.each([
    { label: 'sem stale', body: { ...successBody('applied'), stale: undefined } },
    { label: 'com result desconhecido', body: { ...successBody('applied'), result: 'desconhecido' } },
  ])('trata HTTP 200 malformado $label como temporário e sem segredo', async ({ body }) => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);
    const result = await setInstagramByoCredentials(input());
    expect(result).toEqual({ kind: 'temporary' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SUAT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não implementa replace, rotate nem revoke', () => {
    const api = readFileSync(resolve('src/services/instagramByoApi.ts'), 'utf8');
    const form = readFileSync(resolve('src/components/Settings/InstagramByoSetForm.tsx'), 'utf8');
    const panel = readFileSync(resolve('src/components/Settings/InstagramConnectionPanel.tsx'), 'utf8');
    for (const source of [api, form]) {
      expect(source).not.toContain('replace_app');
      expect(source).not.toContain('rotate_secret');
      expect(source).not.toContain('rotate_suat');
      expect(source).not.toContain('byo-poc/revoke');
    }
    expect(panel).toContain('instagram');
  });
});

describe('getInstagramByoStatus diante de falha de leitura', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    [401, 'denied'],
    [403, 'denied'],
    [500, 'temporary'],
  ] as const)('mapeia HTTP %s para %s', async (status, kind) => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, { error: 'sem-detalhe' })));
    await expect(getInstagramByoStatus(COMPANY)).resolves.toEqual({ kind });
  });

  it('mapeia falha de rede para erro temporário', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error(SECRET);
    }));
    const result = await getInstagramByoStatus(COMPANY);
    expect(result).toEqual({ kind: 'temporary' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('resolveByoSetMode', () => {
  it('separa cadastro inicial, revogado e status inconsistente', () => {
    expect(resolveByoSetMode(credentials('not_configured', null))).toEqual({ kind: 'initial' });
    expect(resolveByoSetMode(credentials('revoked', 4))).toEqual({ kind: 'revoked', expectedVersion: 4 });
    expect(resolveByoSetMode(credentials('revoked', null))).toEqual({ kind: 'blocked' });
    expect(resolveByoSetMode(credentials('revoked', 0))).toEqual({ kind: 'blocked' });
    expect(resolveByoSetMode(credentials('revoked', 1.5))).toEqual({ kind: 'blocked' });
    expect(resolveByoSetMode(credentials('revoked', 2147483648))).toEqual({ kind: 'blocked' });
    expect(resolveByoSetMode(credentials('saved', 2, false))).toEqual({ kind: 'blocked' });
    expect(resolveByoSetMode(credentials('saved', 2, true))).toEqual({ kind: 'blocked' });
  });
});
