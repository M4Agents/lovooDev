// =============================================================================
// byoPocGate — company_id do Instagram BYO
//
// Confere apenas o formato UUID. Um UUID válido não autoriza a empresa:
// sessão, company_users e papel são validados na rota, depois deste passo.
// A cifra continua exclusiva de INSTAGRAM_BYO_TOKEN_ENC_KEY_V1.
// =============================================================================

/** Leitura do BYO. Seller fica de fora. Partner exige assignment no validador. */
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
  'webhook_route_id',
  'webhook_enabled',
  'webhook_verify_token_hash',
].join(', ');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * @param {{ requestedCompanyId?: string }} input
 * @returns {{ ok: true, companyId: string } | { ok: false, status: number, error: string }}
 */
export function evaluateByoPocAccess(input) {
  const requestedCompany = (input?.requestedCompanyId ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(requestedCompany)) {
    return { ok: false, status: 400, error: 'company_id_invalid' };
  }
  return { ok: true, companyId: requestedCompany };
}
