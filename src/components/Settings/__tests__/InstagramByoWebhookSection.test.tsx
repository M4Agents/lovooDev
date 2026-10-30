// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoWebhookSection } from '../InstagramByoWebhookSection';
import { configureInstagramByoWebhook } from '../../../services/instagramByoWebhookApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../services/instagramByoWebhookApi', () => ({
  configureInstagramByoWebhook: vi.fn(),
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const ROUTE = 'ab'.repeat(32);

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
