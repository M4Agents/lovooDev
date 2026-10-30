// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { getInstagramByoStatus, setInstagramByoCredentials, type ByoStatusResult } from '../../../services/instagramByoApi';
import {
  replaceInstagramByoApp,
  revokeInstagramByoCredentials,
  rotateInstagramByoSecret,
  rotateInstagramByoSuat,
} from '../../../services/instagramByoWriteApi';

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
  return {
    ...actual,
    replaceInstagramByoApp: vi.fn(),
    rotateInstagramByoSecret: vi.fn(),
    rotateInstagramByoSuat: vi.fn(),
    revokeInstagramByoCredentials: vi.fn(),
  };
});

const COMPANY_A = 'cccccccc-0000-4000-8000-000000000003';
const COMPANY_B = 'dddddddd-0000-4000-8000-000000000004';
const SECRET = 'segredo-de-teste';

function status(companyId: string, version: number, revoked = false): ByoStatusResult {
  return {
    kind: 'ok',
    status: {
      ok: true,
      company_id: companyId,
      credentials: {
        configured: !revoked,
        validation_status: revoked ? 'revoked' : 'saved',
        meta_app_id: revoked ? null : '11111',
        validated_at: null,
        revoked_at: revoked ? '2026-10-30T13:00:00.000Z' : null,
        credential_version: version,
        validation_error_code: null,
      },
      account_status: 'poc_disabled',
      accounts: [],
    },
  };
}

function outcome(result: 'applied' | 'conflict') {
  if (result === 'conflict') return { kind: 'conflict' as const };
  return {
    kind: 'ok' as const,
    body: {
      ok: true as const,
      result: 'applied' as const,
      company_id: COMPANY_A,
      validation_status: 'saved',
      credential_version: 3,
      configured: true,
      stale: false,
    },
  };
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

async function ready(version = 2) {
  vi.mocked(getInstagramByoStatus).mockResolvedValue(status(COMPANY_A, version));
  render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
  expect(await screen.findByText(String(version))).toBeTruthy();
  await flush();
}
async function openRotate() {
  fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.manageRotateSecret' }));
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.rotateSecretFields.app-secret', { hidden: true }), {
    target: { value: SECRET },
  });
  fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretSubmit' }));
  expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' })).toBeTruthy();
}

async function openRevoke() {
  fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.manageRevoke' }));
  fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeSubmit' }));
  expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' })).toBeTruthy();
}

describe('concorrência visual Instagram BYO', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('mantém os dois avisos quando o conflito chega antes do sucesso', async () => {
    await ready();
    let resolveRotate: (value: ReturnType<typeof outcome>) => void = () => undefined;
    vi.mocked(rotateInstagramByoSecret).mockImplementation(() => new Promise((resolve) => {
      resolveRotate = resolve;
    }));
    vi.mocked(revokeInstagramByoCredentials).mockResolvedValue(outcome('conflict'));
    await openRotate();
    await openRevoke();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' }));
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' }));
    expect(await screen.findByText('integrations.instagramByo.revokeConflict')).toBeTruthy();
    expect(vi.mocked(rotateInstagramByoSecret).mock.calls[0][0].expectedVersion).toBe(2);
    expect(vi.mocked(revokeInstagramByoCredentials).mock.calls[0][0].expectedVersion).toBe(2);
    resolveRotate(outcome('applied'));
    expect(await screen.findByText('integrations.instagramByo.rotateSecretApplied')).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.revokeConflict')).toBeTruthy();
  });

  it('mantém os dois avisos quando o sucesso chega antes do conflito', async () => {
    await ready();
    let resolveRevoke: (value: ReturnType<typeof outcome>) => void = () => undefined;
    vi.mocked(revokeInstagramByoCredentials).mockImplementation(() => new Promise((resolve) => {
      resolveRevoke = resolve;
    }));
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue(outcome('applied'));
    await openRotate();
    await openRevoke();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' }));
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' }));
    expect(await screen.findByText('integrations.instagramByo.rotateSecretApplied')).toBeTruthy();
    resolveRevoke(outcome('conflict'));
    expect(await screen.findByText('integrations.instagramByo.revokeConflict')).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.rotateSecretApplied')).toBeTruthy();
  });

  it('preserva rascunho, confirmação, retry e o mesmo request_id durante o refresh', async () => {
    let reads = 0;
    let releaseRefresh: (value: ByoStatusResult) => void = () => undefined;
    vi.mocked(getInstagramByoStatus).mockImplementation(() => {
      reads += 1;
      if (reads === 1) return Promise.resolve(status(COMPANY_A, 2));
      return new Promise((resolve) => {
        releaseRefresh = resolve;
      });
    });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('2')).toBeTruthy();
    await flush();
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.rotateSuatFields.suat', { hidden: true }), {
      target: { value: ' token-ficticio ' },
    });
    await openRotate();
    vi.mocked(revokeInstagramByoCredentials).mockResolvedValue({ kind: 'network' });
    await openRevoke();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' }));
    expect(await screen.findByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeRetry' })).toBeTruthy();
    const firstRevoke = vi.mocked(revokeInstagramByoCredentials).mock.calls[0][0];
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue(outcome('applied'));
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' }));
    expect(await screen.findByText('integrations.instagramByo.statusRefreshing')).toBeTruthy();
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.getByLabelText('integrations.instagramByo.rotateSuatFields.suat', { hidden: true })).toHaveProperty('value', ' token-ficticio ');
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeRetry' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSuatSubmit' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeRetry' }));
    expect(vi.mocked(revokeInstagramByoCredentials).mock.calls[1][0]).toEqual(firstRevoke);
    releaseRefresh({ kind: 'temporary' });
    expect(await screen.findByText('integrations.instagramByo.statusUnconfirmed')).toBeTruthy();
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSuatSubmit' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeRetry' }));
    expect(vi.mocked(revokeInstagramByoCredentials).mock.calls[2][0]).toEqual(firstRevoke);
    const callsBeforeRefresh = vi.mocked(getInstagramByoStatus).mock.calls.length;
    fireEvent.click(screen.getByTestId('instagram-byo-refresh-status'));
    expect(vi.mocked(revokeInstagramByoCredentials)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(getInstagramByoStatus).mock.calls.length).toBe(callsBeforeRefresh + 1);
  });

  it('ignora o GET antigo quando um GET novo já confirmou a versão', async () => {
    const pending: Array<(value: ByoStatusResult) => void> = [];
    vi.mocked(getInstagramByoStatus).mockImplementation(() => new Promise((resolve) => {
      pending.push(resolve);
    }));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    pending[0](status(COMPANY_A, 2));
    expect(await screen.findByText('2')).toBeTruthy();
    await flush();
    vi.mocked(revokeInstagramByoCredentials).mockResolvedValue(outcome('conflict'));
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue(outcome('applied'));
    await openRevoke();
    await openRotate();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' }));
    await screen.findByText('integrations.instagramByo.statusRefreshing');
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' }));
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    pending[2](status(COMPANY_A, 7));
    expect(await screen.findByText('7')).toBeTruthy();
    pending[1](status(COMPANY_A, 5));
    await flush();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.queryByText('5')).toBeNull();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeSubmit' }));
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' }));
    expect(vi.mocked(revokeInstagramByoCredentials).mock.calls.at(-1)?.[0].expectedVersion).toBe(7);
  });

  it('libera nova tentativa só com a versão confirmada e preserva a tentativa congelada', async () => {
    let reads = 0;
    const pending: Array<(value: ByoStatusResult) => void> = [];
    vi.mocked(getInstagramByoStatus).mockImplementation(() => {
      reads += 1;
      if (reads === 1) return Promise.resolve(status(COMPANY_A, 2));
      return new Promise((resolve) => {
        pending.push(resolve);
      });
    });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('2')).toBeTruthy();
    await flush();
    await openRotate();
    vi.mocked(revokeInstagramByoCredentials).mockResolvedValue(outcome('applied'));
    await openRevoke();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' }));
    expect(await screen.findByText('integrations.instagramByo.statusRefreshing')).toBeTruthy();
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' })).toHaveProperty('disabled', false);
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue({ kind: 'network' });
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' }));
    expect(vi.mocked(rotateInstagramByoSecret).mock.calls[0][0].expectedVersion).toBe(2);
    pending[0](status(COMPANY_A, 4, true));
    expect(await screen.findByText('4')).toBeTruthy();
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretRetry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretDiscard' }));
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.rotateSecretFields.app-secret', { hidden: true }), {
      target: { value: SECRET },
    });
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretSubmit' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeSubmit' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeSubmit' }));
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretSubmit' }));
    expect(vi.mocked(revokeInstagramByoCredentials)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rotateInstagramByoSecret)).toHaveBeenCalledTimes(1);
  });

  it('descarta aviso e resposta tardia ao trocar de empresa', async () => {
    let resolveSend: (value: ReturnType<typeof outcome>) => void = () => undefined;
    vi.mocked(getInstagramByoStatus).mockImplementation((companyId) => (
      Promise.resolve(status(companyId, companyId === COMPANY_A ? 2 : 8))
    ));
    vi.mocked(revokeInstagramByoCredentials).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    const view = render(<InstagramByoMetaPanel key={COMPANY_A} companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('2')).toBeTruthy();
    await flush();
    await openRevoke();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' }));
    view.rerender(<InstagramByoMetaPanel key={COMPANY_B} companyId={COMPANY_B} canWrite />);
    expect(await screen.findByText('8')).toBeTruthy();
    resolveSend(outcome('applied'));
    await flush();
    expect(screen.queryByText('integrations.instagramByo.revokeApplied')).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
  });

  it('mostra set, replace, rotações e revoke nos estados elegíveis', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(status(COMPANY_A, 2));
    const active = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.manageReplace' })).toBeTruthy();
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.manageRotateSecret' })).toBeTruthy();
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.manageRotateSuat' })).toBeTruthy();
    expect(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.manageRevoke' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeNull();
    expect(replaceInstagramByoApp).not.toHaveBeenCalled();
    expect(rotateInstagramByoSuat).not.toHaveBeenCalled();
    expect(setInstagramByoCredentials).not.toHaveBeenCalled();
    active.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue({
      kind: 'ok',
      status: {
        ok: true,
        company_id: COMPANY_A,
        credentials: {
          configured: false,
          validation_status: 'not_configured',
          meta_app_id: null,
          validated_at: null,
          revoked_at: null,
          credential_version: null,
          validation_error_code: null,
        },
        account_status: 'not_connected',
        accounts: [],
      },
    });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeNull();
  });

  it('mantém a recuperação acessível depois da revogação', async () => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(() => {
      reads += 1;
      return Promise.resolve(status(COMPANY_A, reads === 1 ? 2 : 3, reads > 1));
    });
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue({ kind: 'network' });
    vi.mocked(revokeInstagramByoCredentials).mockResolvedValue(outcome('applied'));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('2')).toBeTruthy();
    await flush();
    await openRotate();
    await openRevoke();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.revokeConfirm' }));
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' }));
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' })).toBeTruthy();
    expect(await screen.findByText('integrations.instagramByo.statusRevoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.manageRevoke' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.manageReplace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toHaveProperty('disabled', true);
    const frozen = vi.mocked(rotateInstagramByoSecret).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' }));
    expect(vi.mocked(rotateInstagramByoSecret).mock.calls[1][0]).toEqual(frozen);
    expect(vi.mocked(revokeInstagramByoCredentials)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rotateInstagramByoSecret)).toHaveBeenCalledTimes(2);
  });

  it('permite acessar duas recuperações sem perder a tentativa', async () => {
    await ready();
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue({ kind: 'network' });
    vi.mocked(rotateInstagramByoSuat).mockResolvedValue({ kind: 'network' });
    await openRotate();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.manageRotateSuat' }));
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.rotateSuatFields.suat'), {
      target: { value: ' token-ficticio ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatSubmit' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatConfirm' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { hidden: true, name: 'integrations.instagramByo.rotateSecretConfirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatConfirm' }));
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSuatRetry' })).toBeTruthy();
    const secretRequest = vi.mocked(rotateInstagramByoSecret).mock.calls[0][0].requestId;
    const suatRequest = vi.mocked(rotateInstagramByoSuat).mock.calls[0][0].requestId;
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.manageRotateSecret' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSuatRetry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' }));
    expect(vi.mocked(rotateInstagramByoSecret).mock.calls[1][0].requestId).toBe(secretRequest);
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.manageRotateSuat' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatRetry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSuatRetry' }));
    expect(vi.mocked(rotateInstagramByoSuat).mock.calls[1][0].requestId).toBe(suatRequest);
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.manageReplace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.manageRevoke' })).toBeNull();
  });

  it('troca a seleção sem perder a confirmação e sem disparar POST', async () => {
    await ready();
    await openRotate();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretConfirm' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.manageRevoke' }));
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretConfirm' })).toBeNull();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.manageRotateSecret' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretConfirm' })).toBeTruthy();
    expect(rotateInstagramByoSecret).not.toHaveBeenCalled();
    expect(revokeInstagramByoCredentials).not.toHaveBeenCalled();
  });

  it('volta à apresentação normal depois de resolver a tentativa', async () => {
    await ready();
    vi.mocked(rotateInstagramByoSecret).mockResolvedValue({ kind: 'network' });
    await openRotate();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.rotateSecretConfirm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'integrations.instagramByo.rotateSecretDiscard' }));
    await flush();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretRetry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.rotateSecretSubmit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.manageReplace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.manageRotateSecret' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.manageRevoke' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeNull();
    expect(vi.mocked(rotateInstagramByoSecret)).toHaveBeenCalledTimes(1);
  });
});
