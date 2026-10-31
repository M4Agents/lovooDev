// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { InstagramByoWebhookSection } from '../InstagramByoWebhookSection';
import { getInstagramByoStatus, type ByoStatusResult } from '../../../services/instagramByoApi';
import { configureInstagramByoWebhook } from '../../../services/instagramByoWebhookApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../services/instagramByoWebhookApi', () => ({
  configureInstagramByoWebhook: vi.fn(),
}));

vi.mock('../../../services/instagramByoApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/instagramByoApi')>(
    '../../../services/instagramByoApi',
  );
  return { ...actual, getInstagramByoStatus: vi.fn() };
});

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OTHER = 'dddddddd-0000-4000-8000-000000000004';
const ROUTE = 'ab'.repeat(32);
const TOKEN_A = `token-a-${'11'.repeat(8)}`;
const TOKEN_B = `token-b-${'22'.repeat(8)}`;
const STALE = `token-stale-${'33'.repeat(8)}`;

function statusOf(
  companyId: string,
  webhook: { routeId: string | null; enabled: boolean; verify: boolean },
): ByoStatusResult {
  return {
    kind: 'ok',
    status: {
      ok: true,
      company_id: companyId,
      credentials: {
        configured: true,
        validation_status: 'valid',
        meta_app_id: '1234567890',
        validated_at: '2026-10-30T12:00:00.000Z',
        revoked_at: null,
        credential_version: 11,
        validation_error_code: null,
        webhook_route_id: webhook.routeId,
        webhook_enabled: webhook.enabled,
        webhook_verify_configured: webhook.verify,
      },
      account_status: 'poc_disabled',
      accounts: [],
    },
  };
}

describe('seção de webhook BYO', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('mostra a URL, copia e revela o token só depois da geração', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    configureInstagramByoWebhook.mockResolvedValue({
      kind: 'ok',
      webhookRouteId: ROUTE,
      webhookVerifyToken: 'ef'.repeat(32),
    });
    const onRefresh = vi.fn();
    const view = render(
      <InstagramByoWebhookSection
        companyId={COMPANY}
        canWrite
        routeId={null}
        enabled={false}
        verifyConfigured={false}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByText('integrations.instagramByo.webhookNotOperational')).toBeTruthy();
    expect(screen.queryByText(/efef/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.webhookGenerate' }));
    expect(await screen.findByText(/efef/)).toBeTruthy();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(configureInstagramByoWebhook).toHaveBeenCalledWith({ companyId: COMPANY, action: 'generate' });

    view.rerender(
      <InstagramByoWebhookSection
        companyId={COMPANY}
        canWrite
        routeId={ROUTE}
        enabled
        verifyConfigured
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.webhookCopy' }));
    expect(String(writeText.mock.calls[0][0])).toContain(`/api/instagram/byo-poc/webhook/${ROUTE}`);
  });
});

describe('painel e seção de webhook BYO', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('mantém o token visível depois do refetch da geração', async () => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId) => {
      reads += 1;
      if (reads === 1) return statusOf(companyId, { routeId: null, enabled: false, verify: false });
      return statusOf(companyId, { routeId: ROUTE, enabled: true, verify: true });
    });
    vi.mocked(configureInstagramByoWebhook).mockResolvedValue({
      kind: 'ok',
      webhookRouteId: ROUTE,
      webhookVerifyToken: TOKEN_A,
    });

    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.webhookGenerate' }));

    expect(await screen.findByText('integrations.instagramByo.webhookConfigured')).toBeTruthy();
    expect(screen.getByText(new RegExp(TOKEN_A))).toBeTruthy();
    expect(configureInstagramByoWebhook).toHaveBeenCalledWith({ companyId: COMPANY, action: 'generate' });
  });

  it('mantém o token visível depois do refetch da rotação e substitui o anterior', async () => {
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId) => (
      statusOf(companyId, { routeId: ROUTE, enabled: true, verify: true })
    ));
    vi.mocked(configureInstagramByoWebhook)
      .mockResolvedValueOnce({ kind: 'ok', webhookRouteId: ROUTE, webhookVerifyToken: TOKEN_A })
      .mockResolvedValueOnce({ kind: 'ok', webhookRouteId: ROUTE, webhookVerifyToken: TOKEN_B });

    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.webhookRotate' }));
    expect(await screen.findByText(new RegExp(TOKEN_A))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.webhookRotate' }));
    expect(await screen.findByText(new RegExp(TOKEN_B))).toBeTruthy();
    expect(screen.queryByText(new RegExp(TOKEN_A))).toBeNull();
    expect(screen.getByText('integrations.instagramByo.webhookConfigured')).toBeTruthy();
  });

  it('remove o token imediatamente ao trocar de empresa', async () => {
    let releaseOther: (value: ByoStatusResult) => void = () => undefined;
    vi.mocked(getInstagramByoStatus).mockImplementation((companyId) => {
      if (companyId === OTHER) return new Promise((resolve) => { releaseOther = resolve; });
      return Promise.resolve(statusOf(companyId, { routeId: ROUTE, enabled: true, verify: true }));
    });
    vi.mocked(configureInstagramByoWebhook).mockResolvedValue({
      kind: 'ok',
      webhookRouteId: ROUTE,
      webhookVerifyToken: TOKEN_A,
    });

    const view = render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.webhookRotate' }));
    expect(await screen.findByText(new RegExp(TOKEN_A))).toBeTruthy();

    view.rerender(<InstagramByoMetaPanel companyId={OTHER} canWrite />);
    expect(screen.queryByText(new RegExp(TOKEN_A))).toBeNull();

    releaseOther(statusOf(OTHER, { routeId: ROUTE, enabled: true, verify: true }));
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.webhookRotate' })).toBeTruthy();
    expect(screen.queryByText(new RegExp(TOKEN_A))).toBeNull();
  });

  it('ignora a resposta assíncrona da empresa anterior', async () => {
    let finishSetup: (value: { kind: 'ok'; webhookRouteId: string; webhookVerifyToken: string }) => void = () => undefined;
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId) => (
      statusOf(companyId, { routeId: null, enabled: false, verify: false })
    ));
    vi.mocked(configureInstagramByoWebhook).mockImplementation(
      () => new Promise((resolve) => { finishSetup = resolve; }),
    );

    const view = render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.webhookGenerate' }));
    view.rerender(<InstagramByoMetaPanel companyId={OTHER} canWrite />);
    finishSetup({ kind: 'ok', webhookRouteId: ROUTE, webhookVerifyToken: STALE });

    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.webhookGenerate' })).toBeTruthy();
    expect(screen.queryByText(new RegExp(STALE))).toBeNull();
  });

  it('não mostra token novo quando a rotação responde 409', async () => {
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId) => (
      statusOf(companyId, { routeId: ROUTE, enabled: true, verify: true })
    ));
    vi.mocked(configureInstagramByoWebhook).mockResolvedValue({ kind: 'conflict' });

    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.webhookRotate' }));

    expect(await screen.findByText('integrations.instagramByo.webhookUnavailable')).toBeTruthy();
    expect(screen.queryByText(new RegExp(TOKEN_A))).toBeNull();
    expect(screen.queryByText(new RegExp(TOKEN_B))).toBeNull();
    expect(screen.getByText('integrations.instagramByo.webhookConfigured')).toBeTruthy();
  });

  it('não exibe token vindo do status e preserva o webhook oficial', async () => {
    const planted = 'token-status-should-stay-hidden';
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId) => {
      const result = statusOf(companyId, { routeId: ROUTE, enabled: true, verify: true });
      if (result.kind !== 'ok') return result;
      return {
        ...result,
        status: {
          ...result.status,
          credentials: { ...result.status.credentials, webhook_verify_token: planted } as never,
        },
      };
    });

    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.webhookConfigured')).toBeTruthy();
    expect(screen.queryByText(planted)).toBeNull();
    expect(screen.getByText('integrations.instagramByo.officialIndependent')).toBeTruthy();

    const official = readFileSync(resolve('api/instagram/webhook.js'), 'utf8');
    expect(official).not.toContain('InstagramByoWebhookSection');
    expect(official).not.toContain('webhook_verify_token');
  });
});
