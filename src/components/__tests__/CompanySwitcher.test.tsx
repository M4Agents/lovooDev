// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CompanySwitcher } from '../CompanySwitcher';
import {
  hasPlatformWideCompanyAccess,
  pathAfterCompanySwitch,
  shouldShowCompanySwitcher,
} from '../companySwitcherLogic';

const switchCompany = vi.fn();

const authState = {
  company: { id: 'santana', name: 'Vox2you Santana' },
  availableCompanies: [
    { id: 'tatuape', name: 'Vox2you | Tatuapé' },
    { id: 'santana', name: 'Vox2you Santana' },
  ],
  userRoles: [
    { role: 'admin', companies: { company_type: 'client' } },
    { role: 'admin', companies: { company_type: 'client' } },
  ],
  isImpersonating: false,
  switchCompany,
};

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname}{location.search}</div>;
}

function renderSwitcher(path = '/leads') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <CompanySwitcher variant="expanded" />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('companySwitcherLogic', () => {
  it('mostra o seletor só com duas ou mais empresas e membership comum', () => {
    expect(shouldShowCompanySwitcher({
      rolesLoaded: true,
      isImpersonating: false,
      hasPlatformWideAccess: false,
      companyCount: 2,
    })).toBe(true);

    expect(shouldShowCompanySwitcher({
      rolesLoaded: true,
      isImpersonating: false,
      hasPlatformWideAccess: false,
      companyCount: 1,
    })).toBe(false);
  });

  it('esconde o seletor de super admin da empresa pai e durante impersonação', () => {
    expect(hasPlatformWideCompanyAccess([
      { role: 'super_admin', companies: { id: 'p', name: 'M4', company_type: 'parent' } },
    ])).toBe(true);

    expect(hasPlatformWideCompanyAccess([
      { role: 'admin', companies: { id: 'c', name: 'Santana', company_type: 'client' } },
    ])).toBe(false);

    expect(shouldShowCompanySwitcher({
      rolesLoaded: false,
      isImpersonating: false,
      hasPlatformWideAccess: false,
      companyCount: 2,
    })).toBe(false);

    expect(shouldShowCompanySwitcher({
      rolesLoaded: true,
      isImpersonating: true,
      hasPlatformWideAccess: false,
      companyCount: 2,
    })).toBe(false);
  });

  it('tira o usuário de rotas com id da empresa anterior', () => {
    expect(pathAfterCompanySwitch('/automations/flow-1/edit', '')).toBe('/automations');
    expect(pathAfterCompanySwitch('/analytics/lp-1', '')).toBe('/dashboard');
    expect(pathAfterCompanySwitch('/advanced-analytics/lp-1', '')).toBe('/dashboard');
    expect(pathAfterCompanySwitch('/chat', '?conversation_id=1')).toBe('/chat');
    expect(pathAfterCompanySwitch('/leads', '')).toBeNull();
    expect(pathAfterCompanySwitch('/chat', '')).toBeNull();
  });
});

describe('CompanySwitcher', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    switchCompany.mockClear();
    authState.company = { id: 'santana', name: 'Vox2you Santana' };
    authState.availableCompanies = [
      { id: 'tatuape', name: 'Vox2you | Tatuapé' },
      { id: 'santana', name: 'Vox2you Santana' },
    ];
    authState.userRoles = [
      { role: 'admin', companies: { company_type: 'client' } },
      { role: 'admin', companies: { company_type: 'client' } },
    ];
    authState.isImpersonating = false;
  });

  it('lista as empresas em ordem e troca a empresa ativa', () => {
    renderSwitcher('/leads');

    fireEvent.click(screen.getByRole('button', { name: /companySwitcher.changeAriaLabel/ }));
    const options = screen.getAllByRole('option');
    expect(options.map((item) => item.textContent)).toEqual([
      'Vox2you Santana',
      'Vox2you | Tatuapé',
    ]);

    fireEvent.click(screen.getByRole('option', { name: 'Vox2you | Tatuapé' }));
    expect(switchCompany).toHaveBeenCalledWith('tatuape');
    expect(screen.getByTestId('loc').textContent).toBe('/leads');
  });

  it('sai de uma conversa de chat ao trocar de empresa', () => {
    renderSwitcher('/chat?conversation_id=abc');
    fireEvent.click(screen.getByRole('button', { name: /companySwitcher.changeAriaLabel/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Vox2you | Tatuapé' }));
    expect(screen.getByTestId('loc').textContent).toBe('/chat');
  });

  it('mostra só o nome quando há uma empresa', () => {
    authState.availableCompanies = [{ id: 'santana', name: 'Vox2you Santana' }];
    renderSwitcher();
    expect(screen.queryByRole('button', { name: /companySwitcher.changeAriaLabel/ })).toBeNull();
    expect(screen.getByText('Vox2you Santana')).toBeTruthy();
  });
});
