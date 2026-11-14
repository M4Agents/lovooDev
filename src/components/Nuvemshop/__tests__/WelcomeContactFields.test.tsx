// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WelcomePopupPreview } from '../WelcomePopupPreview';
import { WelcomePopupTestSection } from '../WelcomePopupTestSection';

vi.mock('../../../services/nuvemshopWelcomePopupApi', () => ({
  runWelcomePopupTest: vi.fn(),
  clearWelcomePopupTests: vi.fn(),
}));

const preview = {
  title: 'Bem-vindo',
  description: 'Texto',
  imageUrl: null,
  buttonLabel: 'Quero participar',
  consentText: 'Aceito o cupom.',
  promoConsentText: 'Promoções',
  backgroundColor: '#ffffff',
  textColor: '#0f172a',
  buttonColor: '#6d28d9',
};

function section() {
  const onContacts = vi.fn();
  const onContactsIssue = vi.fn();
  render(
    <WelcomePopupTestSection
      companyId="dcc99d3d-9def-4b93-aeb2-1a3be5f15413"
      storeId="7680914"
      canWrite
      origins=""
      contacts={[]}
      onOrigins={vi.fn()}
      onContacts={onContacts}
      onContactsIssue={onContactsIssue}
    />,
  );
  return { onContacts, onContactsIssue };
}

describe('formulário do ensaio', () => {
  afterEach(() => cleanup());

  it('mostra o e-mail inválido no campo e não envia', async () => {
    const { runWelcomePopupTest } = await import('../../../services/nuvemshopWelcomePopupApi');
    section();
    fireEvent.change(screen.getByLabelText('E-mail do teste'), { target: { value: 'a b@dominio.com' } });
    fireEvent.change(screen.getByLabelText('WhatsApp do teste'), { target: { value: '11999999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar teste' }));

    expect(screen.getByText(/não confirma que a caixa existe/)).toBeTruthy();
    expect(runWelcomePopupTest).not.toHaveBeenCalled();
  });

  it('envia e-mail com +tag e underscore já normalizado', async () => {
    const { runWelcomePopupTest } = await import('../../../services/nuvemshopWelcomePopupApi');
    vi.mocked(runWelcomePopupTest).mockResolvedValue({
      identity: 'none',
      eligibility: 'eligible_limited',
      limitation: null,
      coupon_revealed: false,
      redirect: false,
      lead_changed: false,
    });
    section();
    fireEvent.change(screen.getByLabelText('Nome do teste'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('E-mail do teste'), { target: { value: ' Nome.Sobrenome+tag@dominio.com.br ' } });
    fireEvent.change(screen.getByLabelText('WhatsApp do teste'), { target: { value: '+55 (11) 99999-9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar teste' }));

    expect(screen.getByLabelText('WhatsApp do teste')).toHaveProperty('value', '(11) 99999-9999');
    await vi.waitFor(() => expect(runWelcomePopupTest).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        email: 'nome.sobrenome+tag@dominio.com.br',
        phone: '5511999999999',
      }),
    ));
  });

  it('não transforma DDI repetido nem DDD 55 em outro número', () => {
    const { onContacts } = section();
    fireEvent.change(screen.getByLabelText('WhatsApp do teste'), { target: { value: '55999999999' } });
    expect(screen.getByLabelText('WhatsApp do teste')).toHaveProperty('value', '(55) 99999-9999');

    fireEvent.change(screen.getByLabelText('WhatsApp do teste'), { target: { value: '+55 55 11 99999-9999' } });
    expect(screen.getByLabelText('WhatsApp do teste').getAttribute('value')).not.toBe('(11) 99999-9999');

    fireEvent.change(screen.getByLabelText('Contatos autorizados para teste'), {
      target: { value: 'ana_b@valleron.store, 55999999999' },
    });
    expect(onContacts).toHaveBeenCalledWith([{ email: 'ana_b@valleron.store', phone: '5555999999999' }]);
  });

  it('mantém o prefixo +55 dentro da prévia estreita', () => {
    render(<WelcomePopupPreview viewport="mobile" content={preview} />);
    const row = document.querySelector('[data-viewport="mobile"] [data-mobile-row]') as HTMLElement;
    const email = screen.getAllByLabelText('E-mail')[0] as HTMLInputElement;
    const phone = screen.getAllByLabelText('WhatsApp')[0] as HTMLInputElement;
    expect(email.type).toBe('email');
    expect(phone.type).toBe('tel');
    expect(phone.getAttribute('inputmode')).toBe('numeric');
    expect(row.textContent).toContain('+55');
    expect(row.style.maxWidth === '' || row.className.includes('max-w-full')).toBe(true);
    expect(row.className).toContain('overflow-hidden');
    expect(row.className).toContain('min-w-0');
  });
});
