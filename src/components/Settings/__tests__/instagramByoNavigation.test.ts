import { describe, expect, it } from 'vitest';
import {
  leaveInstagramByoSearchParams,
  openInstagramByoSearchParams,
} from '../instagramByoNavigation';

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

function text(value: URLSearchParams | null): string {
  return value ? value.toString() : '';
}

describe('navegação Instagram BYO', () => {
  it('abre a subaba e preserva parâmetros alheios', () => {
    const next = openInstagramByoSearchParams(params('checkout=ok&foo=1'));
    expect(next.get('tab')).toBe('integracoes');
    expect(next.get('integration')).toBe('instagram-byo');
    expect(next.get('checkout')).toBe('ok');
    expect(next.get('foo')).toBe('1');
  });

  it('mantém a URL ao recarregar dentro da subaba BYO', () => {
    const current = params('tab=integracoes&integration=instagram-byo&foo=1');
    expect(leaveInstagramByoSearchParams(current, {
      activeTab: 'integracoes',
      integracoesTab: 'instagram-byo',
    }, true)).toBeNull();
  });

  it('não apaga o parâmetro antes da prévia ser aplicada no recarregamento', () => {
    const current = params('tab=integracoes&integration=instagram-byo');
    expect(leaveInstagramByoSearchParams(current, {
      activeTab: 'integracoes',
      integracoesTab: 'whatsapp',
    }, false)).toBeNull();
  });

  it('remove só o parâmetro BYO ao sair para outra integração', () => {
    const next = leaveInstagramByoSearchParams(
      params('tab=integracoes&integration=instagram-byo&foo=1'),
      { activeTab: 'integracoes', integracoesTab: 'whatsapp' },
      true,
    );
    expect(text(next)).toBe('tab=integracoes&foo=1');
  });

  it('remove o parâmetro BYO e atualiza a aba ao sair de Configurações', () => {
    const next = leaveInstagramByoSearchParams(
      params('tab=integracoes&integration=instagram-byo&subtab=plano-atual'),
      { activeTab: 'usuarios', integracoesTab: 'instagram-byo' },
      true,
    );
    expect(next?.get('integration')).toBeNull();
    expect(next?.get('tab')).toBe('usuarios');
    expect(next?.get('subtab')).toBe('plano-atual');
  });

  it('não altera integration=instagram', () => {
    const current = params('tab=integracoes&integration=instagram&connected=1&account=usevalleron');
    expect(leaveInstagramByoSearchParams(current, {
      activeTab: 'usuarios',
      integracoesTab: 'instagram',
    }, true)).toBeNull();
    expect(current.get('integration')).toBe('instagram');
    expect(current.get('connected')).toBe('1');
  });

  it('não altera nuvemshop, openai nem elevenlabs', () => {
    for (const integration of ['nuvemshop', 'openai', 'elevenlabs']) {
      expect(leaveInstagramByoSearchParams(
        params(`integration=${integration}`),
        { activeTab: 'integracoes', integracoesTab: 'whatsapp' },
        true,
      )).toBeNull();
    }
  });

  it('sem o parâmetro BYO, o recarregamento não é desviado para a prévia', () => {
    expect(leaveInstagramByoSearchParams(
      params('tab=integracoes'),
      { activeTab: 'integracoes', integracoesTab: 'whatsapp' },
      false,
    )).toBeNull();
  });
});
