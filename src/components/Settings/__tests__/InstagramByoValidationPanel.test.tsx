// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { getInstagramByoStatus, type ByoStatusAccount, type ByoStatusResult } from '../../../services/instagramByoApi';
import {
  associateInstagramByoAccount,
  validateInstagramByoWithMeta,
} from '../../../services/instagramByoValidationApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
const FIRST = '17841405822304914';
const SECOND = '17841400000000002';

function associatedAccount(overrides: Partial<ByoStatusAccount> = {}): ByoStatusAccount {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    company_id: COMPANY,
    instagram_account_id: FIRST,
    system_user_id: '99887766',
    instagram_username: 'usevalleron',
    encryption_version: 1,
    scopes: ['instagram_basic'],
    status: 'poc_disabled',
    status_reason: null,
    created_at: '2026-10-30T12:00:00.000Z',
    updated_at: '2026-10-30T12:00:00.000Z',
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

describe('validação visual Instagram BYO', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('não consulta a Meta ao abrir a tela e oculta a ação de quem não escreve', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(status());
    const reader = render(<InstagramByoMetaPanel companyId={COMPANY} canWrite={false} />);
    expect((await screen.findAllByText('integrations.instagramByo.statusSaved')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.validateWithMeta' })).toBeNull();
    expect(validateInstagramByoWithMeta).not.toHaveBeenCalled();
    reader.unmount();

    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.validateWithMeta' })).toBeTruthy();
    expect(validateInstagramByoWithMeta).not.toHaveBeenCalled();
    expect(associateInstagramByoAccount).not.toHaveBeenCalled();
  });

  it('lista as contas e só associa a escolhida depois da confirmação', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(status());
    vi.mocked(validateInstagramByoWithMeta).mockResolvedValue({
      kind: 'ok',
      validationStatus: 'valid',
      credentialVersion: 3,
      errorCode: null,
      accounts: [
        { instagram_account_id: FIRST, instagram_username: 'valleron' },
        { instagram_account_id: SECOND, instagram_username: 'outra' },
      ],
      account: null,
    });
    vi.mocked(associateInstagramByoAccount).mockResolvedValue({
      kind: 'ok',
      validationStatus: 'valid',
      credentialVersion: 4,
      errorCode: null,
      accounts: [],
      account: { instagram_account_id: FIRST, instagram_username: 'valleron' },
    });
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.validateWithMeta' }));
    expect(await screen.findByText('valleron')).toBeTruthy();
    expect(screen.getByText('outra')).toBeTruthy();
    expect(associateInstagramByoAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'outra' }));
    expect(associateInstagramByoAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'valleron' }));
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.confirmAccount' }));
    await act(async () => { await Promise.resolve(); });
    expect(associateInstagramByoAccount).toHaveBeenCalledTimes(1);
    expect(vi.mocked(associateInstagramByoAccount).mock.calls[0][0].instagramAccountId).toBe(FIRST);
    expect(vi.mocked(associateInstagramByoAccount).mock.calls[0][0].expectedVersion).toBe(3);
  });

  it('mostra o badge verde só com credencial válida e conta associada', async () => {
    const current = status();
    if (current.kind !== 'ok') return;
    current.status.credentials.validation_status = 'valid';
    current.status.account_status = 'poc_disabled';
    current.status.accounts = [associatedAccount()];
    vi.mocked(getInstagramByoStatus).mockResolvedValue(current);
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusConnectedMeta')).toBeTruthy();
    expect(screen.getByText('@usevalleron')).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.connectedAccountLine')).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.operationalPending')).toBeTruthy();
    expect(screen.getAllByText('integrations.instagramByo.statusValidated').length).toBeGreaterThan(0);
    expect(screen.queryByText('integrations.instagramByo.associatedAccount')).toBeNull();
  });

  it('não mostra o badge quando a validação está válida sem conta', async () => {
    const current = status();
    if (current.kind !== 'ok') return;
    current.status.credentials.validation_status = 'valid';
    vi.mocked(getInstagramByoStatus).mockResolvedValue(current);
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect((await screen.findAllByText('integrations.instagramByo.statusValidated')).length).toBeGreaterThan(0);
    expect(screen.queryByText('integrations.instagramByo.statusConnectedMeta')).toBeNull();
  });

  it('não mostra o badge com credenciais salvas mesmo havendo conta', async () => {
    const saved = status();
    if (saved.kind !== 'ok') return;
    saved.status.accounts = [associatedAccount()];
    saved.status.account_status = 'poc_disabled';
    vi.mocked(getInstagramByoStatus).mockResolvedValue(saved);
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect((await screen.findAllByText('integrations.instagramByo.statusSaved')).length).toBeGreaterThan(0);
    expect(screen.queryByText('integrations.instagramByo.statusConnectedMeta')).toBeNull();
    expect(screen.getByText(/integrations.instagramByo.associatedAccount/)).toBeTruthy();
  });

  it('não mostra o badge quando a conta está poc_enabled', async () => {
    const enabled = status();
    if (enabled.kind !== 'ok') return;
    enabled.status.credentials.validation_status = 'valid';
    enabled.status.account_status = 'poc_enabled';
    enabled.status.accounts = [associatedAccount({ status: 'poc_enabled' })];
    vi.mocked(getInstagramByoStatus).mockResolvedValue(enabled);
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect(await screen.findByText(/integrations.instagramByo.associatedAccount/)).toBeTruthy();
    expect(screen.queryByText('integrations.instagramByo.statusConnectedMeta')).toBeNull();
    expect(screen.queryByText('@usevalleron')).toBeNull();
  });

  it('não mostra o badge em falha, revogação, pendência ou conta com motivo', async () => {
    const cases = [
      ['failed', 'integrations.instagramByo.statusFailed'],
      ['revoked', 'integrations.instagramByo.statusRevokedShort'],
      ['pending', 'integrations.instagramByo.statusPending'],
    ] as const;
    for (const [validationStatus, text] of cases) {
      cleanup();
      const current = status();
      if (current.kind !== 'ok') return;
      current.status.credentials.validation_status = validationStatus;
      current.status.accounts = [associatedAccount()];
      vi.mocked(getInstagramByoStatus).mockResolvedValue(current);
      render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
      expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
      expect(screen.queryByText('integrations.instagramByo.statusConnectedMeta')).toBeNull();
    }
    cleanup();
    const reset = status();
    if (reset.kind !== 'ok') return;
    reset.status.credentials.validation_status = 'valid';
    reset.status.accounts = [associatedAccount({ status_reason: 'validation_reset' })];
    vi.mocked(getInstagramByoStatus).mockResolvedValue(reset);
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect((await screen.findAllByText('integrations.instagramByo.statusValidated')).length).toBeGreaterThan(0);
    expect(screen.queryByText('integrations.instagramByo.statusConnectedMeta')).toBeNull();
    expect(screen.queryByText('@usevalleron')).toBeNull();
  });

  it('não mostra o badge quando o GET falha', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue({ kind: 'unavailable' });
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusUnavailable')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramByo.statusConnectedMeta')).toBeNull();
  });

  it('remove o badge ao trocar de empresa', async () => {
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId: string) => {
      const current = status();
      if (current.kind !== 'ok') return current;
      current.status.company_id = companyId;
      if (companyId === COMPANY) {
        current.status.credentials.validation_status = 'valid';
        current.status.account_status = 'poc_disabled';
        current.status.accounts = [associatedAccount()];
      }
      return current;
    });
    const view = render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect(await screen.findByText('@usevalleron')).toBeTruthy();
    view.rerender(<InstagramByoMetaPanel companyId={OTHER} canWrite />);
    expect((await screen.findAllByText('integrations.instagramByo.statusSaved')).length).toBeGreaterThan(0);
    expect(screen.queryByText('integrations.instagramByo.statusConnectedMeta')).toBeNull();
    expect(screen.queryByText('@usevalleron')).toBeNull();
  });
});
