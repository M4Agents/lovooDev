// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuvemshopConnectionPanel } from '../../Settings/NuvemshopConnectionPanel';
import { NuvemshopWelcomePopupPanel } from '../NuvemshopWelcomePopupPanel';
import { WelcomePopupPreview } from '../WelcomePopupPreview';
import { getWelcomePopup, saveWelcomePopup } from '../../../services/nuvemshopWelcomePopupApi';

const auth = vi.hoisted(() => ({ currentRole: 'admin' as string | null, isImpersonating: false }));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

vi.mock('../../../hooks/useNuvemshopConnection', () => ({
  useNuvemshopConnection: () => ({
    status: {
      connected: true,
      status: 'active',
      metadata_status: null,
      store_name: 'Valleron',
      store_domain: 'valleron.store',
      store_id: '7680914',
      currency: 'BRL',
      country: 'BR',
      plan_name: null,
      connected_at: null,
      disconnected_at: null,
      last_sync_at: null,
      last_webhook_at: null,
      last_success_at: null,
      last_error_at: null,
      health_status: 'healthy',
      actions: { can_connect: false, can_disconnect: true, can_sync: false, can_replay: false },
    },
    loading: false,
    loadingAction: false,
    error: null,
    refetch: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('../../../services/nuvemshopApi', () => ({
  getNuvemshopMetrics: vi.fn(),
}));

vi.mock('../../../services/nuvemshopWelcomePopupApi', () => ({
  getWelcomePopup: vi.fn(),
  saveWelcomePopup: vi.fn(),
}));

const COMPANY = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413';
const STORE = '7680914';

const blank = {
  id: null,
  company_id: COMPANY,
  nuvemshop_store_id: STORE,
  enabled: false as const,
  page_rule: 'home' as const,
  title: null,
  description: null,
  image_url: null,
  button_label: null,
  background_color: null,
  text_color: null,
  button_color: null,
  consent_text: null,
  consent_version: null,
  coupon_code: null,
  delay_seconds: null,
  resurface_days: null,
  updated_at: null,
};

const longText = 'Supercalifragilisticexpialidocious '.repeat(8);

function previewContent(overrides = {}) {
  return {
    title: longText,
    description: longText,
    imageUrl: null,
    buttonLabel: longText,
    consentText: longText,
    backgroundColor: '#ffffff',
    textColor: '#0f172a',
    buttonColor: '#6d28d9',
    ...overrides,
  };
}

describe('painel e prévia do pop-up', () => {
  beforeEach(() => {
    auth.currentRole = 'admin';
    auth.isImpersonating = false;
    vi.mocked(getWelcomePopup).mockResolvedValue(blank);
    vi.mocked(saveWelcomePopup).mockResolvedValue({ ...blank, title: 'Olá loja' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('mostra o estado não publicado e salva rascunho sem controle de ativação', async () => {
    render(<NuvemshopWelcomePopupPanel companyId={COMPANY} storeId={STORE} />);

    expect(await screen.findByText('Em configuração — ainda não publicado')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /ativar|publicar/i })).toBeNull();
    expect(screen.getByText('Computador')).toBeTruthy();
    expect(screen.getByText('Celular')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Olá loja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

    await waitFor(() => expect(saveWelcomePopup).toHaveBeenCalledWith(
      COMPANY,
      STORE,
      expect.objectContaining({ enabled: false, title: 'Olá loja', description: '', coupon_code: '' }),
    ));
    expect(await screen.findByText('Rascunho salvo. O pop-up continua desativado.')).toBeTruthy();
  });

  it('não abre o formulário quando a leitura falha e distingue o rascunho inexistente', async () => {
    vi.mocked(getWelcomePopup)
      .mockRejectedValueOnce(new Error('A configuração do pop-up ainda não está disponível neste ambiente.'))
      .mockResolvedValueOnce(blank);

    render(<NuvemshopWelcomePopupPanel companyId={COMPANY} storeId={STORE} />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/ainda não está disponível/);
    expect(screen.queryByLabelText('Título')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    expect(screen.queryByText('Nenhum rascunho salvo para esta loja.')).toBeNull();
    expect(saveWelcomePopup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Nenhum rascunho salvo para esta loja.')).toBeTruthy();
    expect(screen.getByLabelText('Título')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(saveWelcomePopup).not.toHaveBeenCalled();
  });

  it('mostra no banner o erro cujo campo não aparece no formulário', async () => {
    const failure = new Error('O pop-up ainda não pode ser publicado. O formulário público não está disponível.');
    (failure as Error & { field?: string }).field = 'enabled';
    vi.mocked(saveWelcomePopup).mockRejectedValue(failure);

    render(<NuvemshopWelcomePopupPanel companyId={COMPANY} storeId={STORE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar rascunho' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/ainda não pode ser publicado/);
    expect(screen.getByLabelText('Título')).toBeTruthy();
  });

  it('esconde a gravação de quem não tem o papel de cupom', async () => {
    auth.currentRole = 'partner';
    render(<NuvemshopWelcomePopupPanel companyId={COMPANY} storeId={STORE} />);
    expect(await screen.findByText(/Somente administradores e gerentes/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
  });

  it('abre a seção dentro da integração da loja conectada', async () => {
    render(<NuvemshopConnectionPanel companyId={COMPANY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up de boas-vindas' }));
    expect(await screen.findByText('Em configuração — ainda não publicado')).toBeTruthy();
    expect(getWelcomePopup).toHaveBeenCalledWith(COMPANY, STORE);
    expect(document.querySelector('[data-viewport="desktop"]')).toBeTruthy();
    expect(document.querySelector('[data-viewport="mobile"]')).toBeTruthy();
  });

  it('mantém texto e botão dentro da largura do celular e do computador', () => {
    const { rerender } = render(
      <div style={{ width: 180 }}>
        <WelcomePopupPreview viewport="mobile" content={previewContent()} />
      </div>,
    );

    const mobile = document.querySelector('[data-viewport="mobile"]') as HTMLElement;
    const modal = mobile.querySelector('[data-preview-modal]') as HTMLElement;
    const button = mobile.querySelector('[data-preview-button]') as HTMLElement;
    expect(mobile.style.maxWidth).toBe('220px');
    expect(mobile.style.width).toBe('100%');
    expect(modal.style.maxWidth).toBe('100%');
    expect(modal.style.overflow).toBe('hidden');
    expect(modal.style.overflowWrap).toBe('anywhere');
    expect(button.style.width).toBe('100%');
    expect(button.style.whiteSpace).toBe('normal');
    expect(button.style.maxWidth).toBe('100%');
    expect(mobile.textContent).toContain('Nome');
    expect(mobile.textContent).toContain('E-mail');
    expect(mobile.textContent).toContain('WhatsApp');
    expect(mobile.textContent).not.toMatch(/prova|lovoo_popup_test|12661|9213|m4track|Cashing/i);

    rerender(<WelcomePopupPreview viewport="desktop" content={previewContent({ title: 'Bem-vindo à loja' })} />);
    const desktop = document.querySelector('[data-viewport="desktop"]') as HTMLElement;
    expect(desktop.style.maxWidth).toBe('420px');
    expect(desktop.style.width).toBe('100%');
    expect(desktop.textContent).not.toMatch(/prova|lovoo_popup_test|12661|9213|m4track|Cashing/i);
  });
});
