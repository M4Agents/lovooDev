// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import {
  INSTAGRAM_BYO_PILOT_COMPANY_ID,
  canWriteInstagramByoMeta,
} from '../instagramByoVisibility';
import { getInstagramByoStatus, type ByoStatusResult } from '../../../services/instagramByoApi';
import { replaceInstagramByoApp } from '../../../services/instagramByoWriteApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../../services/instagramByoApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/instagramByoApi')>(
    '../../../services/instagramByoApi',
  );
  return {
    ...actual,
    getInstagramByoStatus: vi.fn(),
    setInstagramByoCredentials: vi.fn(),
  };
});

vi.mock('../../../services/instagramByoWriteApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/instagramByoWriteApi')>(
    '../../../services/instagramByoWriteApi',
  );
  return {
    ...actual,
    replaceInstagramByoApp: vi.fn(),
  };
});

const COMPANY_A = 'cccccccc-0000-4000-8000-000000000003';
const COMPANY_B = 'dddddddd-0000-4000-8000-000000000004';
const PARENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECRET = 'segredo-de-teste';
const SUAT = 'suat-de-teste';

function role(companyId: string, roleName: 'admin' | 'manager' | 'partner') {
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

function notConfigured(companyId: string): ByoStatusResult {
  const base = configured(companyId);
  if (base.kind !== 'ok') return base;
  return {
    kind: 'ok',
    status: {
      ...base.status,
      credentials: {
        ...base.status.credentials,
        configured: false,
        validation_status: 'not_configured',
        meta_app_id: null,
        credential_version: null,
      },
    },
  };
}

function revoked(companyId: string): ByoStatusResult {
  const base = notConfigured(companyId);
  if (base.kind !== 'ok') return base;
  return {
    kind: 'ok',
    status: {
      ...base.status,
      credentials: {
        ...base.status.credentials,
        validation_status: 'revoked',
        credential_version: 4,
        revoked_at: '2026-10-30T13:00:00.000Z',
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

async function fillAndOpenConfirm() {
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.replaceFields.app-id'), {
    target: { value: '1234567890' },
  });
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.replaceFields.app-secret'), {
    target: { value: SECRET },
  });
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.replaceFields.suat'), {
    target: { value: SUAT },
  });
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.replaceSubmit' }));
  expect(screen.getByText('integrations.instagramByo.replaceWarning')).toBeTruthy();
  expect(screen.getByText('integrations.instagramByo.replaceVersion')).toBeTruthy();
  expect(replaceInstagramByoApp).not.toHaveBeenCalled();
}

async function fillAndConfirm() {
  await fillAndOpenConfirm();
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.replaceConfirm' }));
}

describe('substituição replace_app do Instagram BYO', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('mostra a ação para admin e a oculta para manager e partner', async () => {
    const pilot = INSTAGRAM_BYO_PILOT_COMPANY_ID;
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
      parentCompanyId: PARENT,
      roles: [role(pilot, 'admin')],
    })).toBe(true);

    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    const reader = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite={false} />);
    expect(await screen.findByText('integrations.instagramByo.statusConfigured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeNull();
    expectInputsDisabled();
    reader.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    expect(screen.getByLabelText('integrations.instagramByo.replaceFields.app-secret')).toHaveProperty('value', '');
    expect(screen.getByLabelText('integrations.instagramByo.replaceFields.suat')).toHaveProperty('value', '');
  });

  it('mantém replace bloqueado no HTTP 404', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue({ kind: 'unavailable' });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusUnavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeNull();
    expectInputsDisabled();
    expect(replaceInstagramByoApp).not.toHaveBeenCalled();
  });

  it('bloqueia replace quando configured é false ou o status é revogado', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    const initial = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeNull();
    initial.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(revoked(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusRevoked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeNull();
  });

  it.each([0, 1.5, 2147483648])('bloqueia replace quando a versão é %s', async (version) => {
    const base = configured(COMPANY_A);
    if (base.kind !== 'ok') throw new Error('status invalido');
    vi.mocked(getInstagramByoStatus).mockResolvedValue({
      kind: 'ok',
      status: {
        ...base.status,
        credentials: { ...base.status.credentials, credential_version: version },
      },
    });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusConfigured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeNull();
    expectInputsDisabled();
  });

  it('exige confirmação com aviso de desativação e envia um único POST no clique duplo', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(replaceInstagramByoApp).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    await fillAndOpenConfirm();
    const confirm = screen.getByRole('button', { name: 'integrations.instagramByo.replaceConfirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(replaceInstagramByoApp).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(replaceInstagramByoApp).mock.calls[0][0];
    expect(Object.keys(sent).sort()).toEqual([
      'appSecret',
      'companyId',
      'expectedVersion',
      'metaAppId',
      'requestId',
      'suat',
    ]);
    expect(sent.companyId).toBe(COMPANY_A);
    expect(sent.expectedVersion).toBe(2);
    expect(sent.metaAppId).toBe('1234567890');
    expect(log.mock.calls.flat().join(' ')).not.toContain(SECRET);
    expect(setItem.mock.calls.flat().join(' ')).not.toContain(SECRET);
    resolveSend(applied(COMPANY_A));
    log.mockRestore();
    setItem.mockRestore();
  });

  it.each(['network', 'service_unavailable'] as const)('reutiliza o payload no retry manual de %s', async (kind) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
    vi.mocked(replaceInstagramByoApp)
      .mockResolvedValueOnce({ kind })
      .mockResolvedValueOnce(applied(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    await fillAndConfirm();
    expect(await screen.findByText('integrations.instagramByo.replaceUnknownOutcome')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.replaceRetry' }));
    expect(replaceInstagramByoApp).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(replaceInstagramByoApp).mock.calls;
    expect(second[0]).toEqual(first[0]);
  });

  it.each(['unauthorized', 'session_unavailable'] as const)(
    'preserva a tentativa quando o retry encontra %s',
    async (kind) => {
      vi.mocked(getInstagramByoStatus).mockResolvedValue(configured(COMPANY_A));
      let resolveAuth: (value: { kind: typeof kind }) => void = () => undefined;
      vi.mocked(replaceInstagramByoApp)
        .mockResolvedValueOnce({ kind: 'network' })
        .mockImplementationOnce(() => new Promise((resolve) => {
          resolveAuth = resolve;
        }))
        .mockResolvedValueOnce(applied(COMPANY_A));
      render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
      expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
      await fillAndConfirm();
      expect(await screen.findByText('integrations.instagramByo.replaceUnknownOutcome')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.replaceRetry' }));
      expect(await screen.findByText('integrations.instagramByo.replaceSending')).toBeTruthy();
      resolveAuth({ kind });
      expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceRetry' })).toBeTruthy();
      expect(screen.queryByText('integrations.instagramByo.replaceApplied')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.replaceRetry' }));
      await vi.waitFor(() => {
        expect(replaceInstagramByoApp).toHaveBeenCalledTimes(3);
      });
      const calls = vi.mocked(replaceInstagramByoApp).mock.calls.map((call) => call[0]);
      expect(calls[1]).toEqual(calls[0]);
      expect(calls[2]).toEqual(calls[0]);
    },
  );

  it.each(['conflict', 'request_reused'] as const)('limpa os segredos no 409 %s e consulta o status', async (kind) => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(async () => {
      reads += 1;
      return configured(COMPANY_A, reads === 1 ? 2 : 6);
    });
    vi.mocked(replaceInstagramByoApp).mockResolvedValue({ kind });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    await fillAndConfirm();
    const key = kind === 'conflict'
      ? 'integrations.instagramByo.replaceConflict'
      : 'integrations.instagramByo.replaceRequestReused';
    expect(await screen.findByText(key)).toBeTruthy();
    expect(await screen.findByText('6')).toBeTruthy();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByDisplayValue(SUAT)).toBeNull();
    expect(reads).toBeGreaterThan(1);
  });

  it('mostra stale sem usar a versão antiga da resposta', async () => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(async () => {
      reads += 1;
      return configured(COMPANY_A, reads === 1 ? 2 : 5);
    });
    vi.mocked(replaceInstagramByoApp).mockResolvedValue(applied(COMPANY_A, true));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    await fillAndConfirm();
    expect(await screen.findByText('integrations.instagramByo.replaceStale')).toBeTruthy();
    expect(await screen.findByText('5')).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  });

  it('não dispara POST ao trocar de empresa com a confirmação aberta', async () => {
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId: string) => configured(companyId));
    const view = render(
      <InstagramByoMetaPanel key={COMPANY_A} companyId={COMPANY_A} canWrite />,
    );
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    await fillAndOpenConfirm();
    view.rerender(<InstagramByoMetaPanel key={COMPANY_B} companyId={COMPANY_B} canWrite />);
    expect(replaceInstagramByoApp).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.replaceConfirm' })).toBeNull();
  });

  it('ignora a resposta tardia após trocar de empresa ou desmontar', async () => {
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId: string) => configured(companyId));
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(replaceInstagramByoApp).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    const view = render(
      <InstagramByoMetaPanel key={COMPANY_A} companyId={COMPANY_A} canWrite />,
    );
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    await fillAndConfirm();
    view.rerender(<InstagramByoMetaPanel key={COMPANY_B} companyId={COMPANY_B} canWrite />);
    resolveSend(applied(COMPANY_A));
    await Promise.resolve();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByText('integrations.instagramByo.replaceApplied')).toBeNull();

    vi.mocked(replaceInstagramByoApp).mockClear();
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    await fillAndConfirm();
    view.unmount();
    resolveSend(applied(COMPANY_B));
    await Promise.resolve();
    expect(screen.queryByText('integrations.instagramByo.replaceApplied')).toBeNull();
  });

  it('avisa desativação das contas no texto em português e não trata o sucesso como validação da Meta', () => {
    const locale = JSON.parse(readFileSync(resolve('src/locales/pt-BR/settings.app.json'), 'utf8')) as {
      integrations: { instagramByo: Record<string, string> };
    };
    const copy = locale.integrations.instagramByo;
    expect(copy.replaceWarning).toContain('serão substituídos');
    expect(copy.replaceWarning).toContain('serão desativadas');
    expect(copy.replaceWarning).toContain('serão removidos');
    expect(copy.replaceWarning).toContain('nova validação');
    expect(copy.replaceVersion).toContain('versão esperada');
    expect(copy.replaceApplied).toContain('não valida as credenciais na Meta');
  });
});
