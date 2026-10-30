// =============================================================================
// GET /api/instagram/byo-poc/status?company_id=<uuid>
//
// Leitura da PoC BYO. Não grava, não chama a Meta e não lê tabelas oficiais.
// Não aceita token, App Secret nem payload de webhook.
// =============================================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../lib/instagram/validateInstagramCaller.js';
import {
  BYO_POC_ROLES,
  SAFE_ACCOUNT_FIELDS,
  SAFE_CREDENTIAL_FIELDS,
  evaluateByoPocAccess,
} from '../../lib/instagram/byoPocGate.js';

function presentCredentials(row) {
  if (!row) {
    return {
      configured: false,
      validation_status: 'not_configured',
      meta_app_id: null,
      validated_at: null,
      revoked_at: null,
      credential_version: null,
      validation_error_code: null,
      webhook_route_id: null,
      webhook_enabled: false,
      webhook_verify_configured: false,
    };
  }

  return {
    configured: row.validation_status !== 'revoked',
    validation_status: row.validation_status,
    meta_app_id: row.meta_app_id ?? null,
    validated_at: row.validated_at ?? null,
    revoked_at: row.revoked_at ?? null,
    credential_version: row.credential_version ?? null,
    validation_error_code: row.validation_status === 'failed'
      ? (row.validation_error_code ?? null)
      : null,
    webhook_route_id: typeof row.webhook_route_id === 'string' ? row.webhook_route_id : null,
    webhook_enabled: row.webhook_enabled === true,
    webhook_verify_configured: typeof row.webhook_verify_token_hash === 'string'
      && row.webhook_verify_token_hash.length === 64,
  };
}

function presentAccountStatus(accounts) {
  if (accounts.length === 0) return 'not_connected';
  return accounts.some((account) => account.status === 'poc_enabled')
    ? 'poc_enabled'
    : 'poc_disabled';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const rawCompanyId = req.query?.company_id;
  const gate = evaluateByoPocAccess({
    requestedCompanyId: typeof rawCompanyId === 'string' ? rawCompanyId : '',
  });
  if (!gate.ok) {
    return res.status(gate.status).json({ error: gate.error });
  }

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'unavailable' });
  }

  const auth = await validateInstagramCaller(req, svc, gate.companyId, { roles: BYO_POC_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const credentialQuery = await svc
    .from('instagram_byo_company_credentials')
    .select(SAFE_CREDENTIAL_FIELDS)
    .eq('company_id', gate.companyId)
    .maybeSingle();

  if (credentialQuery.error) {
    return res.status(500).json({ error: 'unavailable' });
  }

  const accountQuery = await svc
    .from('instagram_byo_poc_accounts')
    .select(SAFE_ACCOUNT_FIELDS)
    .eq('company_id', gate.companyId);

  if (accountQuery.error) {
    return res.status(500).json({ error: 'unavailable' });
  }

  const accounts = accountQuery.data ?? [];

  return res.status(200).json({
    ok: true,
    company_id: gate.companyId,
    credentials: presentCredentials(credentialQuery.data),
    account_status: presentAccountStatus(accounts),
    accounts,
  });
}
