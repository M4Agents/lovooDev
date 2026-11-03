// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoDiscoverySection } from '../InstagramByoDiscoverySection';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { supabase } from '../../../lib/supabase';
import {
  diagnoseInstagramByoConnection,
  getInstagramByoStatus,
  type ByoDiscoveryReport,
  type ByoStatusResult,
} from '../../../services/instagramByoApi';
import { validateInstagramByoWithMeta } from '../../../services/instagramByoValidationApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

vi.mock('../../../services/instagramByoApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/instagramByoApi')>(
    '../../../services/instagramByoApi',
  );
  return { ...actual, getInstagramByoStatus: vi.fn() };
});

vi.mock('../../../services/instagramByoValidationApi', () => ({
  validateInstagramByoWithMeta: vi.fn(),
  associateInstagramByoAccount: vi.fn(),
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const TOKEN = 'session-token-de-teste';
const SECRET = 'valor-suat-ficticio';

function session() {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: TOKEN } },
  } as never);
}

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

function report(overrides: Partial<ByoDiscoveryReport> = {}): ByoDiscoveryReport {
  return {
    app_identity: 'compatible',
    instagram_basic: 'present',
    instagram_manage_messages: 'present',
    instagram_manage_comments: 'present',
    expected_account: 'found',
    unified_login_read: 'compatible',
    webhook_subscription: 'indeterminate',
    error_code: null,
    ...overrides,
  };
}

function status(): ByoStatusResult {
  return {
    kind: 'ok',
    status: {
      ok: true,
      company_id: COMPANY,
      credentials: {
        configured: true,
        validation_status: 'saved',
        meta_app_id: '1234567890',
        validated_at: null,
        revoked_at: null,
        credential_version: 2,
        validation_error_code: null,
      },
      account_status: 'not_connected',
      accounts: [],
    },
  };
}

describe('diagnóstico visual do Unified Login', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('mostra o botão ao administrador e não chama o diagnóstico ao montar', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' })).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.discoveryWebhook')).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.discoveryDisclaimer')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(diagnoseInstagramByoConnection).toBeTypeOf('function');
  });

  it('oculta a ação de quem não tem permissão de escrita', () => {
    render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite={false} />);
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.discoveryAction' })).toBeNull();
  });

  it('envia uma única leitura com o company_id e a sessão', async () => {
    session();
    const fetchMock = vi.fn(async () => jsonResponse(200, report()));
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    expect((await screen.findAllByText('integrations.instagramByo.discoveryConfirmed')).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/instagram/byo-poc/discovery-diagnostic');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ company_id: COMPANY }),
    });
  });

  it('bloqueia o segundo clique enquanto a consulta está aberta', async () => {
    session();
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    const button = screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' });
    fireEvent.click(button);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { release(jsonResponse(200, report())); });
    expect((await screen.findAllByText('integrations.instagramByo.discoveryConfirmed')).length).toBeGreaterThan(0);
  });

  it('mostra permissões presentes e permissões ausentes', async () => {
    session();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, report()))
      .mockResolvedValueOnce(jsonResponse(200, report({
        instagram_basic: 'present',
        instagram_manage_messages: 'absent',
        instagram_manage_comments: 'absent',
        expected_account: 'not_found',
      })));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    expect((await screen.findAllByText('integrations.instagramByo.discoveryConfirmed')).length).toBeGreaterThan(0);
    expect(screen.queryByText('integrations.instagramByo.discoveryAbsent')).toBeNull();

    view.rerender(<InstagramByoDiscoverySection companyId={OTHER} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    expect((await screen.findAllByText('integrations.instagramByo.discoveryAbsent')).length).toBeGreaterThan(0);
  });

  it('mostra indeterminado sem tratá-lo como ausência', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, report({
      app_identity: 'indeterminate',
      instagram_basic: 'indeterminate',
      instagram_manage_messages: 'indeterminate',
      instagram_manage_comments: 'indeterminate',
      expected_account: 'indeterminate',
      unified_login_read: 'indeterminate',
    }))));
    render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    expect((await screen.findAllByText('integrations.instagramByo.discoveryIndeterminate')).length).toBe(6);
    expect(screen.queryByText('integrations.instagramByo.discoveryAbsent')).toBeNull();
  });

  it('traduz 401, 403, 404 e 503 sem marcar permissão ausente', async () => {
    session();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { ok: false, error: SECRET }))
      .mockResolvedValueOnce(jsonResponse(403, { ok: false, error: SECRET }))
      .mockResolvedValueOnce(jsonResponse(404, report({
        app_identity: 'indeterminate',
        instagram_basic: 'indeterminate',
        instagram_manage_messages: 'indeterminate',
        instagram_manage_comments: 'indeterminate',
        expected_account: 'indeterminate',
        unified_login_read: 'indeterminate',
        error_code: 'not_found',
      })))
      .mockResolvedValueOnce(jsonResponse(503, report({
        app_identity: 'indeterminate',
        instagram_basic: 'indeterminate',
        instagram_manage_messages: 'indeterminate',
        instagram_manage_comments: 'indeterminate',
        expected_account: 'indeterminate',
        unified_login_read: 'indeterminate',
        error_code: 'unavailable',
      })));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    const click = () => fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    click();
    expect(await screen.findByText('integrations.instagramByo.discoverySession')).toBeTruthy();
    click();
    expect(await screen.findByText('integrations.instagramByo.discoveryForbidden')).toBeTruthy();
    click();
    expect(await screen.findByText('integrations.instagramByo.discoveryNotFound')).toBeTruthy();
    click();
    expect(await screen.findByText('integrations.instagramByo.discoveryUnavailable')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramByo.discoveryAbsent')).toBeNull();
    expect(screen.queryByText(SECRET)).toBeNull();
    view.unmount();
  });

  it('trata falha de rede e meta_unavailable como inconclusivos', async () => {
    session();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse(200, report({
        app_identity: 'indeterminate',
        instagram_basic: 'indeterminate',
        instagram_manage_messages: 'indeterminate',
        instagram_manage_comments: 'indeterminate',
        expected_account: 'indeterminate',
        unified_login_read: 'indeterminate',
        error_code: 'meta_unavailable',
      })));
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    expect(await screen.findByText('integrations.instagramByo.discoveryNetwork')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    expect(await screen.findByText('integrations.instagramByo.discoveryMetaUnavailable')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramByo.discoveryAbsent')).toBeNull();
  });

  it('não exibe campo sensível inesperado', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {
      ...report(),
      suat: SECRET,
      app_secret: 'valor-app-secret-ficticio',
      debug_url: `https://graph.facebook.com/debug_token?access_token=${SECRET}`,
    })));
    render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    expect((await screen.findAllByText('integrations.instagramByo.discoveryConfirmed')).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain('valor-app-secret-ficticio');
    expect(document.body.textContent).not.toContain('graph.facebook.com');
  });

  it('descarta a resposta pendente quando a empresa da seção muda', async () => {
    session();
    vi.mocked(getInstagramByoStatus).mockResolvedValue(status());
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ company_id: COMPANY });

    view.rerender(<InstagramByoMetaPanel companyId={OTHER} canWrite />);
    expect(screen.queryByText('integrations.instagramByo.discoveryConfirmed')).toBeNull();
    expect(screen.queryByText('integrations.instagramByo.discoverySending')).toBeNull();

    await act(async () => { release(jsonResponse(200, report())); });
    expect(screen.queryByText('integrations.instagramByo.discoveryConfirmed')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('limpa o resultado ao trocar de empresa', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, report())));
    const view = render(<InstagramByoDiscoverySection companyId={COMPANY} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.discoveryAction' }));
    expect((await screen.findAllByText('integrations.instagramByo.discoveryConfirmed')).length).toBeGreaterThan(0);
    view.rerender(<InstagramByoDiscoverySection companyId={OTHER} canWrite />);
    expect(screen.queryByText('integrations.instagramByo.discoveryConfirmed')).toBeNull();
  });

  it('não dispara o diagnóstico depois da validação de credenciais', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(status());
    vi.mocked(validateInstagramByoWithMeta).mockResolvedValue({
      kind: 'temporary',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.validateWithMeta' }));
    await act(async () => { await Promise.resolve(); });
    expect(validateInstagramByoWithMeta).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
