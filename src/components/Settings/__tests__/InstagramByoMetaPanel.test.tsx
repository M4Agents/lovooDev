// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { getInstagramByoStatus, type ByoStatusResult } from '../../../services/instagramByoApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../services/instagramByoApi', () => ({
  getInstagramByoStatus: vi.fn(),
}));

const COMPANY_A = 'cccccccc-0000-4000-8000-000000000003';
const COMPANY_B = 'dddddddd-0000-4000-8000-000000000004';

function status(companyId: string, configured: boolean, appId: string | null): ByoStatusResult {
  return {
    kind: 'ok',
    status: {
      ok: true,
      company_id: companyId,
      credentials: {
        configured,
        validation_status: configured ? 'saved' : 'not_configured',
        meta_app_id: appId,
        validated_at: configured ? '2026-10-30T12:00:00.000Z' : null,
        revoked_at: configured ? '2026-10-30T13:00:00.000Z' : null,
        credential_version: configured ? 2 : null,
        validation_error_code: null,
      },
      account_status: 'not_connected',
      accounts: [],
    },
  };
}

function ByoPanelHost({ companyId }: { companyId: string | null }) {
  return (
    <InstagramByoMetaPanel
      key={companyId ?? 'no-company'}
      companyId={companyId}
    />
  );
}

function expectInputsDisabled() {
  const fields = document.querySelectorAll('input');
  expect(fields).toHaveLength(3);
  for (const field of fields) {
    expect(field).toHaveProperty('disabled', true);
    expect(field).toHaveProperty('readOnly', true);
    expect(field).toHaveProperty('value', '');
  }
  expect(document.querySelector('button')).toBeNull();
}

describe('InstagramByoMetaPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('mostra a prévia sem gravar nem enviar credenciais', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    render(<InstagramByoMetaPanel />);

    expect(screen.getByRole('heading', { name: 'integrations.instagramByo.title' })).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.badgePreparing')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramByo.stateCredentials')).toBeNull();
    expectInputsDisabled();
    expect(getInstagramByoStatus).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    setItem.mockRestore();
  });

  it('mostra indisponível no HTTP 404', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue({ kind: 'unavailable' });

    render(<InstagramByoMetaPanel companyId={COMPANY_A} />);

    expect(await screen.findByText('integrations.instagramByo.statusUnavailable')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramByo.stateCredentials')).toBeNull();
    expectInputsDisabled();
  });

  it('mostra não configurado somente com configured false', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(status(COMPANY_A, false, null));

    render(<InstagramByoMetaPanel companyId={COMPANY_A} />);

    expect(await screen.findByText('integrations.instagramByo.stateCredentials')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramByo.metaAppId')).toBeNull();
  });

  it('mostra metadados seguros quando configured é true', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(status(COMPANY_A, true, '1234567890'));

    render(<InstagramByoMetaPanel companyId={COMPANY_A} />);

    expect(await screen.findByText('1234567890')).toBeTruthy();
    expect(screen.getByText('saved')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('2026-10-30T12:00:00.000Z')).toBeTruthy();
    expect(screen.getByText('2026-10-30T13:00:00.000Z')).toBeTruthy();
    expectInputsDisabled();
  });

  it.each(['denied', 'temporary'] as const)('mostra o estado %s', async (kind) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue({ kind });

    render(<InstagramByoMetaPanel companyId={COMPANY_A} />);

    const key = kind === 'denied'
      ? 'integrations.instagramByo.statusDenied'
      : 'integrations.instagramByo.statusTemporary';
    expect(await screen.findByText(key)).toBeTruthy();
  });

  it('cancela a leitura ao desmontar', () => {
    let signal: AbortSignal | undefined;
    vi.mocked(getInstagramByoStatus).mockImplementation((_companyId, next) => {
      signal = next;
      return new Promise(() => undefined);
    });

    const view = render(<InstagramByoMetaPanel companyId={COMPANY_A} />);
    view.unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('remove o App ID da empresa anterior antes da resposta da nova', async () => {
    const signals: AbortSignal[] = [];
    let resolveNext: (value: ByoStatusResult) => void = () => undefined;
    vi.mocked(getInstagramByoStatus).mockImplementation((companyId, signal) => {
      if (signal) signals.push(signal);
      if (companyId === COMPANY_A) return Promise.resolve(status(COMPANY_A, true, '11111'));
      return new Promise((resolve) => {
        resolveNext = resolve;
      });
    });

    const view = render(<ByoPanelHost companyId={COMPANY_A} />);
    expect(await screen.findByText('11111')).toBeTruthy();
    const signalA = signals[0];

    view.rerender(<ByoPanelHost companyId={COMPANY_B} />);

    expect(screen.queryByText('11111')).toBeNull();
    expect(screen.queryByText('99999')).toBeNull();
    expect(signalA?.aborted).toBe(true);

    resolveNext(status(COMPANY_B, true, '99999'));
    expect(await screen.findByText('99999')).toBeTruthy();
    expect(screen.queryByText('11111')).toBeNull();
    expectInputsDisabled();
  });

  it('troca de empresa sem exibir a resposta antiga', async () => {
    let resolveFirst: (value: ByoStatusResult) => void = () => undefined;
    vi.mocked(getInstagramByoStatus).mockImplementation((companyId) => {
      if (companyId === COMPANY_A) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(status(COMPANY_B, true, '99999'));
    });

    const view = render(<InstagramByoMetaPanel companyId={COMPANY_A} />);
    view.rerender(<InstagramByoMetaPanel companyId={COMPANY_B} />);

    expect(await screen.findByText('99999')).toBeTruthy();
    resolveFirst(status(COMPANY_A, true, '11111'));
    await Promise.resolve();

    expect(screen.queryByText('11111')).toBeNull();
    expect(screen.getByText('99999')).toBeTruthy();
  });

  it('não envia POST e preserva a aba oficial', () => {
    const panel = readFileSync(resolve('src/components/Settings/InstagramByoMetaPanel.tsx'), 'utf8');
    const settings = readFileSync(resolve('src/pages/Settings.tsx'), 'utf8');

    expect(panel).not.toContain('byo-poc/credentials');
    expect(panel).not.toContain('byo-poc/revoke');
    expect(panel).toContain('disabled');
    expect(panel).toContain('readOnly');
    expect(settings).toContain("integracoesTab === 'instagram'");
    expect(settings).toContain('<InstagramConnectionPanel companyId={company.id} />');
    expect(settings).toContain("key={company?.id ?? 'no-company'}");
    expect(settings).toContain('companyId={company?.id ?? null}');
  });
});
