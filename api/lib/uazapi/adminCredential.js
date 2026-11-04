// Credencial administrativa da UAZAPI. Existe só na memória do servidor.
// O valor não entra em resposta, log ou mensagem de erro.

const PLACEHOLDERS = new Set(['', 'your-uazapi-admin-token']);

export class AdminCredentialError extends Error {
  constructor() {
    super('Credencial administrativa indisponível');
    this.name = 'AdminCredentialError';
    this.code = 'admin_credential_unavailable';
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function readAdminToken(env = process.env) {
  const value = typeof env.UAZAPI_ADMIN_TOKEN === 'string' ? env.UAZAPI_ADMIN_TOKEN.trim() : '';
  if (PLACEHOLDERS.has(value)) throw new AdminCredentialError();
  return value;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveUazapiBaseUrl(env = process.env) {
  const raw = (env.UAZAPI_BASE_URL || 'https://lovoo.uazapi.com').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AdminCredentialError();
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AdminCredentialError();
  }
  return url.origin;
}
