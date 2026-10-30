// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import {
  rotateInstagramByoSuat,
  type ByoRotateSuatInput,
} from '../instagramByoWriteApi';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000005';
const TOKEN = 'session-token-de-teste';
const SUAT = ' token-ficticio ';
const PAYLOAD_KEYS = ['company_id', 'expected_version', 'operation', 'request_id', 'suat'];

function session(token = TOKEN) {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
  } as never);
}

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

function input(patch: Partial<ByoRotateSuatInput> = {}): ByoRotateSuatInput {
  return {
    companyId: COMPANY,
    requestId: REQUEST,
    expectedVersion: 2,
    suat: SUAT,
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
    app_secret: 'segredo-ficticio',
    suat: SUAT,
    meta_app_id: '12345',
  };
}

describe('rotateInstagramByoSuat', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia exatamente cinco propriedades, sem meta_app_id nem app_secret', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, successBody()));
    vi.stubGlobal('fetch', fetchMock);

    const result = await rotateInstagramByoSuat(input());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/instagram/byo-poc/credentials');
    expect(String(url)).not.toContain(SUAT.trim());
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(PAYLOAD_KEYS);
    expect(body).toEqual({
      company_id: COMPANY,
      request_id: REQUEST,
      operation: 'rotate_suat',
      expected_version: 2,
      suat: SUAT,
    });
    expect(body).not.toHaveProperty('meta_app_id');
    expect(body).not.toHaveProperty('app_secret');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.body.stale).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SUAT.trim());
  });

  it.each([0, 1.5, 2147483648])('recusa expected_version %s sem rede', async (version) => {
    session();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(rotateInstagramByoSuat(input({ expectedVersion: version }))).resolves.toEqual({ kind: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa UUID, token vazio, NUL e UTF-16 inválido sem rede', async () => {
    session();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(rotateInstagramByoSuat(input({ companyId: 'empresa' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSuat(input({ requestId: 'tentativa' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSuat(input({ suat: '' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSuat(input({ suat: 'a\u0000b' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSuat(input({ suat: '\uD800' }))).resolves.toEqual({ kind: 'rejected' });
    await expect(rotateInstagramByoSuat(input({ suat: 'a'.repeat(4097) }))).resolves.toEqual({ kind: 'rejected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita company_id divergente e HTTP 200 malformado sem devolver o token', async () => {
    session();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ...successBody(), company_id: 'dddddddd-0000-4000-8000-000000000004' }))
      .mockResolvedValueOnce(jsonResponse(200, { ...successBody(true), stale: undefined }));
    vi.stubGlobal('fetch', fetchMock);
    const mismatch = await rotateInstagramByoSuat(input());
    const malformed = await rotateInstagramByoSuat(input());
    expect(mismatch).toEqual({ kind: 'temporary' });
    expect(malformed).toEqual({ kind: 'temporary' });
    expect(JSON.stringify(mismatch)).not.toContain(SUAT.trim());
    expect(JSON.stringify(malformed)).not.toContain(SUAT.trim());
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
    await expect(rotateInstagramByoSuat(input())).resolves.toEqual({ kind });
  });

  it('trata rede e sessão indisponível sem enviar o token na URL', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('falha de rede'));
    vi.stubGlobal('fetch', fetchMock);
    session();
    await expect(rotateInstagramByoSuat(input())).resolves.toEqual({ kind: 'network' });
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never);
    const expired = await rotateInstagramByoSuat(input());
    expect(expired).toEqual({ kind: 'session_unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(SUAT.trim());
    expect(JSON.stringify(expired)).not.toContain(SUAT.trim());
  });

  it('mantém rotate_suat fora dos formulários de set, replace e rotate_secret', () => {
    const secretForm = readFileSync(resolve('src/components/Settings/InstagramByoRotateSecretForm.tsx'), 'utf8');
    const replaceForm = readFileSync(resolve('src/components/Settings/InstagramByoReplaceForm.tsx'), 'utf8');
    const setForm = readFileSync(resolve('src/components/Settings/InstagramByoSetForm.tsx'), 'utf8');
    const setApi = readFileSync(resolve('src/services/instagramByoApi.ts'), 'utf8');
    for (const source of [secretForm, replaceForm, setForm, setApi]) {
      expect(source).not.toContain('rotate_suat');
    }
  });
});
