// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WelcomePopupPreview } from '../WelcomePopupPreview';

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

describe('prévia do formulário', () => {
  afterEach(() => cleanup());

  it('mantém nome, e-mail e WhatsApp com +55 fixo, sem ensaio', () => {
    render(<WelcomePopupPreview viewport="mobile" content={preview} />);
    const row = document.querySelector('[data-viewport="mobile"] [data-mobile-row]') as HTMLElement;
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    const phone = screen.getByLabelText('WhatsApp') as HTMLInputElement;
    const name = screen.getByLabelText('Nome') as HTMLInputElement;

    expect(name.disabled).toBe(true);
    expect(email.type).toBe('email');
    expect(email.disabled).toBe(true);
    expect(phone.type).toBe('tel');
    expect(phone.disabled).toBe(true);
    expect(phone.getAttribute('inputmode')).toBe('numeric');
    expect(phone.getAttribute('placeholder')).toBe('(11) 99999-9999');
    expect(row.textContent).toContain('+55');
    expect(row.className).toContain('overflow-hidden');
    expect(row.className).toContain('min-w-0');
    expect(screen.queryByRole('button', { name: /registrar teste|limpar resultados/i })).toBeNull();
    expect(screen.queryByLabelText('Contatos autorizados para teste')).toBeNull();
  });
});
