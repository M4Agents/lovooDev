// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../../components/Settings/InstagramByoMetaPanel';
import { supabase } from '../../lib/supabase';
import { getInstagramByoStatus } from '../instagramByoApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER_COMPANY = 'dddddddd-0000-4000-8000-000000000004';
const TOKEN = 'session-token-de-teste';
const FOREIGN_APP_ID = '88888';
const SECRET = 'segredo-ficticio';

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

const FORBIDDEN_FIELDS = {
  app_secret: 'valor-app-secret',
  suat: 'valor-suat',
  app_secret_enc: 'valor-app-secret-enc',
  suat_enc: 'valor-suat-enc',
  access_token_enc: 'valor-access-token-enc',
} as const;

function payload(configured: boolean) {
  return {
    ok: true,
    company_id: COMPANY,
    credentials: {
      configured,
      validation_status: configured ? 'saved' : 'not_configured',
      meta_app_id: configured ? '1234567890' : null,
      validated_at: configured ? '2026-10-30T12:00:00.000Z' : null,
      revoked_at: null,
      credential_version: configured ? 2 : null,
      validation_error_code: null,
    },
    account_status: 'not_connected',
    accounts: [],
  };
}

describe('getInstagramByoStatus', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('envia o company_id selecionado e o Bearer token', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, payload(false)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getInstagramByoStatus(COMPANY);

    expect(result.kind).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/instagram/byo-poc/status?company_id=${COMPANY}`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(JSON.stringify(init)).not.toContain('POST');
  });

  it('trata 404 como indisponível, sem configured false', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: 'not_found' })));

    const result = await getInstagramByoStatus(COMPANY);

    expect(result).toEqual({ kind: 'unavailable' });
  });

  it.each([401, 403])('trata HTTP %s como acesso negado', async (status) => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, { error: 'denied' })));

    await expect(getInstagramByoStatus(COMPANY)).resolves.toEqual({ kind: 'denied' });
  });

  it('trata HTTP 500 e falha de rede como erro temporário', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'unavailable' })));
    await expect(getInstagramByoStatus(COMPANY)).resolves.toEqual({ kind: 'temporary' });

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('rede');
    }));
    await expect(getInstagramByoStatus(COMPANY)).resolves.toEqual({ kind: 'temporary' });
  });

  it('separa o cancelamento da falha de rede', async () => {
    session();
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }));

    await expect(getInstagramByoStatus(COMPANY, controller.signal)).resolves.toEqual({ kind: 'cancelled' });
  });

  it('não grava storage nem escreve logs', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {
      ...payload(true),
      credentials: { ...payload(true).credentials, app_secret: 'nao-persistir' },
    })));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await getInstagramByoStatus(COMPANY);

    expect(setItem).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    setItem.mockRestore();
    log.mockRestore();
    error.mockRestore();
  });

  it('trata company_id divergente como erro temporário', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {
      ...payload(true),
      company_id: OTHER_COMPANY,
      credentials: { ...payload(true).credentials, meta_app_id: FOREIGN_APP_ID },
    })));

    const result = await getInstagramByoStatus(COMPANY);

    expect(result).toEqual({ kind: 'temporary' });
    expect(JSON.stringify(result)).not.toContain(FOREIGN_APP_ID);
    expect(JSON.stringify(result)).not.toContain(OTHER_COMPANY);

    render(createElement(InstagramByoMetaPanel, { companyId: COMPANY }));
    expect(await screen.findByText('integrations.instagramByo.statusTemporary')).toBeTruthy();
    expect(screen.queryByText(FOREIGN_APP_ID)).toBeNull();
  });

  it('descarta propriedades extras do JSON 200', async () => {
    session();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {
      ...payload(true),
      app_secret: SECRET,
      suat: 'suat-ficticio',
      access_token_enc: 'ciphertext-ficticio',
      credentials: { ...payload(true).credentials, app_secret: SECRET },
    })));

    const result = await getInstagramByoStatus(COMPANY);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(Object.keys(result.status)).toEqual([
      'ok',
      'company_id',
      'credentials',
      'account_status',
      'accounts',
    ]);
    expect(Object.keys(result.status.credentials)).toEqual([
      'configured',
      'validation_status',
      'meta_app_id',
      'validated_at',
      'revoked_at',
      'credential_version',
      'validation_error_code',
    ]);
    expect(JSON.stringify(result)).not.toContain('app_secret');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    render(createElement(InstagramByoMetaPanel, { companyId: COMPANY }));
    expect(await screen.findByText('1234567890')).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
    log.mockRestore();
    error.mockRestore();
  });

  it('descarta segredos fictícios na raiz, nas credenciais e nas contas', async () => {
    session();
    const base = payload(true);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {
      ...base,
      ...FORBIDDEN_FIELDS,
      credentials: { ...base.credentials, ...FORBIDDEN_FIELDS },
      account_status: 'poc_enabled',
      accounts: [{
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        company_id: COMPANY,
        instagram_account_id: 'ig-conta',
        system_user_id: null,
        instagram_username: 'conta_teste',
        encryption_version: 1,
        scopes: ['instagram_basic'],
        status: 'poc_enabled',
        status_reason: null,
        created_at: '2026-10-30T12:00:00.000Z',
        updated_at: '2026-10-30T12:00:00.000Z',
        ...FORBIDDEN_FIELDS,
      }],
    })));

    const result = await getInstagramByoStatus(COMPANY);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const serialized = JSON.stringify(result);
    for (const [key, value] of Object.entries(FORBIDDEN_FIELDS)) {
      expect(serialized).not.toContain(key);
      expect(serialized).not.toContain(value);
    }
    expect(Object.keys(result.status.accounts[0])).toEqual([
      'id',
      'company_id',
      'instagram_account_id',
      'system_user_id',
      'instagram_username',
      'encryption_version',
      'scopes',
      'status',
      'status_reason',
      'created_at',
      'updated_at',
    ]);
    expect(result.status.accounts[0].instagram_username).toBe('conta_teste');
  });

  it('sem sessão não chama a API', async () => {
    session('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getInstagramByoStatus(COMPANY)).resolves.toEqual({ kind: 'denied' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
