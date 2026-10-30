// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import {
  revokeInstagramByoCredentials,
  type ByoRevokeInput,
} from '../instagramByoWriteApi';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const TOKEN = 'session-token-de-teste';
const PAYLOAD_KEYS = ['company_id', 'expected_version', 'request_id'];

function session(token = TOKEN) {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  } as never);
}

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

function input(patch: Partial<ByoRevokeInput> = {}): ByoRevokeInput {
  return {
    companyId: COMPANY,
    requestId: REQUEST,
    expectedVersion: 2,
    ...patch,
  };
}

function successBody(result: 'applied' | 'idempotent' | 'already_revoked' = 'applied', stale = false) {
  return {
    ok: true,
    result,
    company_id: COMPANY,
    validation_status: result === 'already_revoked' ? 'revoked' : 'revoked',
    credential_version: stale ? 99 : 3,
    configured: false,
    stale,
    app_secret: 'segredo-ficticio',
    suat: 'token-ficticio',
    meta_app_id: '12345',
    operation: 'revoke',
  };
}

describe('revokeInstagramByoCredentials', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia exatamente três propriedades para /revoke', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, successBody()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await revokeInstagramByoCredentials(input());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/instagram/byo-poc/revoke');
    expect(url).not.toContain('/credentials');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(PAYLOAD_KEYS);
    expect(body).toEqual({
      company_id: COMPANY,
      request_id: REQUEST,
      expected_version: 2,
    });
    expect(body).not.toHaveProperty('operation');
    expect(body).not.toHaveProperty('meta_app_id');
    expect(body).not.toHaveProperty('app_secret');
    expect(body).not.toHaveProperty('suat');
    expect(result).toMatchObject({ kind: 'ok', body: { result: 'applied', stale: false } });
    expect(JSON.stringify(result)).not.toContain('segredo-ficticio');
    expect(JSON.stringify(result)).not.toContain('token-ficticio');
  });

  it('projeta already_revoked sem tratar como applied', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, successBody('already_revoked'))));
    const result = await revokeInstagramByoCredentials(input());
    expect(result).toMatchObject({
      kind: 'ok',
      body: { result: 'already_revoked', configured: false, credential_version: 3, stale: false },
    });
  });

  it.each([0, 1.5, 2147483648, undefined])('recusa expected_version %s sem rede', async (version) => {
    session();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(revokeInstagramByoCredentials(input({ expectedVersion: version as number }))).resolves.toEqual({ kind: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa UUID inválido sem rede', async () => {
    session();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(revokeInstagramByoCredentials(input({ companyId: 'empresa' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(revokeInstagramByoCredentials(input({ requestId: 'tentativa' }))).resolves.toEqual({ kind: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita company_id divergente e HTTP 200 malformado', async () => {
    session();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ...successBody(), company_id: 'dddddddd-0000-4000-8000-000000000004' }))
      .mockResolvedValueOnce(jsonResponse(200, { ...successBody('idempotent', true), stale: undefined }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(revokeInstagramByoCredentials(input())).resolves.toEqual({ kind: 'temporary' });
    await expect(revokeInstagramByoCredentials(input())).resolves.toEqual({ kind: 'temporary' });
  });

  it.each([
    [400, { error: 'rejected' }, 'rejected'],
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [403, { error: 'forbidden' }, 'forbidden'],
    [404, { error: 'not_found' }, 'unavailable'],
    [413, { error: 'too_large' }, 'too_large'],
    [415, { error: 'unsupported_media' }, 'unsupported_media'],
    [503, { error: 'unavailable' }, 'service_unavailable'],
    [409, { error: 'conflict' }, 'conflict'],
    [409, { error: 'request_reused' }, 'request_reused'],
  ] as const)('classifica HTTP %s %s', async (status, body, kind) => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, body)));
    await expect(revokeInstagramByoCredentials(input())).resolves.toEqual({ kind });
  });

  it('trata rede e sessão indisponível', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('falha de rede'));
    vi.stubGlobal('fetch', fetchMock);
    session();
    await expect(revokeInstagramByoCredentials(input())).resolves.toEqual({ kind: 'network' });
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never);
    await expect(revokeInstagramByoCredentials(input())).resolves.toEqual({ kind: 'session_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
