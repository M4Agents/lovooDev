// =============================================================================
// byoPocGate — trava da PoC Instagram BYO
//
// A rota só abre quando as três condições de servidor são verdadeiras:
//   INSTAGRAM_BYO_POC_ENABLED=true
//   VERCEL_PROJECT_ID === INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID
//   company_id da requisição === INSTAGRAM_BYO_ALLOWED_COMPANY_ID
//
// VERCEL_PROJECT_ID é definido pela Vercel no processo. A requisição não pode
// substituí-lo. O company_id do cliente só é aceito se coincidir com o valor
// do servidor. Sem qualquer variável, o acesso fica negado.
//
// Contrato de configuração, sem valores:
//   INSTAGRAM_BYO_POC_ENABLED
//   INSTAGRAM_BYO_ALLOWED_COMPANY_ID
//   INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID
//   INSTAGRAM_BYO_TOKEN_ENC_KEY_V1
//   INSTAGRAM_BYO_APP_ID
//   INSTAGRAM_BYO_APP_SECRET
// =============================================================================

import { timingSafeEqual } from 'node:crypto';

/** Leitura da PoC. Seller fica de fora. Partner exige assignment no validador. */
export const BYO_POC_ROLES = ['super_admin', 'system_admin', 'admin', 'manager', 'partner'];

export const SAFE_ACCOUNT_FIELDS = [
  'id',
  'company_id',
  'instagram_account_id',
  'system_user_id',
  'instagram_username',
  'encryption_version',
  'scopes',
  'status',
  'status_reason',
  'created_at',
  'updated_at',
].join(', ');

export const SAFE_CREDENTIAL_FIELDS = [
  'meta_app_id',
  'validation_status',
  'validation_error_code',
  'validated_at',
  'revoked_at',
  'credential_version',
].join(', ');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sameValue(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length === 0 || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/**
 * @param {{ requestedCompanyId?: string }} input
 * @returns {{ ok: true, companyId: string } | { ok: false, status: number, error: string }}
 */
export function evaluateByoPocAccess(input) {
  if (process.env.INSTAGRAM_BYO_POC_ENABLED !== 'true') {
    return { ok: false, status: 404, error: 'not_found' };
  }

  const allowedProject = (process.env.INSTAGRAM_BYO_ALLOWED_VERCEL_PROJECT_ID ?? '').trim();
  const currentProject = (process.env.VERCEL_PROJECT_ID ?? '').trim();
  if (!sameValue(allowedProject, currentProject)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  const allowedCompany = (process.env.INSTAGRAM_BYO_ALLOWED_COMPANY_ID ?? '').trim().toLowerCase();
  const requestedCompany = (input.requestedCompanyId ?? '').trim().toLowerCase();

  if (!UUID_PATTERN.test(allowedCompany)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  if (!UUID_PATTERN.test(requestedCompany)) {
    return { ok: false, status: 400, error: 'company_id_invalid' };
  }
  if (!sameValue(allowedCompany, requestedCompany)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  return { ok: true, companyId: allowedCompany };
}
