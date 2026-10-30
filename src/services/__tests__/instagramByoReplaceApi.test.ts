// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import type { ByoStatusCredentials } from '../instagramByoApi';
import { replaceInstagramByoApp, resolveByoReplaceMode, type ByoReplaceInput } from '../instagramByoWriteApi';

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
const PAYLOAD_KEYS = [
  'app_secret',
  'company_id',
  'expected_version',
  'meta_app_id',
  'operation',
  'request_id',
  'suat',
];

function session(token = TOKEN) {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  } as never);
}

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

function input(expectedVersion = 2): ByoReplaceInput {
  return {
    companyId: COMPANY,
    requestId: REQUEST,
    expectedVersion,
    metaAppId: '1234567890',
    appSecret: SECRET,
    suat: SUAT,
  };
}

function successBody(result: 'applied' | 'idempotent' = 'applied', stale = false) {
  return {
    ok: true,
    result,
    company_id: COMPANY,
    validation_status: 'saved',
    credential_version: stale ? 99 : 3,
    configured: true,
    stale,
    app_secret: SECRET,
    suat: SUAT,
  };
}

function credentials(
  status: string,
  version: number | null,
  configured = false,
): ByoStatusCredentials {
  return {
    configured,
    validation_status: status,
    meta_app_id: null,
    validated_at: null,
    revoked_at: status === 'revoked' ? '2026-10-30T13:00:00.000Z' : null,
    credential_version: version,
    validation_error_code: null,
  };
}

describe('replaceInstagramByoApp', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia o payload exato de replace_app com expected_version', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, successBody()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await replaceInstagramByoApp(input());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/instagram/byo-poc/credentials');
    expect(String(url)).not.toContain(SECRET);
    expect(String(url)).not.toContain(SUAT);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(PAYLOAD_KEYS);
    expect(body).toEqual({
      company_id: COMPANY,
      request_id: REQUEST,
      operation: 'replace_app',
      expected_version: 2,
      meta_app_id: '1234567890',
      app_secret: SECRET,
      suat: SUAT,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.body.credential_version).toBe(3);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SUAT);
  });

  it.each([0, 1.5, 2147483648])('recusa expected_version %s sem chamar a rede', async (version) => {
    session();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(replaceInstagramByoApp(input(version))).resolves.toEqual({ kind: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não grava segredo em storage, URL ou console', async () => {
    session();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, successBody())));

    await replaceInstagramByoApp(input());

    const logged = [...log.mock.calls, ...info.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(SUAT);
    expect(logged).not.toContain(TOKEN);
    expect(setItem.mock.calls.flat().join(' ')).not.toContain(SECRET);
  });

  it('rejeita company_id diferente e descarta segredos da resposta', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {
      ...successBody(),
      company_id: 'dddddddd-0000-4000-8000-000000000004',
    })));
    const result = await replaceInstagramByoApp(input());
    expect(result).toEqual({ kind: 'temporary' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each([
    [409, { error: 'conflict' }, 'conflict'],
    [409, { error: 'request_reused' }, 'request_reused'],
  ] as const)('distingue HTTP %s %s', async (status, body, kind) => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(status, body));
    vi.stubGlobal('fetch', fetchMock);
    await expect(replaceInstagramByoApp(input())).resolves.toEqual({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não repete a chamada quando a rede falha e preserva a sessão no retry', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('falha de rede'))
      .mockResolvedValueOnce(jsonResponse(200, successBody()));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(supabase.auth.getSession)
      .mockResolvedValueOnce({ data: { session: { access_token: TOKEN } } } as never)
      .mockResolvedValueOnce({ data: { session: null } } as never)
      .mockResolvedValueOnce({ data: { session: { access_token: TOKEN } } } as never);

    const payload = input();
    await expect(replaceInstagramByoApp(payload)).resolves.toEqual({ kind: 'network' });
    const expired = await replaceInstagramByoApp(payload);
    expect(expired).toEqual({ kind: 'session_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(expired)).not.toContain(SECRET);
    const recovered = await replaceInstagramByoApp(payload);
    expect(recovered.kind).toBe('ok');
    const first = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    const second = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(second).toEqual(first);
  });

  it('isola replace_app de revoke e mantém rotate_suat fora do formulário', () => {
    const source = readFileSync(resolve('src/services/instagramByoWriteApi.ts'), 'utf8');
    const form = readFileSync(resolve('src/components/Settings/InstagramByoReplaceForm.tsx'), 'utf8');
    const setApi = readFileSync(resolve('src/services/instagramByoApi.ts'), 'utf8');
    const setForm = readFileSync(resolve('src/components/Settings/InstagramByoSetForm.tsx'), 'utf8');
    expect(source).toContain("operation: 'replace_app'");
    expect(source).toContain("operation: 'rotate_suat'");
    expect(source).toContain('/api/instagram/byo-poc/revoke');
    expect(source).not.toContain('...');
    expect(form).not.toContain('rotate_secret');
    expect(form).not.toContain('rotate_suat');
    expect(form).not.toContain('byo-poc/revoke');
    expect(setApi).not.toContain('replace_app');
    expect(setForm).not.toContain('replace_app');
  });
});

describe('resolveByoReplaceMode', () => {
  it('libera somente credencial ativa com versão inteira', () => {
    expect(resolveByoReplaceMode(credentials('saved', 2, true))).toEqual({ kind: 'ready', expectedVersion: 2 });
    expect(resolveByoReplaceMode(credentials('pending', 1, true))).toEqual({ kind: 'ready', expectedVersion: 1 });
    expect(resolveByoReplaceMode(credentials('valid', 8, true))).toEqual({ kind: 'ready', expectedVersion: 8 });
    expect(resolveByoReplaceMode(credentials('failed', 3, true))).toEqual({ kind: 'ready', expectedVersion: 3 });
    expect(resolveByoReplaceMode(credentials('not_configured', null))).toEqual({ kind: 'blocked' });
    expect(resolveByoReplaceMode(credentials('saved', 2, false))).toEqual({ kind: 'blocked' });
    expect(resolveByoReplaceMode(credentials('revoked', 4))).toEqual({ kind: 'blocked' });
    expect(resolveByoReplaceMode(credentials('revoked', 4, true))).toEqual({ kind: 'blocked' });
    expect(resolveByoReplaceMode(credentials('saved', null, true))).toEqual({ kind: 'blocked' });
    expect(resolveByoReplaceMode(credentials('saved', 0, true))).toEqual({ kind: 'blocked' });
    expect(resolveByoReplaceMode(credentials('saved', 1.5, true))).toEqual({ kind: 'blocked' });
    expect(resolveByoReplaceMode(credentials('saved', 2147483648, true))).toEqual({ kind: 'blocked' });
    expect(resolveByoReplaceMode(credentials('not_configured', 2, true))).toEqual({ kind: 'blocked' });
  });
});
