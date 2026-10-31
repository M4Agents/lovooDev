// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramModalitySection } from '../InstagramModalitySection';
import { canSwitchInstagramModality } from '../instagramModalityVisibility';
import { getInstagramModality, switchInstagramModality, type ModalityAccount } from '../../../services/instagramModalityApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

vi.mock('../../../services/instagramModalityApi', () => ({
  getInstagramModality: vi.fn(),
  switchInstagramModality: vi.fn(),
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const CONNECTION = '11111111-1111-4111-8111-111111111111';
const BYO = '22222222-2222-4222-8222-222222222222';

const FIRST = '17841400000000001';
const SECOND = '17841400000000002';
const SECOND_CONNECTION = '44444444-4444-4444-8444-444444444444';
const SECOND_BYO = '55555555-5555-4555-8555-555555555555';

function account(overrides: Partial<ModalityAccount> = {}): ModalityAccount {
  return {
    instagram_account_id: FIRST,
    operational_mode: 'official',
    mode_registered: false,
    mode_basis: 'compatibility',
    official_receive_supported: false,
    official_connection: { id: CONNECTION, status: 'revoked', username: 'conta-a' },
    byo_account: {
      id: BYO,
      status: 'poc_disabled',
      username: 'conta-a',
      direct_ingest_enabled: false,
    },
    direct_ingest_enabled: false,
    send_supported: false,
    byo_send_supported: false,
    targets: {
      official: { eligible: false, block_reason: 'destination_not_ready' },
      byo: { eligible: true, block_reason: null },
    },
    ...overrides,
  };
}

function state(accounts: ModalityAccount[] = [account()], switchAvailable = true) {
  return {
    kind: 'ok',
    state: {
      ok: true,
      company_id: COMPANY,
      switch_available: switchAvailable,
      accounts,
    },
  };
}

function radio(value: string): HTMLInputElement {
  const found = screen.getAllByRole('radio').find((item) => (item as HTMLInputElement).value === value);
  if (!found) throw new Error(value);
  return found as HTMLInputElement;
}

describe('InstagramModalitySection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('explica a troca inteira e não envia sem confirmação', async () => {
    getInstagramModality.mockResolvedValue(state());
    render(<InstagramModalitySection companyId={COMPANY} canSwitch />);
    expect(await screen.findByText('integrations.instagramModality.compatibilityInactive')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramModality.compatibilityActive')).toBeNull();
    expect(screen.queryByText('integrations.instagramModality.alreadyApplied')).toBeNull();
    expect(screen.getByText('integrations.instagramModality.transferAll')).toBeTruthy();
    expect(screen.getByText('integrations.instagramModality.preserveHistory')).toBeTruthy();
    expect(screen.getByText('integrations.instagramModality.byoSendUnavailable')).toBeTruthy();
    expect(screen.getByText('integrations.instagramModality.block.destination_not_ready')).toBeTruthy();
    expect(screen.queryByText(/conversation_id/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramModality.submit' }));
    expect(switchInstagramModality).not.toHaveBeenCalled();
  });

  it('impede clique duplo e atualiza o estado depois do sucesso', async () => {
    getInstagramModality.mockResolvedValue(state());
    let release;
    switchInstagramModality.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({
        kind: 'ok',
        reason: 'already_applied',
        targetMode: 'byo',
        movedCount: 0,
      });
    }));
    render(<InstagramModalitySection companyId={COMPANY} canSwitch />);
    fireEvent.click(await screen.findByRole('checkbox'));
    const button = screen.getByRole('button', { name: 'integrations.instagramModality.submit' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(switchInstagramModality).toHaveBeenCalledTimes(1);
    expect(switchInstagramModality.mock.calls[0][0]).toMatchObject({
      companyId: COMPANY,
      confirmed: true,
      targetMode: 'byo',
      officialConnectionId: CONNECTION,
      byoAccountId: BYO,
    });
    expect(switchInstagramModality.mock.calls[0][0].actorId).toBeUndefined();
    release();
    await waitFor(() => {
      expect(screen.getByText('integrations.instagramModality.alreadyApplied')).toBeTruthy();
    });
    expect(getInstagramModality).toHaveBeenCalledTimes(2);
  });

  it('mostra o bloqueio sem texto interno e esconde a confirmação de quem não pode trocar', async () => {
    getInstagramModality.mockResolvedValue({ kind: 'denied' });
    const denied = render(<InstagramModalitySection companyId={COMPANY} canSwitch />);
    expect(await screen.findByText('integrations.instagramModality.denied')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    denied.unmount();

    getInstagramModality.mockResolvedValue(state());
    render(<InstagramModalitySection companyId={COMPANY} canSwitch={false} />);
    expect(await screen.findByText('integrations.instagramModality.currentCompatibility')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(canSwitchInstagramModality({
      companyId: COMPANY,
      roles: [{ company_id: COMPANY, role: 'partner' }],
    })).toBe(false);
    expect(canSwitchInstagramModality({
      companyId: COMPANY,
      roles: [{ company_id: 'parent', role: 'super_admin' }],
    })).toBe(false);
    expect(canSwitchInstagramModality({
      companyId: COMPANY,
      roles: [{ company_id: COMPANY, role: 'admin' }],
    })).toBe(true);
  });

  it('mostra a conexão active sem registro como compatibilidade, não como modalidade aplicada', async () => {
    getInstagramModality.mockResolvedValue(state([
      account({
        official_receive_supported: true,
        send_supported: true,
        official_connection: { id: CONNECTION, status: 'active', username: 'conta-a' },
        targets: {
          official: { eligible: true, block_reason: null },
          byo: { eligible: true, block_reason: null },
        },
      }),
    ]));
    render(<InstagramModalitySection companyId={COMPANY} canSwitch />);
    expect(await screen.findByText('integrations.instagramModality.compatibilityActive')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramModality.compatibilityInactive')).toBeNull();
    fireEvent.click(radio('official'));
    expect(screen.getByText('integrations.instagramModality.registerOfficial')).toBeTruthy();
    expect(screen.queryByText('integrations.instagramModality.alreadyApplied')).toBeNull();
  });

  it('recalcula o destino ao trocar de conta e preserva a seleção depois do sucesso', async () => {
    const second = account({
      instagram_account_id: SECOND,
      operational_mode: 'byo',
      mode_registered: true,
      mode_basis: 'registered',
      official_receive_supported: false,
      send_supported: false,
      official_connection: { id: SECOND_CONNECTION, status: 'active', username: 'conta-b' },
      byo_account: {
        id: SECOND_BYO,
        status: 'poc_disabled',
        username: 'conta-b',
        direct_ingest_enabled: false,
      },
      targets: {
        official: { eligible: true, block_reason: null },
        byo: { eligible: false, block_reason: 'destination_not_ready' },
      },
    });
    getInstagramModality.mockResolvedValue(state([account(), second]));
    switchInstagramModality.mockResolvedValue({
      kind: 'ok',
      reason: 'switched',
      targetMode: 'official',
      movedCount: 3,
    });
    render(<InstagramModalitySection companyId={COMPANY} canSwitch />);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: SECOND } });
    expect(screen.queryByText('integrations.instagramModality.confirmLabel')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(radio('official').checked).toBe(true);
    expect(radio('byo').checked).toBe(false);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'integrations.instagramModality.submit' }));
    await waitFor(() => {
      expect(screen.getByText('integrations.instagramModality.switched')).toBeTruthy();
    });
    expect(switchInstagramModality).toHaveBeenCalledTimes(1);
    expect(switchInstagramModality.mock.calls[0][0]).toMatchObject({
      instagramAccountId: SECOND,
      officialConnectionId: SECOND_CONNECTION,
      byoAccountId: SECOND_BYO,
      targetMode: 'official',
    });
    await waitFor(() => {
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(SECOND);
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: FIRST } });
    expect(screen.queryByText('integrations.instagramModality.switched')).toBeNull();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(radio('byo').checked).toBe(true);
  });

  it('esconde a confirmação quando a troca está desligada', async () => {
    getInstagramModality.mockResolvedValue(state([account()], false));
    render(<InstagramModalitySection companyId={COMPANY} canSwitch />);
    expect(await screen.findByText('integrations.instagramModality.switchUnavailable')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'integrations.instagramModality.submit' })).toBeNull();
  });
});
