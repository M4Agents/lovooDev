// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramByoMetaPanel } from '../InstagramByoMetaPanel';
import { BYO_GUIDE_STEPS, META_APPS_URL, META_BUSINESS_URL } from '../instagramByoSetupGuideModel';
import { getInstagramByoStatus, type ByoStatusResult } from '../../../services/instagramByoApi';
import {
  associateInstagramByoAccount,
  validateInstagramByoWithMeta,
} from '../../../services/instagramByoValidationApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../services/instagramByoApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/instagramByoApi')>(
    '../../../services/instagramByoApi',
  );
  return { ...actual, getInstagramByoStatus: vi.fn() };
});

vi.mock('../../../services/instagramByoValidationApi', () => ({
  validateInstagramByoWithMeta: vi.fn(),
  associateInstagramByoAccount: vi.fn(),
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const OPEN = 'integrations.instagramByo.guide.open';
const CLOSE = 'integrations.instagramByo.guide.close';
const NEXT = 'integrations.instagramByo.guide.next';
const PREVIOUS = 'integrations.instagramByo.guide.previous';

function savedStatus(): ByoStatusResult {
  return {
    kind: 'ok',
    status: {
      ok: true,
      company_id: COMPANY,
      credentials: {
        configured: true,
        validation_status: 'saved',
        meta_app_id: '1234567890',
        validated_at: null,
        revoked_at: null,
        credential_version: 2,
        validation_error_code: null,
      },
      account_status: 'not_connected',
      accounts: [],
    },
  };
}

function connectedStatus(): ByoStatusResult {
  const current = savedStatus();
  if (current.kind !== 'ok') return current;
  current.status.credentials.validation_status = 'valid';
  current.status.account_status = 'poc_disabled';
  current.status.accounts = [{
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    company_id: COMPANY,
    instagram_account_id: '17841405822304914',
    system_user_id: '99887766',
    instagram_username: 'usevalleron',
    encryption_version: 1,
    scopes: ['instagram_basic'],
    status: 'poc_disabled',
    status_reason: null,
    created_at: '2026-10-30T12:00:00.000Z',
    updated_at: '2026-10-30T12:00:00.000Z',
  }];
  return current;
}

function openGuide() {
  fireEvent.click(screen.getByRole('button', { name: OPEN }));
}

describe('guia de configuração Instagram BYO', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('abre e fecha sem credenciais e sem chamar a Meta', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<InstagramByoMetaPanel />);
    expect(screen.getByRole('button', { name: OPEN })).toBeTruthy();
    openGuide();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('integrations.instagramByo.guide.title');
    expect(dialog.textContent).toContain('integrations.instagramByo.guide.subtitle');
    expect(dialog.textContent).toContain('1 / 12');
    expect(dialog.querySelector('input, textarea, form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: CLOSE }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getInstagramByoStatus).not.toHaveBeenCalled();
    expect(validateInstagramByoWithMeta).not.toHaveBeenCalled();
    expect(associateInstagramByoAccount).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('percorre as 12 etapas e os links oficiais', () => {
    render(<InstagramByoMetaPanel />);
    openGuide();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[100dvh]');
    expect(dialog.className).toContain('sm:max-h-[85vh]');
    expect(dialog.className).toContain('overflow-hidden');
    for (let index = 0; index < BYO_GUIDE_STEPS.length; index += 1) {
      expect(screen.getByText(`${index + 1} / 12`)).toBeTruthy();
      expect(screen.getByRole('heading', { level: 3, name: `${index + 1}. ${BYO_GUIDE_STEPS[index].title}` })).toBeTruthy();
      for (const block of BYO_GUIDE_STEPS[index].blocks) {
        if (block.kind === 'link') {
          const anchor = screen.getByRole('link', { name: block.key });
          expect(anchor.getAttribute('href')).toBe(block.href);
          expect(anchor.getAttribute('target')).toBe('_blank');
        }
      }
      if (index < BYO_GUIDE_STEPS.length - 1) {
        fireEvent.click(screen.getByRole('button', { name: NEXT }));
      }
    }
    expect(screen.getByRole('button', { name: NEXT })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: PREVIOUS }));
    expect(screen.getByRole('heading', { level: 3, name: `11. ${BYO_GUIDE_STEPS[10].title}` })).toBeTruthy();
    expect(validateInstagramByoWithMeta).not.toHaveBeenCalled();
    expect(dialog.querySelector('input, textarea')).toBeNull();
  });

  it('permanece disponível com credenciais salvas e com a conta associada', async () => {
    vi.mocked(getInstagramByoStatus).mockResolvedValue(savedStatus());
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect((await screen.findAllByText('integrations.instagramByo.statusSaved')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: OPEN })).toBeTruthy();
    cleanup();

    vi.mocked(getInstagramByoStatus).mockResolvedValue(connectedStatus());
    render(<InstagramByoMetaPanel companyId={COMPANY} canWrite />);
    expect(await screen.findByText('integrations.instagramByo.statusConnectedMeta')).toBeTruthy();
    expect(screen.getByText('@usevalleron')).toBeTruthy();
    openGuide();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('integrations.instagramByo.statusConnectedMeta')).toBeTruthy();
    expect(validateInstagramByoWithMeta).not.toHaveBeenCalled();
    expect(associateInstagramByoAccount).not.toHaveBeenCalled();
  });

  it('traduz o guia em pt-BR, en e es e não coleta credenciais', () => {
    const required = ['open', 'title', 'subtitle', 's1.title', 's12.title', 's12.aNote', 's10.warn'];
    const phrases = {
      'pt-BR': ['Guia de configuração', 'Como conectar seu Instagram ao LovooCRM', 'não prova que o token expirou'],
      en: ['Setup guide', 'How to connect your Instagram to LovooCRM', 'does not prove that the token expired'],
      es: ['Guía de configuración', 'Cómo conectar tu Instagram al LovooCRM', 'no prueba que el token haya expirado'],
    };
    for (const [locale, expected] of Object.entries(phrases)) {
      const copy = JSON.parse(readFileSync(resolve(`src/locales/${locale}/settings.app.json`), 'utf8'));
      const guide = copy.integrations.instagramByo.guide;
      for (const item of required) expect(guide[item]).toBeTruthy();
      expect(guide['s4.scopes']).toContain('instagram_basic');
      expect(guide['s4.scopes']).toContain('pages_show_list');
      const block = JSON.stringify(guide);
      for (const phrase of expected) expect(block).toContain(phrase);
    }
    const source = [
      readFileSync(resolve('src/components/Settings/InstagramByoSetupGuide.tsx'), 'utf8'),
      readFileSync(resolve('src/components/Settings/instagramByoSetupGuideModel.ts'), 'utf8'),
    ].join('\n');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('validateInstagramByoWithMeta');
    expect(source).not.toContain('<input');
    expect(source).toContain(META_APPS_URL);
    expect(source).toContain(META_BUSINESS_URL);
  });
});
