// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import {
  canViewInstagramByoMeta,
  canWriteInstagramByoMeta,
} from '../instagramByoVisibility';
import { getInstagramByoStatus, type ByoStatusResult } from '../../../services/instagramByoApi';
import { rotateInstagramByoSecret } from '../../../services/instagramByoWriteApi';

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
  return { ...actual, rotateInstagramByoSecret: vi.fn() };
});

const COMPANY_A = 'cccccccc-0000-4000-8000-000000000003';
const COMPANY_B = 'dddddddd-0000-4000-8000-000000000004';
const SECRET = 'segredo-de-teste';

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

function applied(companyId: string, stale = false) {
  return {
    kind: 'ok' as const,
    body: {
      ok: true as const,
      result: stale ? 'idempotent' as const : 'applied' as const,
      company_id: companyId,
      validation_status: 'saved',
      credential_version: stale ? 99 : 3,
      configured: true,
      stale,
    },
  };
}

async function openConfirm() {
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.rotateSecretFields.app-secret'), {
    target: { value: SECRET },
  });
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' }));
  expect(screen.getByText('integrations.instagramByo.rotateSecretWarning')).toBeTruthy();
  expect(screen.getByText('integrations.instagramByo.rotateSecretVersion')).toBeTruthy();
  expect(rotateInstagramByoSecret).not.toHaveBeenCalled();
}

async function confirmSend() {
  await openConfirm();
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretConfirm' }));
}

describe('rotação do App Secret Instagram BYO', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('mostra a rotação para admin e a oculta para manager, partner e seller', async () => {
    const pilot = COMPANY_A;
    expect(canViewInstagramByoMeta({
      companyId: pilot,
      roles: [role(pilot, 'seller')],
    })).toBe(false);
    expect(canWriteInstagramByoMeta({
      companyId: pilot,
      roles: [role(pilot, 'manager')],
    })).toBe(false);
    expect(canWriteInstagramByoMeta({
      companyId: pilot,
      roles: [role(pilot, 'partner')],
    })).toBe(false);
    expect(canWriteInstagramByoMeta({
      companyId: pilot,
      roles: [role(pilot, 'admin')],
    })).toBe(true);

    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    const reader = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite={false} />);
    expect(await screen.findByText('integrations.instagramByo.statusConfigured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeNull();
    reader.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeTruthy();
    const field = screen.getByLabelText('integrations.instagramByo.rotateSecretFields.app-secret');
    expect(field).toHaveProperty('type', 'password');
    expect(field).toHaveProperty('value', '');
    expect(document.getElementById('instagram-byo-rotate-app-id')).toBeNull();
    expect(screen.queryByLabelText('integrations.instagramByo.rotateSecretFields.suat')).toBeNull();
  });

  it('bloqueia a rotação no 404, sem credencial, revogada ou com versão inválida', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue({ kind: 'unavailable' });
    const unavailable = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusUnavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeNull();
    unavailable.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(absent(COMPANY_A, 'not_configured'));
    const missing = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeNull();
    missing.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(absent(COMPANY_A, 'revoked'));
    const revoked = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusRevoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeNull();
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
    expect(await screen.findByText('integrations.instagramByo.statusConfigured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeNull();
  });

  it('exige confirmação e envia um único POST no clique duplo', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(rotateInstagramByoSecret).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeTruthy();
    await openConfirm();
    const confirm = screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretConfirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(rotateInstagramByoSecret).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rotateInstagramByoSecret).mock.calls[0][0]).toMatchObject({
      companyId: COMPANY_A,
      expectedVersion: 2,
      appSecret: SECRET,
    });
    expect(Object.keys(vi.mocked(rotateInstagramByoSecret).mock.calls[0][0]).sort()).toEqual([
      'appSecret',
      'companyId',
      'expectedVersion',
      'requestId',
    ]);
    expect(log.mock.calls.flat().join(' ')).not.toContain(SECRET);
    expect(setItem.mock.calls.flat().join(' ')).not.toContain(SECRET);
    resolveSend(applied(COMPANY_A));
    log.mockRestore();
    setItem.mockRestore();
  });

  it('reutiliza segredo, versão e request_id no retry e na sessão expirada', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    let resolveAuth: (value: { kind: 'session_unavailable' }) => void = () => undefined;
    vi.mocked(rotateInstagramByoSecret)
      .mockResolvedValueOnce({ kind: 'network' })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAuth = resolve;
      }))
      .mockResolvedValueOnce(applied(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeTruthy();
    await confirmSend();
    expect(await screen.findByText('integrations.instagramByo.rotateSecretUnknownOutcome')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' }));
    expect(await screen.findByText('integrations.instagramByo.rotateSecretSending')).toBeTruthy();
    resolveAuth({ kind: 'session_unavailable' });
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' }));
    await vi.waitFor(() => expect(rotateInstagramByoSecret).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(rotateInstagramByoSecret).mock.calls.map((call) => call[0]);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
  });

  it.each(['conflict', 'request_reused'] as const)('limpa o segredo no 409 %s', async (kind) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue({ kind });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeTruthy();
    await confirmSend();
    const key = kind === 'conflict'
      ? 'integrations.instagramByo.rotateSecretConflict'
      : 'integrations.instagramByo.rotateSecretRequestReused';
    expect(await screen.findByText(key)).toBeTruthy();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  });

  it('mostra stale sem a versão antiga e ignora resposta tardia', async () => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(async () => {
      reads += 1;
      return configured(COMPANY_A, reads === 1 ? 2 : 5);
    });
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue(applied(COMPANY_A, true));
    const view = render(<InstagramByoMetaPanel key={COMPANY_A} companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeTruthy();
    await confirmSend();
    expect(await screen.findByText('integrations.instagramByo.rotateSecretStale')).toBeTruthy();
    expect(await screen.findByText('5')).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();

    vi.mocked(rotateInstagramByoSecret).mockClear();
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(rotateInstagramByoSecret).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretConfirm' }));
    view.rerender(<InstagramByoMetaPanel key={COMPANY_B} companyId={COMPANY_B} canWrite />);
    resolveSend(applied(COMPANY_A));
    await Promise.resolve();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByText('integrations.instagramByo.rotateSecretApplied')).toBeNull();
    view.unmount();
  });

  it('avisa desativação e remoção de tokens sem prometer validação da Meta', () => {
    const locale = JSON.parse(readFileSync(resolve('src/locales/pt-BR/settings.app.json'), 'utf8')) as {
      integrations: { instagramByo: Record<string, string> };
    };
    const copy = locale.integrations.instagramByo;
    expect(copy.rotateSecretWarning).toContain('App Secret atual será substituído');
    expect(copy.rotateSecretWarning).toContain('serão desativadas');
    expect(copy.rotateSecretWarning).toContain('serão removidos');
    expect(copy.rotateSecretWarning).toContain('nova validação');
    expect(copy.rotateSecretVersion).toContain('versão esperada');
    expect(copy.rotateSecretApplied).toContain('não valida o segredo na Meta');
  });
});
