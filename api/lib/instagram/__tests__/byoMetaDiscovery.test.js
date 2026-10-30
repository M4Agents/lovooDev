import { describe, expect, it } from 'vitest';
import { classifyMetaFailure, interpretAssignedPages, interpretDebugToken } from '../byoMetaDiscovery.js';

const APP = '1234567890';

function token(overrides = {}) {
  return {
    data: {
      is_valid: true,
      app_id: APP,
      type: 'SYSTEM_USER',
      user_id: '99887766',
      scopes: ['instagram_basic', 'pages_show_list', 'ads_read'],
      ...overrides,
    },
  };
}

describe('descoberta do System User BYO', () => {
  it('aceita token válido do aplicativo esperado', () => {
    const result = interpretDebugToken(token(), APP);
    expect(result.ok).toBe(true);
    expect(result.systemUserId).toBe('99887766');
  });

  it('recusa token inválido e registra a etapa debug_token', () => {
    const result = interpretDebugToken(token({
      is_valid: false,
      error: { code: 190, error_subcode: 463, message: 'fixture-suat-not-real' },
    }), APP);
    expect(result).toEqual({
      ok: false,
      code: 'token_invalid',
      definitive: true,
      diagnostic: {
        stage: 'debug_token',
        reason: 'is_valid_false',
        meta_error_code: 190,
        meta_error_subcode: 463,
      },
    });
    expect(JSON.stringify(result)).not.toContain('fixture-suat-not-real');
  });

  it('recusa user_id fora do formato sem gravar o valor', () => {
    const result = interpretDebugToken(token({ user_id: 'nao-numerico' }), APP);
    expect(result).toEqual({
      ok: false,
      code: 'token_invalid',
      definitive: true,
      diagnostic: {
        stage: 'user_id_validation',
        reason: 'user_id_invalid',
        meta_error_code: null,
        meta_error_subcode: null,
      },
    });
    expect(JSON.stringify(result)).not.toContain('nao-numerico');
  });

  it('normaliza erro 190 ou 102 sem a mensagem da Meta', () => {
    const result = classifyMetaFailure(400, {
      error: { code: 190, error_subcode: 460, message: 'fixture-suat-not-real' },
    });
    expect(result).toEqual({
      ok: false,
      code: 'token_invalid',
      definitive: true,
      diagnostic: {
        reason: 'meta_oauth_error',
        meta_error_code: 190,
        meta_error_subcode: 460,
      },
    });
    expect(classifyMetaFailure(401, { error: { code: 102, subcode: 12 } }).diagnostic.meta_error_code).toBe(102);
    expect(JSON.stringify(result)).not.toContain('fixture-suat-not-real');
  });

  it('recusa token de outro aplicativo', () => {
    expect(interpretDebugToken(token({ app_id: '999' }), APP)).toMatchObject({
      ok: false,
      code: 'token_wrong_app',
    });
  });

  it('recusa token que não é de system user', () => {
    expect(interpretDebugToken(token({ type: 'USER' }), APP)).toMatchObject({
      ok: false,
      code: 'token_type_unsupported',
      definitive: true,
    });
  });

  it('recusa permissão insuficiente', () => {
    expect(interpretDebugToken(token({ scopes: ['instagram_basic'] }), APP)).toMatchObject({
      ok: false,
      code: 'insufficient_permissions',
    });
  });

  it('aceita escopo granular equivalente', () => {
    const result = interpretDebugToken(token({
      scopes: [],
      granular_scopes: [
        { scope: 'instagram_basic' },
        { scope: 'pages_show_list' },
      ],
    }), APP);
    expect(result.ok).toBe(true);
  });

  it('devolve nenhuma conta quando as páginas não têm Instagram', () => {
    expect(interpretAssignedPages({ data: [{ id: '10' }] })).toEqual({ ok: true, accounts: [] });
  });

  it('devolve uma ou várias contas sem campos extras', () => {
    const result = interpretAssignedPages({
      data: [
        { id: '10', access_token: 'page-token-secreto', instagram_business_account: { id: '17841405822304914', username: 'valleron' } },
        { id: '11', instagram_business_account: { id: '17841400000000002', username: 'outra.conta' } },
        { id: '12', instagram_business_account: { id: '17841405822304914', username: 'valleron' } },
      ],
    });
    expect(result).toEqual({
      ok: true,
      accounts: [
        { instagram_account_id: '17841405822304914', instagram_username: 'valleron' },
        { instagram_account_id: '17841400000000002', instagram_username: 'outra.conta' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('page-token-secreto');
  });

  it('trata resposta incompleta como falha temporária', () => {
    expect(interpretAssignedPages({})).toMatchObject({ code: 'temporary', definitive: false });
    expect(interpretDebugToken({}, APP)).toMatchObject({ code: 'temporary', definitive: false });
  });
});
