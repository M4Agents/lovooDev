// =============================================================================
// config — Configuração Meta WhatsApp Cloud API
//
// Responsabilidade: carregar e validar variáveis de ambiente Meta WhatsApp.
// Sem HTTP, sem Supabase, sem banco, sem frontend.
//
// ENVs obrigatórias:
//   META_APP_ID                    — App ID do Facebook App (público)
//   META_EMBEDDED_SIGNUP_CONFIG_ID — Login for Business Configuration ID (público)
//   META_APP_SECRET                — App Secret (SECRET — nunca ao frontend, nunca logar)
//
// Funções exportadas:
//   getMetaPublicConfig()   — retorna appId + configId (não exige APP_SECRET)
//   getMetaServerConfig()   — retorna appId + appSecret + configId + graphVersion
//
// SEGURANÇA:
//   - Fail closed: qualquer ENV ausente/inválida causa throw imediato
//   - Sem fallback silencioso, sem default, sem hardcode de valor real
//   - Mensagens de erro nunca refletem o conteúdo das ENVs
//   - APP_SECRET nunca é retornado por getMetaPublicConfig()
//   - graphVersion não é retornado por getMetaPublicConfig() (backend only)
//
// Isolamento:
//   - Não importa config do Instagram ou Nuvemshop
//   - graphVersion é constante interna — não configurável por ENV
// =============================================================================

// Versão da Graph API para todas as chamadas Meta WhatsApp Cloud API.
// Não reutiliza a constante do Instagram (v21.0).
// Mudança de versão exige alteração de código deliberada (pode ter breaking changes).
const GRAPH_VERSION = 'v26.0';

// =============================================================================
// Validadores internos
// =============================================================================

/**
 * Valida que uma ENV string está presente e não vazia.
 * Não trimeia, não muta, não reflete o valor na mensagem de erro.
 *
 * @private
 * @param {string|undefined} value - Valor da variável de ambiente
 * @param {string} envName - Nome da variável (ex: 'META_APP_ID')
 * @throws {Error} Fail closed — mensagem genérica sem expor o valor
 */
function requireEnv(value, envName) {
  if (!value) {
    throw new Error(`[meta/config] ${envName} não configurada`);
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[meta/config] ${envName} inválida`);
  }
}

// =============================================================================
// API pública
// =============================================================================

/**
 * Retorna a configuração pública do Meta WhatsApp necessária para o frontend
 * iniciar o fluxo Embedded Signup.
 *
 * Valida e retorna SOMENTE:
 *   - appId    (META_APP_ID)
 *   - configId (META_EMBEDDED_SIGNUP_CONFIG_ID)
 *
 * NÃO exige META_APP_SECRET.
 * NÃO retorna appSecret.
 * NÃO retorna graphVersion (backend only).
 *
 * @returns {{ appId: string, configId: string }}
 * @throws {Error} Fail closed se qualquer ENV estiver ausente ou vazia
 */
export function getMetaPublicConfig() {
  const appId    = process.env.META_APP_ID;
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;

  requireEnv(appId,    'META_APP_ID');
  requireEnv(configId, 'META_EMBEDDED_SIGNUP_CONFIG_ID');

  return {
    appId,
    configId,
  };
}

/**
 * Retorna a configuração completa do Meta WhatsApp para uso exclusivo no backend.
 *
 * Valida e retorna:
 *   - appId        (META_APP_ID)
 *   - appSecret    (META_APP_SECRET — SECRET, nunca expor ao frontend)
 *   - configId     (META_EMBEDDED_SIGNUP_CONFIG_ID)
 *   - graphVersion (constante interna v26.0, backend only)
 *
 * @returns {{ appId: string, appSecret: string, configId: string, graphVersion: string }}
 * @throws {Error} Fail closed se qualquer ENV estiver ausente ou vazia
 */
export function getMetaServerConfig() {
  // Reutiliza validação pública (appId + configId)
  const { appId, configId } = getMetaPublicConfig();

  const appSecret = process.env.META_APP_SECRET;
  requireEnv(appSecret, 'META_APP_SECRET');

  return {
    appId,
    appSecret,
    configId,
    graphVersion: GRAPH_VERSION,
  };
}
