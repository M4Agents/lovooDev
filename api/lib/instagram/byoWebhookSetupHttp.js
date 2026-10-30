import { getSupabaseAdmin } from '../automation/supabaseAdmin.js';
import { authorizeByoCredentialWrite } from './byoCredentialAuth.js';
import { evaluateByoPocAccess } from './byoPocGate.js';
import {
  createWebhookSecret,
  hashWebhookVerifyToken,
  webhookRouteIdValid,
} from './byoWebhook.js';

const ELIGIBLE = new Set(['saved', 'pending', 'valid', 'failed']);
const ACTIONS = new Set(['generate', 'rotate']);

function reject(res, status, error) {
  return res.status(status).json({ error });
}

function readBody(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('company_id') || !keys.includes('action')) return null;
  if (typeof body.company_id !== 'string' || typeof body.action !== 'string') return null;
  return body;
}

async function companyIsActive(svc, companyId) {
  const loaded = await svc
    .from('companies')
    .select('id, status, deleted_at')
    .eq('id', companyId)
    .maybeSingle();
  if (loaded.error || !loaded.data) return false;
  return loaded.data.status === 'active' && loaded.data.deleted_at == null;
}

export async function handleByoWebhookSetup(req, res) {
  if (req.method !== 'POST') return reject(res, 405, 'method_not_allowed');
  const body = readBody(req);
  if (!body || !ACTIONS.has(body.action)) return reject(res, 400, 'rejected');

  const gate = evaluateByoPocAccess({ requestedCompanyId: body.company_id });
  if (!gate.ok) return reject(res, gate.status, gate.error);

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return reject(res, 503, 'unavailable');
  }

  const auth = await authorizeByoCredentialWrite(req, svc, gate.companyId);
  if (!auth.ok) return reject(res, auth.status, auth.error);
  if (!await companyIsActive(svc, gate.companyId)) return reject(res, 403, 'forbidden');

  const current = await svc
    .from('instagram_byo_company_credentials')
    .select('company_id, validation_status, webhook_route_id, webhook_enabled')
    .eq('company_id', gate.companyId)
    .maybeSingle();
  if (current.error) return reject(res, 503, 'unavailable');
  if (!current.data || !ELIGIBLE.has(current.data.validation_status)) return reject(res, 409, 'conflict');

  const verifyToken = createWebhookSecret();
  const verifyHash = hashWebhookVerifyToken(verifyToken);
  const routeId = body.action === 'generate' ? createWebhookSecret() : current.data.webhook_route_id;
  if (!webhookRouteIdValid(routeId)) return reject(res, 409, 'conflict');

  let update = svc
    .from('instagram_byo_company_credentials')
    .update({
      webhook_route_id: routeId,
      webhook_verify_token_hash: verifyHash,
      webhook_enabled: true,
    })
    .eq('company_id', gate.companyId)
    .in('validation_status', [...ELIGIBLE]);

  update = body.action === 'generate'
    ? update.is('webhook_route_id', null)
    : update.eq('webhook_route_id', routeId).eq('webhook_enabled', true);

  const saved = await update.select('company_id').maybeSingle();
  if (saved.error) return reject(res, 503, 'unavailable');
  if (!saved.data || saved.data.company_id !== gate.companyId) return reject(res, 409, 'conflict');

  return res.status(200).json({
    ok: true,
    company_id: gate.companyId,
    webhook_route_id: routeId,
    webhook_verify_token: verifyToken,
    webhook_enabled: true,
  });
}
