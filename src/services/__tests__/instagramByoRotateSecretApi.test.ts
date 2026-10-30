// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import {
  rotateInstagramByoSecret,
  type ByoRotateSecretInput,
} from '../instagramByoWriteApi';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const TOKEN = 'session-token-de-teste';
const SECRET = 'segredo-ficticio';
const PAYLOAD_KEYS = ['app_secret', 'company_id', 'expected_version', 'operation', 'request_id'];

function session(token = TOKEN) {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  } as never);
}

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

function input(patch: Partial<ByoRotateSecretInput> = {}): ByoRotateSecretInput {
  return {
    companyId: COMPANY,
    requestId: REQUEST,
    expectedVersion: 2,
    appSecret: SECRET,
    ...patch,
  };
}

function successBody(stale = false) {
  return {
    ok: true,
    result: stale ? 'idempotent' : 'applied',
    company_id: COMPANY,
    validation_status: 'saved',
    credential_version: stale ? 99 : 3,
    configured: true,
    stale,
    app_secret: SECRET,
    suat: 'suat-ficticio',
    meta_app_id: '12345',
  };
}

describe('rotateInstagramByoSecret', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia exatamente cinco propriedades, sem meta_app_id nem suat', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, successBody()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await rotateInstagramByoSecret(input());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/instagram/byo-poc/credentials');
    expect(String(url)).not.toContain(SECRET);
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(PAYLOAD_KEYS);
    expect(body).toEqual({
      company_id: COMPANY,
      request_id: REQUEST,
      operation: 'rotate_secret',
      expected_version: 2,
      app_secret: SECRET,
    });
    expect(body).not.toHaveProperty('meta_app_id');
    expect(body).not.toHaveProperty('suat');
    expect(result.kind).toBe('ok');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each([0, 1.5, 2147483648])('recusa expected_version %s sem rede', async (version) => {
    session();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(rotateInstagramByoSecret(input({ expectedVersion: version }))).resolves.toEqual({ kind: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa UUID, segredo vazio, NUL e UTF-16 inválido sem rede', async () => {
    session();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(rotateInstagramByoSecret(input({ companyId: 'empresa' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSecret(input({ requestId: 'tentativa' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSecret(input({ appSecret: '' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSecret(input({ appSecret: 'a\u0000b' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSecret(input({ appSecret: '\uD800' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSecret(input({ appSecret: 'a'.repeat(4097) }))).resolves.toEqual({ kind: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita company_id divergente e HTTP 200 malformado sem devolver o segredo', async () => {
    session();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ...successBody(), company_id: 'dddddddd-0000-4000-8000-000000000004' }))
      .mockResolvedValueOnce(jsonResponse(200, { ...successBody(), stale: undefined }));
    vi.stubGlobal('fetch', fetchMock);
    const mismatch = await rotateInstagramByoSecret(input());
    const malformed = await rotateInstagramByoSecret(input());
    expect(mismatch).toEqual({ kind: 'temporary' });
    expect(malformed).toEqual({ kind: 'temporary' });
    expect(JSON.stringify(mismatch)).not.toContain(SECRET);
    expect(JSON.stringify(malformed)).not.toContain(SECRET);
  });

  it.each([
    [409, { error: 'conflict' }, 'conflict'],
    [409, { error: 'request_reused' }, 'request_reused'],
  ] as const)('distingue HTTP %s', async (status, body, kind) => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, body)));
    await expect(rotateInstagramByoSecret(input())).resolves.toEqual({ kind });
  });
});
