import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readUnifiedLoginDiagnostic } from '../byoUnifiedLoginRead.js';

const APP = '1234567890';
const SECRET = 'fixture-app-secret-not-real';
const SUAT = 'fixture-suat-not-real';
const ACCOUNT = '17841405822304914';
const OTHER = '17841400000000002';

function debugBody(overrides = {}) {
  return {
    data: {
      is_valid: true,
      app_id: APP,
      type: 'SYSTEM_USER',
      scopes: ['instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments'],
      ...overrides,
    },
  };
}

function jsonResponse(body, ok = true) {
  return {
    ok,
    text: async () => JSON.stringify(body),
  };
}

function fetchMock(handlers) {
  const calls = [];
  const fetchImpl = vi.fn(async (url) => {
    calls.push(String(url));
    const handler = handlers[calls.length - 1];
    if (!handler) throw new Error('unexpected fetch');
    return handler(url);
  });
  return { fetchImpl, calls };
}

function read(expectedAccountIds, handlers) {
  const mock = fetchMock(handlers);
  return readUnifiedLoginDiagnostic({
    appId: APP,
    appSecret: SECRET,
    suat: SUAT,
    expectedAccountIds,
    fetchImpl: mock.fetchImpl,
  }).then((report) => ({ report, calls: mock.calls }));
}

describe('leitura diagnóstica do Unified Login', () => {
  it('marca aplicativo compatível e a conta encontrada', async () => {
    const { report, calls } = await read([ACCOUNT], [
      () => jsonResponse(debugBody()),
      () => jsonResponse({ data: [{ id: ACCOUNT, username: 'conta.teste' }] }),
    ]);
    expect(report).toEqual({
      app_identity: 'compatible',
      instagram_basic: 'present',
      instagram_manage_messages: 'present',
      instagram_manage_comments: 'present',
      expected_account: 'found',
      unified_login_read: 'compatible',
      webhook_subscription: 'indeterminate',
      error_code: null,
    });
    expect(calls).toHaveLength(2);
    const accountUrl = new URL(calls[1]);
    expect(accountUrl.pathname).toBe('/v26.0/me/assigned_instagram_accounts');
    expect(accountUrl.searchParams.get('fields')).toBe('id,username');
    expect(JSON.stringify(report)).not.toContain(SUAT);
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it('não consulta contas quando o aplicativo diverge', async () => {
    const { report, calls } = await read([ACCOUNT], [
      () => jsonResponse(debugBody({ app_id: '9999999999' })),
    ]);
    expect(report.app_identity).toBe('incompatible');
    expect(report.instagram_manage_messages).toBe('present');
    expect(report.unified_login_read).toBe('indeterminate');
    expect(report.expected_account).toBe('indeterminate');
    expect(calls).toHaveLength(1);
  });

  it('não consulta contas quando o tipo do token diverge', async () => {
    const { report, calls } = await read([ACCOUNT], [
      () => jsonResponse(debugBody({ type: 'USER' })),
    ]);
    expect(report.app_identity).toBe('compatible');
    expect(report.unified_login_read).toBe('indeterminate');
    expect(calls).toHaveLength(1);
  });

  it('marca somente instagram_basic quando a resposta é válida', async () => {
    const { report } = await read([ACCOUNT], [
      () => jsonResponse(debugBody({ scopes: ['instagram_basic'] })),
      () => jsonResponse({ data: [] }),
    ]);
    expect(report.instagram_basic).toBe('present');
    expect(report.instagram_manage_messages).toBe('absent');
    expect(report.instagram_manage_comments).toBe('absent');
    expect(report.expected_account).toBe('not_found');
  });

  it('marca escopos ausentes numa resposta válida sem lista', async () => {
    const { report } = await read([ACCOUNT], [
      () => jsonResponse(debugBody({ scopes: [] })),
      () => jsonResponse({ data: [{ id: OTHER, username: 'outra' }] }),
    ]);
    expect(report.instagram_basic).toBe('absent');
    expect(report.instagram_manage_messages).toBe('absent');
    expect(report.expected_account).toBe('not_found');
  });

  it('não transforma falha de rede em permissão ausente', async () => {
    const { report, calls } = await read([ACCOUNT], [
      () => { throw new Error('network down'); },
    ]);
    expect(report).toMatchObject({
      app_identity: 'indeterminate',
      instagram_basic: 'indeterminate',
      instagram_manage_messages: 'indeterminate',
      instagram_manage_comments: 'indeterminate',
      expected_account: 'indeterminate',
      unified_login_read: 'indeterminate',
      error_code: 'meta_unavailable',
    });
    expect(calls).toHaveLength(1);
  });

  it('não transforma timeout em permissão ausente', async () => {
    const { report } = await read([ACCOUNT], [
      () => { throw new DOMException('The operation was aborted', 'TimeoutError'); },
    ]);
    expect(report.instagram_manage_messages).toBe('indeterminate');
    expect(report.error_code).toBe('meta_unavailable');
  });

  it('não transforma JSON inválido em permissão ausente', async () => {
    const { report } = await read([ACCOUNT], [
      () => ({ ok: true, text: async () => '{nao-json' }),
    ]);
    expect(report.instagram_basic).toBe('indeterminate');
    expect(report.error_code).toBe('meta_unavailable');
  });

  it('trata lista vazia como conta não encontrada', async () => {
    const { report } = await read([ACCOUNT], [
      () => jsonResponse(debugBody()),
      () => jsonResponse({ data: [] }),
    ]);
    expect(report.unified_login_read).toBe('compatible');
    expect(report.expected_account).toBe('not_found');
    expect(report.webhook_subscription).toBe('indeterminate');
  });

  it('deixa a conta indeterminada quando há zero ou várias contas locais', async () => {
    const handlers = [
      () => jsonResponse(debugBody()),
      () => jsonResponse({ data: [{ id: ACCOUNT, username: 'conta.teste' }] }),
    ];
    const none = await read([], handlers);
    const many = await read([ACCOUNT, OTHER], [
      () => jsonResponse(debugBody()),
      () => jsonResponse({ data: [{ id: ACCOUNT, username: 'conta.teste' }] }),
    ]);
    expect(none.report.expected_account).toBe('indeterminate');
    expect(many.report.expected_account).toBe('indeterminate');
  });

  it('marca a leitura como incompatível sem apagar os escopos já lidos', async () => {
    const { report, calls } = await read([ACCOUNT], [
      () => jsonResponse(debugBody()),
      () => jsonResponse({ error: { code: 10, message: SUAT } }, false),
    ]);
    expect(report.app_identity).toBe('compatible');
    expect(report.instagram_manage_messages).toBe('present');
    expect(report.unified_login_read).toBe('incompatible');
    expect(report.expected_account).toBe('indeterminate');
    expect(report.error_code).toBeNull();
    expect(JSON.stringify(report)).not.toContain(SUAT);
    expect(calls.some((url) => url.includes('subscribed_apps'))).toBe(false);
    expect(calls.some((url) => url.includes('assigned_pages'))).toBe(false);
  });

  it('não chama o webhook oficial nem subscribed_apps', () => {
    const source = [
      'api/lib/instagram/byoUnifiedLoginRead.js',
      'api/lib/instagram/byoDiscoveryDiagnosticHttp.js',
      'api/instagram/byo-poc/discovery-diagnostic.js',
    ].map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toContain('subscribed_apps');
    expect(source).not.toContain('graph.instagram.com');
    expect(source).not.toContain('assigned_pages');
    expect(source).not.toContain('interpretDebugToken');
    expect(source).not.toContain('instagram_byo_record_validation');
    expect(source).not.toContain('instagram_byo_associate_account');
    expect(source).not.toContain('console.');
  });
});
