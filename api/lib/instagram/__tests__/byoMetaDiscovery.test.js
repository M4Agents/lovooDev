import { describe, expect, it } from 'vitest';
import {
  classifyMetaFailure,
  interpretAssignedInstagramAccounts,
  interpretAssignedPages,
  interpretDebugToken,
  reportEffectiveScopes,
} from '../byoMetaDiscovery.js';

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

const ABSENT_SCOPES = {
  instagram_basic: false,
  instagram_manage_messages: false,
  instagram_manage_comments: false,
};

describe('contas atribuídas do Unified Login', () => {
  it('devolve uma conta válida', () => {
    expect(interpretAssignedInstagramAccounts({
      data: [{ id: '17841408602689007', username: 'usevalleron' }],
    })).toEqual({
      ok: true,
      accounts: [{ instagram_account_id: '17841408602689007', instagram_username: 'usevalleron' }],
    });
  });

  it('devolve várias contas e ignora repetição', () => {
    expect(interpretAssignedInstagramAccounts({
      data: [
        { id: '17841408602689007', username: 'usevalleron' },
        { id: '17841400000000002', username: 'outra.conta' },
        { id: '17841408602689007', username: 'usevalleron' },
      ],
    })).toEqual({
      ok: true,
      accounts: [
        { instagram_account_id: '17841408602689007', instagram_username: 'usevalleron' },
        { instagram_account_id: '17841400000000002', instagram_username: 'outra.conta' },
      ],
    });
  });

  it('aceita data vazio', () => {
    expect(interpretAssignedInstagramAccounts({ data: [] })).toEqual({ ok: true, accounts: [] });
  });

  it('trata resposta nula ou ausente como falha temporária', () => {
    expect(interpretAssignedInstagramAccounts(null)).toMatchObject({ ok: false, code: 'temporary', definitive: false });
    expect(interpretAssignedInstagramAccounts()).toMatchObject({ ok: false, code: 'temporary', definitive: false });
  });

  it('trata resposta malformada como falha temporária', () => {
    expect(interpretAssignedInstagramAccounts({ data: { id: '17841408602689007' } })).toMatchObject({
      ok: false,
      code: 'temporary',
      definitive: false,
    });
    expect(interpretAssignedInstagramAccounts('conta')).toMatchObject({ ok: false, code: 'temporary' });
  });

  it('preserva um Instagram ID grande como string', () => {
    const instagramAccountId = '9007199254740993';
    const result = interpretAssignedInstagramAccounts({
      data: [{ id: instagramAccountId, username: 'usevalleron' }],
    });
    expect(result.accounts[0].instagram_account_id).toBe(instagramAccountId);
    expect(typeof result.accounts[0].instagram_account_id).toBe('string');
  });

  it('ignora registro sem ID válido', () => {
    expect(interpretAssignedInstagramAccounts({
      data: [{ id: 'abc' }, { username: 'sem.id' }, { id: '' }, { id: 17841408602689007 }],
    })).toEqual({ ok: true, accounts: [] });
  });

  it('ignora campos extras sem inferir permissão', () => {
    const result = interpretAssignedInstagramAccounts({
      data: [{
        id: '17841408602689007',
        username: 'usevalleron',
        permissions: ['instagram_manage_messages'],
        access_token: 'token-de-fixture',
      }],
      paging: { cursors: { after: 'cursor-secreto' } },
    });
    expect(result).toEqual({
      ok: true,
      accounts: [{ instagram_account_id: '17841408602689007', instagram_username: 'usevalleron' }],
    });
    expect(JSON.stringify(result)).not.toContain('instagram_manage_messages');
    expect(JSON.stringify(result)).not.toContain('token-de-fixture');
    expect(JSON.stringify(result)).not.toContain('cursor-secreto');
  });
});

describe('relatório informativo de escopos', () => {
  it('marca os três escopos presentes', () => {
    expect(reportEffectiveScopes([
      'instagram_basic',
      'instagram_manage_messages',
      'instagram_manage_comments',
    ])).toEqual({
      instagram_basic: true,
      instagram_manage_messages: true,
      instagram_manage_comments: true,
    });
  });

  it('marca somente instagram_basic', () => {
    expect(reportEffectiveScopes(['instagram_basic'])).toEqual({
      ...ABSENT_SCOPES,
      instagram_basic: true,
    });
  });

  it('marca mensagem ausente', () => {
    expect(reportEffectiveScopes([
      'instagram_basic',
      'instagram_manage_comments',
    ])).toEqual({
      instagram_basic: true,
      instagram_manage_messages: false,
      instagram_manage_comments: true,
    });
  });

  it('marca lista vazia como ausente', () => {
    expect(reportEffectiveScopes([])).toEqual(ABSENT_SCOPES);
  });

  it('marca lista nula ou inválida como ausente', () => {
    expect(reportEffectiveScopes(null)).toEqual(ABSENT_SCOPES);
    expect(reportEffectiveScopes(undefined)).toEqual(ABSENT_SCOPES);
    expect(reportEffectiveScopes({ scopes: ['instagram_basic'] })).toEqual(ABSENT_SCOPES);
  });

  it('ignora escopos desconhecidos', () => {
    expect(reportEffectiveScopes([
      'instagram_basic',
      'pages_show_list',
      'ads_read',
    ])).toEqual({
      ...ABSENT_SCOPES,
      instagram_basic: true,
    });
  });

  it('não altera a lista recebida', () => {
    const scopes = ['instagram_manage_messages', 'instagram_basic'];
    const snapshot = [...scopes];
    reportEffectiveScopes(scopes);
    expect(scopes).toEqual(snapshot);
  });
});
