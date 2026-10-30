// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { getInstagramByoStatus, type ByoStatusResult } from '../../../services/instagramByoApi';
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
const FIRST = '17841405822304914';
const SECOND = '17841400000000002';

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

  it('mostra a conta associada sem tratá-la como integração operacional', async () => {
    const current = status();
    if (current.kind !== 'ok') return;
    current.status.credentials.validation_status = 'valid';
    current.status.accounts = [{
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      company_id: COMPANY,
      instagram_account_id: FIRST,
      system_user_id: '99887766',
      instagram_username: 'valleron',
      encryption_version: 1,
      scopes: ['instagram_basic'],
      status: 'poc_disabled',
      status_reason: null,
      created_at: '2026-10-30T12:00:00.000Z',
      updated_at: '2026-10-30T12:00:00.000Z',
    }];
    vi.mocked(getInstagramByoStatus).mockResolvedValue(current);
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect((await screen.findAllByText('integrations.instagramByo.statusValidated')).length).toBeGreaterThan(0);
    expect(screen.getByText(/integrations.instagramByo.associatedAccount/)).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.operationalPending')).toBeTruthy();
    expect(screen.queryByText(/Conectado/)).toBeNull();
  });
});
