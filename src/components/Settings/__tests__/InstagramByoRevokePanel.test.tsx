// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { canViewInstagramByoMeta, canWriteInstagramByoMeta } from '../instagramByoVisibility';
import { getInstagramByoStatus, type ByoStatusResult } from '../../../services/instagramByoApi';
import { revokeInstagramByoCredentials } from '../../../services/instagramByoWriteApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../services/instagramByoApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/instagramByoApi')>(
    '../../../services/instagramByoApi',
  );
  return { ...actual, getInstagramByoStatus: vi.fn(), setInstagramByoCredentials: vi.fn() };
});

vi.mock('../../../services/instagramByoWriteApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/instagramByoWriteApi')>(
    '../../../services/instagramByoWriteApi',
  );
  return { ...actual, revokeInstagramByoCredentials: vi.fn() };
});

const COMPANY_A = 'cccccccc-0000-4000-8000-000000000003';
const COMPANY_B = 'dddddddd-0000-4000-8000-000000000004';

function role(companyId: string, roleName: 'admin' | 'manager' | 'partner' | 'seller') {
  return {
    company_id: companyId,
    role: roleName,
    companies: { id: companyId, name: 'Empresa', company_type: 'client' as const },
  };
}

function configured(companyId: string, version = 2): ByoStatusResult {
  return {
    kind: 'ok',
    status: {
      ok: true,
      company_id: companyId,
      credentials: {
        configured: true,
        validation_status: 'saved',
        meta_app_id: '11111',
        validated_at: null,
        revoked_at: null,
        credential_version: version,
        validation_error_code: null,
      },
      account_status: 'poc_disabled',
      accounts: [],
    },
  };
}

function absent(companyId: string, statusName: 'not_configured' | 'revoked'): ByoStatusResult {
  const base = configured(companyId);
  if (base.kind !== 'ok') return base;
  return {
    kind: 'ok',
    status: {
      ...base.status,
      credentials: {
        ...base.status.credentials,
        configured: false,
        validation_status: statusName,
        meta_app_id: null,
        credential_version: statusName === 'revoked' ? 4 : null,
        revoked_at: statusName === 'revoked' ? '2026-10-30T13:00:00.000Z' : null,
      },
    },
  };
}

function outcome(result: 'applied' | 'idempotent' | 'already_revoked', stale = false) {
  return {
    kind: 'ok' as const,
    body: {
      ok: true as const,
      result,
      company_id: COMPANY_A,
      validation_status: 'revoked',
      credential_version: stale ? 99 : 3,
      configured: false,
      stale,
    },
  };
}

async function openConfirm() {
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.manageRevoke' }));
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeSubmit' }));
  expect(screen.getByText('integrations.instagramByo.revokeWarning')).toBeTruthy();
  expect(screen.getByText('integrations.instagramByo.revokeVersion')).toBeTruthy();
  expect(revokeInstagramByoCredentials).not.toHaveBeenCalled();
}

describe('revogação Instagram BYO', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('mostra a revogação para admin e a oculta sem escrita', async () => {
    const pilot = COMPANY_A;
    expect(canViewInstagramByoMeta({ companyId: pilot, roles: [role(pilot, 'seller')] })).toBe(false);
    expect(canWriteInstagramByoMeta({ companyId: pilot, roles: [role(pilot, 'manager')] })).toBe(false);
    expect(canWriteInstagramByoMeta({ companyId: pilot, roles: [role(pilot, 'partner')] })).toBe(false);
    expect(canWriteInstagramByoMeta({ companyId: pilot, roles: [role(pilot, 'admin')] })).toBe(true);

    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    const reader = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite={false} />);
    expect(await screen.findAllByText('integrations.instagramByo.statusSaved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeNull();
    reader.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.manageRevoke' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeTruthy();
    expect(screen.getByTestId('instagram-byo-revoke').querySelector('input')).toBeNull();
    expect(revokeInstagramByoCredentials).not.toHaveBeenCalled();
  });

  it('bloqueia a revogação no 404, sem credencial, revogada ou com versão inválida', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue({ kind: 'unavailable' });
    const unavailable = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusUnavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeNull();
    unavailable.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(absent(COMPANY_A, 'not_configured'));
    const missing = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeNull();
    missing.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(absent(COMPANY_A, 'revoked'));
    const revoked = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeNull();
    revoked.unmount();

    const base = configured(COMPANY_A);
    if (base.kind !== 'ok') throw new Error('status invalido');
    vi.mocked(getInstagramByoStatus).mockResolvedValue({
      kind: 'ok',
      status: {
        ...base.status,
        credentials: { ...base.status.credentials, credential_version: 1.5 },
      },
    });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findAllByText('integrations.instagramByo.statusSaved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeNull();
  });

  it('exige confirmação, permite cancelar e envia um único POST no clique duplo', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    let resolveSend: (value: ReturnType<typeof outcome>) => void = () => undefined;
    vi.mocked(revokeInstagramByoCredentials).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.manageRevoke' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeTruthy();
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeCancel' }));
    expect(revokeInstagramByoCredentials).not.toHaveBeenCalled();

    await openConfirm();
    const confirm = screen.getByRole('button', { name: 'integrations.instagramByo.revokeConfirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(revokeInstagramByoCredentials).toHaveBeenCalledTimes(1);
    expect(Object.keys(vi.mocked(revokeInstagramByoCredentials).mock.calls[0][0]).sort()).toEqual([
      'companyId',
      'expectedVersion',
      'requestId',
    ]);
    expect(vi.mocked(revokeInstagramByoCredentials).mock.calls[0][0]).toMatchObject({
      companyId: COMPANY_A,
      expectedVersion: 2,
    });
    resolveSend(outcome('applied'));
  });

  it.each([
    ['applied', 'integrations.instagramByo.revokeApplied'],
    ['idempotent', 'integrations.instagramByo.revokeIdempotent'],
    ['already_revoked', 'integrations.instagramByo.revokeAlreadyRevoked'],
  ] as const)('mostra %s sem confundir com outra mensagem', async (result, notice) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    vi.mocked(revokeInstagramByoCredentials).mockResolvedValue(outcome(result));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.manageRevoke' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeTruthy();
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeConfirm' }));
    expect(await screen.findByText(notice)).toBeTruthy();
    if (result === 'already_revoked') {
      expect(screen.queryByText('integrations.instagramByo.revokeApplied')).toBeNull();
    }
  });

  it('reutiliza request_id e versão no retry e na sessão expirada', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    let resolveAuth: (value: { kind: 'session_unavailable' }) => void = () => undefined;
    vi.mocked(revokeInstagramByoCredentials)
      .mockResolvedValueOnce({ kind: 'network' })
      .mockResolvedValueOnce({ kind: 'service_unavailable' })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAuth = resolve;
      }))
      .mockResolvedValueOnce(outcome('applied'));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.manageRevoke' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeTruthy();
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeConfirm' }));
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.revokeRetry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeRetry' }));
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.revokeRetry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeRetry' }));
    expect(await screen.findByText('integrations.instagramByo.revokeSending')).toBeTruthy();
    resolveAuth({ kind: 'session_unavailable' });
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.revokeRetry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeRetry' }));
    await vi.waitFor(() => expect(revokeInstagramByoCredentials).toHaveBeenCalledTimes(4));
    const calls = vi.mocked(revokeInstagramByoCredentials).mock.calls.map((call) => call[0]);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
    expect(calls[3]).toEqual(calls[0]);
  });

  it.each(['conflict', 'request_reused'] as const)('encerra a tentativa no 409 %s e atualiza o GET', async (kind) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    vi.mocked(revokeInstagramByoCredentials).mockResolvedValue({ kind });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.manageRevoke' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeTruthy();
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeConfirm' }));
    const key = kind === 'conflict'
      ? 'integrations.instagramByo.revokeConflict'
      : 'integrations.instagramByo.revokeRequestReused';
    expect(await screen.findByText(key)).toBeTruthy();
    await vi.waitFor(() => expect(getInstagramByoStatus).toHaveBeenCalledTimes(2));
  });

  it('mostra stale pelo GET e ignora resposta tardia de outra empresa', async () => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(async () => {
      reads += 1;
      return configured(COMPANY_A, reads === 1 ? 2 : 5);
    });
    vi.mocked(revokeInstagramByoCredentials).mockResolvedValue(outcome('idempotent', true));
    const view = render(<InstagramByoMetaPanel key={COMPANY_A} companyId={COMPANY_A} canWrite />);
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.manageRevoke' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeTruthy();
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeConfirm' }));
    expect(await screen.findByText('integrations.instagramByo.revokeStale')).toBeTruthy();
    expect(await screen.findByText('5')).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();

    vi.mocked(revokeInstagramByoCredentials).mockClear();
    let resolveSend: (value: ReturnType<typeof outcome>) => void = () => undefined;
    vi.mocked(revokeInstagramByoCredentials).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.revokeConfirm' }));
    view.rerender(<InstagramByoMetaPanel key={COMPANY_B} companyId={COMPANY_B} canWrite />);
    resolveSend(outcome('applied'));
    await Promise.resolve();
    expect(screen.queryByText('integrations.instagramByo.revokeApplied')).toBeNull();
    view.unmount();
  });

  it('avisa desativação, remoção de tokens e reativação futura', () => {
    const locale = JSON.parse(readFileSync(resolve('src/locales/pt-BR/settings.app.json'), 'utf8')) as {
      integrations: { instagramByo: Record<string, string> };
    };
    const copy = locale.integrations.instagramByo;
    expect(copy.revokeWarning).toContain('serão revogadas');
    expect(copy.revokeWarning).toContain('serão desativadas');
    expect(copy.revokeWarning).toContain('serão removidos');
    expect(copy.revokeWarning).toContain('não poderá operar');
    expect(copy.revokeWarning).toContain('novo cadastro de credenciais');
    expect(copy.revokeVersion).toContain('versão esperada');
    expect(copy.revokeApplied).not.toContain('já estavam revogadas');
    expect(copy.revokeAlreadyRevoked).toBe('As credenciais já estavam revogadas. A versão da credencial foi mantida. As contas Instagram BYO associadas foram desativadas e seus tokens removidos. O status será atualizado.');
    expect(copy.revokeAlreadyRevoked).not.toBe(copy.revokeApplied);
    expect(copy.revokeAlreadyRevoked).not.toBe(copy.revokeIdempotent);
    expect(copy.alreadyRevoked).not.toContain('atualizado');
  });
});
