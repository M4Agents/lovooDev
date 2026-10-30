// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { getInstagramByoStatus, setInstagramByoCredentials, type ByoStatusResult } from '../../../services/instagramByoApi';

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

function ByoPanelHost({ companyId, canWrite = false }: { companyId: string | null; canWrite?: boolean }) {
  return (
    <InstagramByoMetaPanel
      key={companyId ?? 'no-company'}
      companyId={companyId}
      canWrite={canWrite}
    />
  );
}

function expectQuietStatus() {
  expect(document.querySelectorAll('input')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'integrations.instagramByo.manageReplace' })).toBeNull();
  expect(screen.queryByText('integrations.instagramByo.stateCredentials')).toBeNull();
}

function expectInputsDisabled() {
  const fields = document.querySelectorAll('input');
  expect(fields).toHaveLength(3);
  for (const field of fields) {
    expect(field).toHaveProperty('disabled', true);
    expect(field).toHaveProperty('readOnly', true);
    expect(field).toHaveProperty('value', '');
  }
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toContain('integrations.instagramByo.guide.open');
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
    expect(screen.queryByText('integrations.instagramByo.badgePreparing')).toBeNull();
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
    expectQuietStatus();
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
    expect(screen.getAllByText('integrations.instagramByo.statusSaved').length).toBeGreaterThan(0);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('2026-10-30T12:00:00.000Z')).toBeTruthy();
    expect(screen.getByText('2026-10-30T13:00:00.000Z')).toBeTruthy();
    expectQuietStatus();
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
    expectQuietStatus();
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
    expect(settings).toContain('canWrite={canWriteInstagramByo}');
    expect(settings).not.toContain('replace_app');
    expect(settings).not.toContain('rotate_secret');
    expect(settings).not.toContain('rotate_suat');

    const phrases = {
      'pt-BR': ['Não configurado.', 'Credenciais salvas', 'Credenciais validadas', 'Conectado à Meta', 'Conta Instagram conectada à Meta', 'Guia de configuração', 'Como conectar seu Instagram ao LovooCRM', 'Webhook Meta', 'Gerar configuração', 'Gerenciar credenciais', 'Atualizar token de acesso', 'Mensagens e comentários ainda não usam esta conta.'],
      en: ['Not configured.', 'Credentials saved', 'Credentials validated', 'Connected to Meta', 'Instagram account connected to Meta', 'Setup guide', 'How to connect your Instagram to LovooCRM', 'Meta webhook', 'Generate configuration', 'Manage credentials', 'Update access token', 'Messages and comments do not use this account yet.'],
      es: ['No configurado.', 'Credenciales guardadas', 'Credenciales validadas', 'Conectado a Meta', 'Cuenta de Instagram conectada a Meta', 'Guía de configuración', 'Cómo conectar tu Instagram al LovooCRM', 'Webhook de Meta', 'Generar configuración', 'Gestionar credenciales', 'Actualizar token de acceso', 'Los mensajes y los comentarios todavía no usan esta cuenta.'],
    };
    for (const [locale, expected] of Object.entries(phrases)) {
      const copy = JSON.parse(readFileSync(resolve(`src/locales/${locale}/settings.app.json`), 'utf8'));
      const block = JSON.stringify(copy.integrations.instagramByo);
      for (const phrase of expected) expect(block).toContain(phrase);
      expect(block).not.toContain('Validado pela Meta');
      expect(block).not.toContain('Validated by Meta');
      expect(block).not.toMatch(/"Conectado"/);
      expect(block).not.toMatch(/"Connected"/);
    }
  });
});

const SECRET = 'segredo-de-teste';
const SUAT = 'suat-de-teste';

function notConfigured(companyId: string): ByoStatusResult {
  return status(companyId, false, null);
}

function revoked(companyId: string): ByoStatusResult {
  const base = status(companyId, false, null);
  if (base.kind !== 'ok') return base;
  return {
    kind: 'ok',
    status: {
      ...base.status,
      credentials: {
        ...base.status.credentials,
        configured: false,
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
      credential_version: stale ? 99 : 1,
      configured: true,
      stale,
    },
  };
}

async function fillAndConfirm() {
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.app-id'), {
    target: { value: '1234567890' },
  });
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.app-secret'), {
    target: { value: SECRET },
  });
  fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.suat'), {
    target: { value: SUAT },
  });
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setSubmit' }));
  fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setConfirm' }));
}

describe('cadastro set do Instagram BYO', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('mostra o botão para quem pode escrever e o oculta para leitura', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    const writer = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    writer.unmount();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite={false} />);
    expect(await screen.findByText('integrations.instagramByo.stateCredentials')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeNull();
    expect(document.querySelectorAll('input')).toHaveLength(0);
  });

  it('mantém os campos bloqueados no HTTP 404 mesmo com permissão de escrita', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue({ kind: 'unavailable' });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusUnavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeNull();
    expectQuietStatus();
    expect(setInstagramByoCredentials).not.toHaveBeenCalled();
  });

  it('envia set sem expected_version no cadastro inicial e só um POST no clique duplo', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(setInstagramByoCredentials).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.app-id'), {
      target: { value: '1234567890' },
    });
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.app-secret'), {
      target: { value: SECRET },
    });
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.suat'), {
      target: { value: SUAT },
    });
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setSubmit' }));
    const confirm = screen.getByRole('button', { name: 'integrations.instagramByo.setConfirm' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(setInstagramByoCredentials).toHaveBeenCalledTimes(1);
    const first = vi.mocked(setInstagramByoCredentials).mock.calls[0][0];
    expect(first.expectedVersion).toBeUndefined();
    expect(first.companyId).toBe(COMPANY_A);
    resolveSend(applied(COMPANY_A));
  });

  it('inclui expected_version quando o status é revogado', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(revoked(COMPANY_A));
    vi.mocked(setInstagramByoCredentials).mockResolvedValue(applied(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusRevoked')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    await fillAndConfirm();
    expect(vi.mocked(setInstagramByoCredentials).mock.calls[0][0].expectedVersion).toBe(4);
  });

  it.each(['network', 'service_unavailable'] as const)('reutiliza request_id e payload no retry manual de %s', async (kind) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    vi.mocked(setInstagramByoCredentials)
      .mockResolvedValueOnce({ kind })
      .mockResolvedValueOnce(applied(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await fillAndConfirm();
    expect(await screen.findByText('integrations.instagramByo.setUnknownOutcome')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setRetry' }));
    expect(setInstagramByoCredentials).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(setInstagramByoCredentials).mock.calls;
    expect(second[0].requestId).toBe(first[0].requestId);
    expect(second[0].appSecret).toBe(first[0].appSecret);
    expect(second[0].suat).toBe(first[0].suat);
  });

  it.each(['conflict', 'request_reused'] as const)('limpa os segredos no 409 %s', async (kind) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    vi.mocked(setInstagramByoCredentials).mockResolvedValue({ kind });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await fillAndConfirm();
    const key = kind === 'conflict'
      ? 'integrations.instagramByo.setConflict'
      : 'integrations.instagramByo.setRequestReused';
    expect(await screen.findByText(key)).toBeTruthy();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByDisplayValue(SUAT)).toBeNull();
  });

  it.each(['applied', 'idempotent'] as const)('mostra sucesso %s e consulta o status de novo', async (resultName) => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(async () => {
      reads += 1;
      if (reads === 1) return notConfigured(COMPANY_A);
      return status(COMPANY_A, true, '1234567890');
    });
    const success = applied(COMPANY_A);
    vi.mocked(setInstagramByoCredentials).mockResolvedValue({
      kind: 'ok',
      body: { ...success.body, result: resultName, stale: false, credential_version: 1 },
    });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await fillAndConfirm();
    const key = resultName === 'applied'
      ? 'integrations.instagramByo.setApplied'
      : 'integrations.instagramByo.setIdempotent';
    expect(await screen.findByText(key)).toBeTruthy();
    expect(await screen.findByText('2')).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  });

  it('mostra sucesso applied e idempotent com stale sem usar a versão retornada', async () => {
    let reads = 0;
    vi.mocked(getInstagramByoStatus).mockImplementation(async () => {
      reads += 1;
      if (reads === 1) return notConfigured(COMPANY_A);
      return status(COMPANY_A, true, '1234567890');
    });
    vi.mocked(setInstagramByoCredentials).mockResolvedValue(applied(COMPANY_A, true));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await fillAndConfirm();
    expect(await screen.findByText('integrations.instagramByo.setStale')).toBeTruthy();
    expect(await screen.findByText('2')).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  });

  it('não mostra o resultado nem o segredo da empresa anterior', async () => {
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId: string) => notConfigured(companyId));
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(setInstagramByoCredentials).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    const view = render(<ByoPanelHost companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.app-secret'), {
      target: { value: SECRET },
    });
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.app-id'), {
      target: { value: '1234567890' },
    });
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.suat'), {
      target: { value: SUAT },
    });
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setSubmit' }));
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setConfirm' }));
    view.rerender(<ByoPanelHost companyId={COMPANY_B} canWrite />);
    resolveSend(applied(COMPANY_A));
    await Promise.resolve();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByText('integrations.instagramByo.setApplied')).toBeNull();
  });

  async function openConfirm() {
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.app-id'), {
      target: { value: '1234567890' },
    });
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.app-secret'), {
      target: { value: SECRET },
    });
    fireEvent.change(screen.getByLabelText('integrations.instagramByo.fields.suat'), {
      target: { value: SUAT },
    });
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setSubmit' }));
  }

  it.each(['unauthorized', 'session_unavailable'] as const)(
    'preserva request_id quando o retry encontra %s e a sessão volta',
    async (kind) => {
      vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
      let resolveAuth: (value: { kind: typeof kind }) => void = () => undefined;
      vi.mocked(setInstagramByoCredentials)
        .mockResolvedValueOnce({ kind: 'network' })
        .mockImplementationOnce(() => new Promise((resolve) => {
          resolveAuth = resolve;
        }))
        .mockResolvedValueOnce(applied(COMPANY_A));
      render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
      expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
      await fillAndConfirm();
      expect(await screen.findByText('integrations.instagramByo.setUnknownOutcome')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setRetry' }));
      expect(await screen.findByText('integrations.instagramByo.setSending')).toBeTruthy();
      resolveAuth({ kind });
      expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setRetry' })).toBeTruthy();
      expect(screen.queryByText('integrations.instagramByo.setApplied')).toBeNull();
      expect(screen.queryByText('integrations.instagramByo.setUnauthorized')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setRetry' }));
      await vi.waitFor(() => {
        expect(setInstagramByoCredentials).toHaveBeenCalledTimes(3);
      });
      const calls = vi.mocked(setInstagramByoCredentials).mock.calls.map((call) => call[0]);
      expect(calls[1].requestId).toBe(calls[0].requestId);
      expect(calls[2].requestId).toBe(calls[0].requestId);
      expect(calls[2].appSecret).toBe(calls[0].appSecret);
      expect(calls[2].suat).toBe(calls[0].suat);
      expect(calls[2].metaAppId).toBe(calls[0].metaAppId);
    },
  );

  it('não dispara POST ao trocar de empresa com a confirmação aberta', async () => {
    vi.mocked(getInstagramByoStatus).mockImplementation(async (companyId: string) => notConfigured(companyId));
    const view = render(<ByoPanelHost companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await openConfirm();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.setConfirm' })).toBeTruthy();
    view.rerender(<ByoPanelHost companyId={COMPANY_B} canWrite />);
    expect(setInstagramByoCredentials).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setConfirm' })).toBeNull();
  });

  it('cancela a confirmação sem POST', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await openConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setCancel' }));
    expect(setInstagramByoCredentials).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setConfirm' })).toBeNull();
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
  });

  it('descarta a tentativa explícita e remove os segredos da tela', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    vi.mocked(setInstagramByoCredentials).mockResolvedValue({ kind: 'network' });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await fillAndConfirm();
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setDiscard' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setDiscard' }));
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(screen.queryByDisplayValue(SUAT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setRetry' })).toBeNull();
  });

  it('ignora a resposta quando o painel é desmontado durante o POST', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    let resolveSend: (value: ReturnType<typeof applied>) => void = () => undefined;
    vi.mocked(setInstagramByoCredentials).mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    const view = render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await fillAndConfirm();
    expect(setInstagramByoCredentials).toHaveBeenCalledTimes(1);
    view.unmount();
    resolveSend(applied(COMPANY_A));
    await Promise.resolve();
    expect(screen.queryByText('integrations.instagramByo.setApplied')).toBeNull();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  });

  it.each([0, 1.5, 2147483648])('bloqueia set quando a versão revogada é %s', async (version) => {
    const base = revoked(COMPANY_A);
    if (base.kind !== 'ok') throw new Error('status invalido');
    vi.mocked(getInstagramByoStatus).mockResolvedValue({
      kind: 'ok',
      status: {
        ...base.status,
        credentials: { ...base.status.credentials, credential_version: version },
      },
    });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusSetBlocked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeNull();
    expectQuietStatus();
  });

  it.each([
    { http: '401', result: { kind: 'denied' as const }, message: 'integrations.instagramByo.statusDenied' },
    { http: '403', result: { kind: 'denied' as const }, message: 'integrations.instagramByo.statusDenied' },
    { http: '500', result: { kind: 'temporary' as const }, message: 'integrations.instagramByo.statusTemporary' },
    { http: 'rede', result: { kind: 'temporary' as const }, message: 'integrations.instagramByo.statusTemporary' },
  ])('mantém os campos bloqueados no GET $http com escrita habilitada', async ({ result, message }) => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(result);
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeNull();
    expectQuietStatus();
    expect(setInstagramByoCredentials).not.toHaveBeenCalled();
  });

  it('impede set quando as credenciais já estão configuradas', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(status(COMPANY_A, true, '1234567890'));
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findAllByText('integrations.instagramByo.statusSaved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.manageReplace' }));
    expect(screen.getByRole('button', { name: 'integrations.instagramByo.replaceSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.revokeSubmit' })).toBeNull();
    expect(screen.getByLabelText('integrations.instagramByo.replaceFields.app-secret')).toHaveProperty('value', '');
    expect(setInstagramByoCredentials).not.toHaveBeenCalled();
  });

  it.each(['unauthorized', 'session_unavailable'] as const)(
    'encerra o primeiro envio em %s sem apresentar sucesso',
    async (kind) => {
      vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
      vi.mocked(setInstagramByoCredentials).mockResolvedValue({ kind });
      render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
      expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
      await fillAndConfirm();
      expect(await screen.findByText('integrations.instagramByo.setUnauthorized')).toBeTruthy();
      expect(screen.queryByText('integrations.instagramByo.setApplied')).toBeNull();
      expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setRetry' })).toBeNull();
    },
  );

  it('encerra a tentativa quando a validação recusa o retry', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(notConfigured(COMPANY_A));
    vi.mocked(setInstagramByoCredentials)
      .mockResolvedValueOnce({ kind: 'network' })
      .mockResolvedValueOnce({ kind: 'rejected' });
    render(<InstagramByoMetaPanel companyId={COMPANY_A} canWrite />);
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setSubmit' })).toBeTruthy();
    await fillAndConfirm();
    expect(await screen.findByRole('button', { name: 'integrations.instagramByo.setRetry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramByo.setRetry' }));
    expect(await screen.findByText('integrations.instagramByo.setRejected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'integrations.instagramByo.setRetry' })).toBeNull();
    expect(screen.queryByText('integrations.instagramByo.setApplied')).toBeNull();
  });
});
