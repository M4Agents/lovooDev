// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  cleanup();
});

describe('InstagramByoMetaPanel', () => {
  it('mostra a prévia sem gravar nem enviar credenciais', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    render(<InstagramByoMetaPanel />);

    expect(screen.getByRole('heading', { name: 'integrations.instagramByo.title' })).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.badgePreparing')).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.stateCredentials')).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.stateUnavailable')).toBeTruthy();
    expect(screen.queryByText(/conectado|validado|ativo/i)).toBeNull();

    const inputs = screen.getAllByRole('textbox').concat(
      document.querySelectorAll('input[type="password"]') as unknown as HTMLElement[],
    );
    const fields = document.querySelectorAll('input');
    expect(fields).toHaveLength(3);
    for (const field of fields) {
      expect(field).toHaveProperty('disabled', true);
      expect(field).toHaveProperty('readOnly', true);
      expect(field).toHaveProperty('value', '');
    }
    expect(inputs.length).toBeGreaterThan(0);
    expect(document.querySelector('button')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    setItem.mockRestore();
  });
});
