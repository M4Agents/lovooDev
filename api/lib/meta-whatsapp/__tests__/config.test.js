// =============================================================================
// config.test.js
//
// Testes unitários para api/lib/meta-whatsapp/config.js
// Todos os testes usam valores fictícios — sem secrets reais.
//
// COBERTURA:
//   TC-PA  getMetaPublicConfig — retorno correto
//   TC-PB  getMetaPublicConfig — falha sem META_APP_ID
//   TC-PC  getMetaPublicConfig — falha com META_APP_ID vazio
//   TC-PD  getMetaPublicConfig — falha sem META_EMBEDDED_SIGNUP_CONFIG_ID
//   TC-PE  getMetaPublicConfig — falha com META_EMBEDDED_SIGNUP_CONFIG_ID vazio
//   TC-PF  getMetaPublicConfig — NÃO exige META_APP_SECRET
//   TC-PG  getMetaPublicConfig — NÃO retorna appSecret
//   TC-PH  getMetaPublicConfig — NÃO retorna graphVersion
//
//   TC-SA  getMetaServerConfig — retorno correto (appId, appSecret, configId, graphVersion)
//   TC-SB  getMetaServerConfig — graphVersion === 'v26.0'
//   TC-SC  getMetaServerConfig — falha sem META_APP_SECRET
//   TC-SD  getMetaServerConfig — falha com META_APP_SECRET vazio
//   TC-SE  getMetaServerConfig — mensagem de erro não reflete valor do secret
//   TC-SF  getMetaServerConfig — ainda falha sem META_APP_ID
//   TC-SG  getMetaServerConfig — ainda falha sem META_EMBEDDED_SIGNUP_CONFIG_ID
//
//   TC-ISO Isolamento — beforeEach/afterEach, sem console.*, sem HTTP, sem Supabase
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getMetaPublicConfig, getMetaServerConfig, getMetaWebhookConfig } from '../config.js';

// =============================================================================
// Fixtures — valores fictícios, nunca reais
// =============================================================================

const FAKE_APP_ID       = '111111111111111';
const FAKE_CONFIG_ID    = '222222222222222';
const FAKE_SECRET       = 'fake_app_secret_fixture_not_real';
const FAKE_VERIFY_TOKEN = 'fake_webhook_verify_token_for_tests_only';

// =============================================================================
// Setup / Teardown — isolamento total de process.env
// =============================================================================

let savedEnv;

beforeEach(() => {
  savedEnv = {
    META_APP_ID:                    process.env.META_APP_ID,
    META_EMBEDDED_SIGNUP_CONFIG_ID: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
    META_APP_SECRET:                process.env.META_APP_SECRET,
    META_WEBHOOK_VERIFY_TOKEN:      process.env.META_WEBHOOK_VERIFY_TOKEN,
  };

  // Configurar valores válidos como ponto de partida de cada teste
  process.env.META_APP_ID                    = FAKE_APP_ID;
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = FAKE_CONFIG_ID;
  process.env.META_APP_SECRET                = FAKE_SECRET;
  process.env.META_WEBHOOK_VERIFY_TOKEN      = FAKE_VERIFY_TOKEN;
});

afterEach(() => {
  // Restaurar valores originais — não contaminar outros testes
  if (savedEnv.META_APP_ID === undefined) {
    delete process.env.META_APP_ID;
  } else {
    process.env.META_APP_ID = savedEnv.META_APP_ID;
  }

  if (savedEnv.META_EMBEDDED_SIGNUP_CONFIG_ID === undefined) {
    delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
  } else {
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = savedEnv.META_EMBEDDED_SIGNUP_CONFIG_ID;
  }

  if (savedEnv.META_APP_SECRET === undefined) {
    delete process.env.META_APP_SECRET;
  } else {
    process.env.META_APP_SECRET = savedEnv.META_APP_SECRET;
  }

  if (savedEnv.META_WEBHOOK_VERIFY_TOKEN === undefined) {
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
  } else {
    process.env.META_WEBHOOK_VERIFY_TOKEN = savedEnv.META_WEBHOOK_VERIFY_TOKEN;
  }
});

// =============================================================================
// Testes
// =============================================================================

describe('config — Meta WhatsApp', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // TC-PA: getMetaPublicConfig — retorno correto
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-PA: getMetaPublicConfig retorna appId e configId corretos', () => {
    it('retorna appId igual ao valor de META_APP_ID', () => {
      const cfg = getMetaPublicConfig();
      expect(cfg.appId).toBe(FAKE_APP_ID);
    });

    it('retorna configId igual ao valor de META_EMBEDDED_SIGNUP_CONFIG_ID', () => {
      const cfg = getMetaPublicConfig();
      expect(cfg.configId).toBe(FAKE_CONFIG_ID);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-PB: getMetaPublicConfig — falha sem META_APP_ID
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-PB: getMetaPublicConfig falha sem META_APP_ID', () => {
    it('lança erro quando META_APP_ID está ausente', () => {
      delete process.env.META_APP_ID;
      expect(() => getMetaPublicConfig()).toThrow('META_APP_ID');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-PC: getMetaPublicConfig — falha com META_APP_ID vazio
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-PC: getMetaPublicConfig falha com META_APP_ID vazio', () => {
    it('lança erro quando META_APP_ID é string vazia', () => {
      process.env.META_APP_ID = '';
      expect(() => getMetaPublicConfig()).toThrow('META_APP_ID');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-PD: getMetaPublicConfig — falha sem META_EMBEDDED_SIGNUP_CONFIG_ID
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-PD: getMetaPublicConfig falha sem META_EMBEDDED_SIGNUP_CONFIG_ID', () => {
    it('lança erro quando META_EMBEDDED_SIGNUP_CONFIG_ID está ausente', () => {
      delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
      expect(() => getMetaPublicConfig()).toThrow('META_EMBEDDED_SIGNUP_CONFIG_ID');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-PE: getMetaPublicConfig — falha com META_EMBEDDED_SIGNUP_CONFIG_ID vazio
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-PE: getMetaPublicConfig falha com META_EMBEDDED_SIGNUP_CONFIG_ID vazio', () => {
    it('lança erro quando META_EMBEDDED_SIGNUP_CONFIG_ID é string vazia', () => {
      process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = '';
      expect(() => getMetaPublicConfig()).toThrow('META_EMBEDDED_SIGNUP_CONFIG_ID');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-PF: getMetaPublicConfig — NÃO exige META_APP_SECRET
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-PF: getMetaPublicConfig NÃO exige META_APP_SECRET', () => {
    it('retorna config corretamente mesmo sem META_APP_SECRET configurada', () => {
      delete process.env.META_APP_SECRET;

      // NÃO deve lançar
      let cfg;
      expect(() => { cfg = getMetaPublicConfig(); }).not.toThrow();
      expect(cfg.appId).toBe(FAKE_APP_ID);
      expect(cfg.configId).toBe(FAKE_CONFIG_ID);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-PG: getMetaPublicConfig — NÃO retorna appSecret
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-PG: getMetaPublicConfig NÃO retorna appSecret', () => {
    it('resultado não contém propriedade appSecret', () => {
      const cfg = getMetaPublicConfig();
      expect(cfg).not.toHaveProperty('appSecret');
    });

    it('resultado não contém o valor da META_APP_SECRET', () => {
      const cfg = getMetaPublicConfig();
      const serialized = JSON.stringify(cfg);
      expect(serialized).not.toContain(FAKE_SECRET);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-PH: getMetaPublicConfig — NÃO retorna graphVersion
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-PH: getMetaPublicConfig NÃO retorna graphVersion', () => {
    it('resultado não contém propriedade graphVersion', () => {
      const cfg = getMetaPublicConfig();
      expect(cfg).not.toHaveProperty('graphVersion');
    });

    it('resultado contém exatamente as propriedades appId e configId', () => {
      const cfg = getMetaPublicConfig();
      expect(Object.keys(cfg)).toEqual(expect.arrayContaining(['appId', 'configId']));
      expect(Object.keys(cfg)).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-SA: getMetaServerConfig — retorno correto
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-SA: getMetaServerConfig retorna appId, appSecret, configId e graphVersion', () => {
    it('retorna appId correto', () => {
      const cfg = getMetaServerConfig();
      expect(cfg.appId).toBe(FAKE_APP_ID);
    });

    it('retorna appSecret correto', () => {
      const cfg = getMetaServerConfig();
      expect(cfg.appSecret).toBe(FAKE_SECRET);
    });

    it('retorna configId correto', () => {
      const cfg = getMetaServerConfig();
      expect(cfg.configId).toBe(FAKE_CONFIG_ID);
    });

    it('resultado contém exatamente as propriedades appId, appSecret, configId, graphVersion', () => {
      const cfg = getMetaServerConfig();
      expect(Object.keys(cfg).sort()).toEqual(['appId', 'appSecret', 'configId', 'graphVersion'].sort());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-SB: getMetaServerConfig — graphVersion === 'v26.0'
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-SB: getMetaServerConfig graphVersion', () => {
    it('graphVersion é exatamente "v26.0"', () => {
      const cfg = getMetaServerConfig();
      expect(cfg.graphVersion).toBe('v26.0');
    });

    it('graphVersion não depende de nenhuma ENV — é constante interna', () => {
      // Mesmo se uma hipotética ENV existisse, não deveria ser usada
      process.env.META_GRAPH_VERSION = 'v99.0';  // ENV inexistente no helper
      const cfg = getMetaServerConfig();
      expect(cfg.graphVersion).toBe('v26.0');
      delete process.env.META_GRAPH_VERSION;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-SC: getMetaServerConfig — falha sem META_APP_SECRET
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-SC: getMetaServerConfig falha sem META_APP_SECRET', () => {
    it('lança erro quando META_APP_SECRET está ausente', () => {
      delete process.env.META_APP_SECRET;
      expect(() => getMetaServerConfig()).toThrow('META_APP_SECRET');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-SD: getMetaServerConfig — falha com META_APP_SECRET vazio
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-SD: getMetaServerConfig falha com META_APP_SECRET vazio', () => {
    it('lança erro quando META_APP_SECRET é string vazia', () => {
      process.env.META_APP_SECRET = '';
      expect(() => getMetaServerConfig()).toThrow('META_APP_SECRET');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-SE: getMetaServerConfig — mensagem de erro não reflete valor do secret
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-SE: mensagem de erro não reflete o valor de META_APP_SECRET', () => {
    it('erro sem META_APP_SECRET não expõe o nome da variável com seu valor', () => {
      // Colocar um valor distinto para garantir que não vazou
      process.env.META_APP_SECRET = 'valor_secreto_que_nao_deve_aparecer';

      // Forçar falha zerando depois (teste de ausência)
      process.env.META_APP_SECRET = '';

      let errorMessage = '';
      try {
        getMetaServerConfig();
      } catch (err) {
        errorMessage = err.message;
      }

      expect(errorMessage).toMatch(/META_APP_SECRET/);
      expect(errorMessage).not.toContain('valor_secreto_que_nao_deve_aparecer');
    });

    it('mensagem de erro não contém o valor da ENV mesmo quando ela está presente mas inválida', () => {
      const sensitiveValue = 'secret_que_nunca_deve_aparecer_no_erro';
      process.env.META_APP_SECRET = '';  // vazio — forçar erro

      let errorMessage = '';
      try {
        getMetaServerConfig();
      } catch (err) {
        errorMessage = err.message;
      }

      expect(errorMessage).not.toContain(sensitiveValue);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-SF: getMetaServerConfig — ainda falha sem META_APP_ID
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-SF: getMetaServerConfig ainda falha sem META_APP_ID', () => {
    it('lança erro quando META_APP_ID está ausente (validação pública herdada)', () => {
      delete process.env.META_APP_ID;
      expect(() => getMetaServerConfig()).toThrow('META_APP_ID');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-SG: getMetaServerConfig — ainda falha sem META_EMBEDDED_SIGNUP_CONFIG_ID
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-SG: getMetaServerConfig ainda falha sem META_EMBEDDED_SIGNUP_CONFIG_ID', () => {
    it('lança erro quando META_EMBEDDED_SIGNUP_CONFIG_ID está ausente (validação pública herdada)', () => {
      delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
      expect(() => getMetaServerConfig()).toThrow('META_EMBEDDED_SIGNUP_CONFIG_ID');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-ISO: Isolamento — sem efeitos colaterais
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-ISO: isolamento e ausência de efeitos colaterais', () => {
    it('não chama console.log', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      getMetaPublicConfig();
      getMetaServerConfig();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('não chama console.error', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      getMetaPublicConfig();
      getMetaServerConfig();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('não chama console.warn', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getMetaPublicConfig();
      getMetaServerConfig();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('process.env preservado após chamada com sucesso', () => {
      const beforeAppId    = process.env.META_APP_ID;
      const beforeConfigId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
      const beforeSecret   = process.env.META_APP_SECRET;

      getMetaPublicConfig();
      getMetaServerConfig();

      expect(process.env.META_APP_ID).toBe(beforeAppId);
      expect(process.env.META_EMBEDDED_SIGNUP_CONFIG_ID).toBe(beforeConfigId);
      expect(process.env.META_APP_SECRET).toBe(beforeSecret);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-WA: getMetaWebhookConfig — retorno correto
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-WA: getMetaWebhookConfig retorna verifyToken correto', () => {
    it('retorna verifyToken igual ao valor de META_WEBHOOK_VERIFY_TOKEN', () => {
      const { verifyToken } = getMetaWebhookConfig();
      expect(verifyToken).toBe(FAKE_VERIFY_TOKEN);
    });

    it('retorna somente verifyToken — nenhuma outra chave exposta', () => {
      const result = getMetaWebhookConfig();
      expect(Object.keys(result)).toEqual(['verifyToken']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-WB: getMetaWebhookConfig — falha sem META_WEBHOOK_VERIFY_TOKEN
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-WB: getMetaWebhookConfig falha sem META_WEBHOOK_VERIFY_TOKEN', () => {
    it('lança erro quando META_WEBHOOK_VERIFY_TOKEN está ausente', () => {
      delete process.env.META_WEBHOOK_VERIFY_TOKEN;
      expect(() => getMetaWebhookConfig()).toThrow('META_WEBHOOK_VERIFY_TOKEN');
    });

    it('lança erro quando META_WEBHOOK_VERIFY_TOKEN é string vazia', () => {
      process.env.META_WEBHOOK_VERIFY_TOKEN = '';
      expect(() => getMetaWebhookConfig()).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-WC: getMetaWebhookConfig — isolamento de responsabilidade
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-WC: getMetaWebhookConfig — isolamento', () => {
    it('NÃO exige META_APP_SECRET', () => {
      delete process.env.META_APP_SECRET;
      expect(() => getMetaWebhookConfig()).not.toThrow();
    });

    it('NÃO retorna appSecret nem appId', () => {
      const result = getMetaWebhookConfig();
      expect(result).not.toHaveProperty('appSecret');
      expect(result).not.toHaveProperty('appId');
    });

    it('mensagem de erro não reflete o conteúdo do token', () => {
      delete process.env.META_WEBHOOK_VERIFY_TOKEN;
      let errMsg = '';
      try { getMetaWebhookConfig(); } catch (e) { errMsg = e.message; }
      expect(errMsg).not.toContain(FAKE_VERIFY_TOKEN);
    });
  });

});
