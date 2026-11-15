// POST /api/nuvemshop/promo-links/url
// Monta o link nativo na hora. Não grava a URL e não conta o clique.

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js';
import { assertWelcomeScope } from '../../lib/nuvemshop/welcomePopupDraft.js';
import { authorizePromoLinkCaller } from '../../lib/nuvemshop/promoLinkAccess.js';
import { promoLinkUrl } from '../../lib/nuvemshop/promoLinkConfig.js';

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function sendError(res, error) {
  return res.status(error.status ?? 500).json({
    error: error.message,
    code: error.code,
    ...(error.field ? { field: error.field } : {}),
    ...(error.hosts ? { hosts: error.hosts } : {}),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const body = req.body ?? {};
  const scope = assertWelcomeScope(one(body.company_id), one(body.store_id));
  if (!scope.ok) return sendError(res, scope.error);

  const svc = getSupabaseAdmin();
  const auth = await authorizePromoLinkCaller(req, svc, scope.companyId);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const result = await promoLinkUrl({
    svc,
    companyId: scope.companyId,
    storeId: scope.storeId,
    linkId: one(body.id),
    requestedHost: body.host,
  });
  if (!result.ok) return sendError(res, result.error);
  return res.status(200).json({ url: result.url, host: result.host });
}
