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
import { rotateInstagramByoSuat } from '../../../services/instagramByoWriteApi';

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
  return { ...actual, rotateInstagramByoSuat: vi.fn() };
});

const COMPANY_A = 'cccccccc-0000-4000-8000-000000000003';
const COMPANY_B = 'dddddddd-0000-4000-8000-000000000004';
const SUAT = 'token-de-teste';

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
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.rotateSuatFields.suat'), {
    target: { value: SUAT },
  });
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' }));
  expect(screen.getByText('integrations.instagramByo.rotateSuatWarning')).toBeTruthy();
  expect(screen.getByText('integrations.instagramByo.rotateSuatVersion')).toBeTruthy();
  expect(rotateInstagramByoSuat).not.toHaveBeenCalled();
}

async function confirmSend() {
  await openConfirm();
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatConfirm' }));
}

describe('rotação do SUAT Instagram BYO', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('mostra a rotação para admin e a oculta para manager, partner e seller', async () => {
    const pilot = COMPANY_A;
    expect(canViewInstagramByoMeta({ companyId: pilot, roles: [role(pilot, 'seller')] })).toBe(false);
    expect(canWriteInstagramByoMeta({ companyId: pilot, roles: [role(pilot, 'manager')] })).toBe(false);
    expect(canWriteInstagramByoMeta({ companyId: pilot, roles: [role(pilot, 'partner')] })).toBe(false);
    expect(canWriteInstagramByoMeta({ companyId: pilot, roles: [role(pilot, 'admin')] })).toBe(true);

    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    const reader = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite={false} />);
    expect(await screen.findByText('integrations.instagramByo.statusConfigured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeNull();
    reader.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeTruthy();
    const field = screen.getByLabelText('integrations.instagramByo.rotateSuatFields.suat');
    expect(field).toHaveProperty('type', 'password');
    expect(field).toHaveProperty('value', '');
    expect(document.getElementById('instagram-byo-rotate-suat-app-id')).toBeNull();
    expect(screen.queryByLabelText('integrations.instagramByo.rotateSuatFields.app-secret')).toBeNull();
  });

  it('bloqueia a rotação no 404, sem credencial, revogada ou com versão inválida', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue({ kind: 'unavailable' });
    const unavailable = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusUnavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeNull();
    unavailable.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(absent(COMPANY_A, 'not_configured'));
    const missing = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeNull();
    missing.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(absent(COMPANY_A, 'revoked'));
    const revoked = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusRevoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeNull();
  });

  it('exige confirmação e envia um único POST no clique duplo', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(rotateInstagramByoSuat).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeTruthy();
    await openConfirm();
    const confirm = screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatConfirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(rotateInstagramByoSuat).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rotateInstagramByoSuat).mock.calls[0][0]).toMatchObject({
      companyId: COMPANY_A,
      expectedVersion: 2,
      suat: SUAT,
    });
    expect(Object.keys(vi.mocked(rotateInstagramByoSuat).mock.calls[0][0]).sort()).toEqual([
      'companyId',
      'expectedVersion',
      'requestId',
      'suat',
    ]);
    expect(log.mock.calls.flat().join(' ')).not.toContain(SUAT);
    expect(setItem.mock.calls.flat().join(' ')).not.toContain(SUAT);
    resolveSend(applied(COMPANY_A));
    log.mockRestore();
    setItem.mockRestore();
  });

  it('reutiliza token, versão e request_id no retry e na sessão expirada', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    let resolveAuth: (value: { kind: 'session_unavailable' }) => void = () => undefined;
    vi.mocked(rotateInstagramByoSuat)
      .mockResolvedValueOnce({ kind: 'network' })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAuth = resolve;
      }))
      .mockResolvedValueOnce(applied(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeTruthy();
    await confirmSend();
    expect(await screen.findByText('integrations.instagramByo.rotateSuatUnknownOutcome')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatRetry' }));
    expect(await screen.findByText('integrations.instagramByo.rotateSuatSending')).toBeTruthy();
    resolveAuth({ kind: 'session_unavailable' });
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSuatRetry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatRetry' }));
    await vi.waitFor(() => expect(rotateInstagramByoSuat).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(rotateInstagramByoSuat).mock.calls.map((call) => call[0]);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[2]).toEqual(calls[0]);
  });

  it.each(['conflict', 'request_reused'] as const)('limpa o token no 409 %s', async (kind) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    vi.mocked(rotateInstagramByoSuat).mockResolvedValue({ kind });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeTruthy();
    await confirmSend();
    const key = kind === 'conflict'
      ? 'integrations.instagramByo.rotateSuatConflict'
      : 'integrations.instagramByo.rotateSuatRequestReused';
    expect(await screen.findByText(key)).toBeTruthy();
    expect(screen.queryByDisplayValue(SUAT)).toBeNull();
  });

  it('mostra stale sem a versão antiga e ignora resposta tardia', async () => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(async () => {
      reads += 1;
      return configured(COMPANY_A, reads === 1 ? 2 : 5);
    });
    vi.mocked(rotateInstagramByoSuat).mockResolvedValue(applied(COMPANY_A, true));
    const view = render(<InstagramByoMetaPanel key={COMPANY_A} companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' })).toBeTruthy();
    await confirmSend();
    expect(await screen.findByText('integrations.instagramByo.rotateSuatStale')).toBeTruthy();
    expect(await screen.findByText('5')).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();
    expect(screen.queryByDisplayValue(SUAT)).toBeNull();

    vi.mocked(rotateInstagramByoSuat).mockClear();
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(rotateInstagramByoSuat).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatConfirm' }));
    view.rerender(<InstagramByoMetaPanel key={COMPANY_B} companyId={COMPANY_B} canWrite />);
    resolveSend(applied(COMPANY_A));
    await Promise.resolve();
    expect(screen.queryByDisplayValue(SUAT)).toBeNull();
    expect(screen.queryByText('integrations.instagramByo.rotateSuatApplied')).toBeNull();
    view.unmount();
  });

  it('avisa desativação e remoção de tokens sem prometer validação da Meta', () => {
    const locale = JSON.parse(readFileSync(resolve('src/locales/pt-BR/settings.app.json'), 'utf8')) as {
      integrations: {
        instagramByo: {
          rotateSuatWarning: string;
          rotateSuatVersion: string;
          rotateSuatApplied: string;
          rotateSuatFields: { suat: string };
        };
      };
    };
    const copy = locale.integrations.instagramByo;
    expect(copy.rotateSuatWarning).toContain('SUAT atual será substituído');
    expect(copy.rotateSuatWarning).toContain('serão desativadas');
    expect(copy.rotateSuatWarning).toContain('serão removidos');
    expect(copy.rotateSuatWarning).toContain('nova validação');
    expect(copy.rotateSuatVersion).toContain('versão esperada');
    expect(copy.rotateSuatApplied).toContain('não valida o token na Meta');
    expect(copy.rotateSuatFields.suat).toBe('Novo System User Access Token');
  });
});
