// GET  /api/nuvemshop/promo-links?company_id=&store_id=
// POST /api/nuvemshop/promo-links
//
// Leitura: papéis que já veem a integração.
// Gravação: os mesmos papéis de criar cupom.
// A loja precisa ser a conexão ativa da empresa.

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js';
import { assertWelcomeScope } from '../lib/nuvemshop/welcomePopupDraft.js';
import { authorizePromoLinkCaller } from '../lib/nuvemshop/promoLinkAccess.js';
import { listPromoLinks, savePromoLink } from '../lib/nuvemshop/promoLinkConfig.js';

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
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const source = req.method === 'GET' ? (req.query ?? {}) : (req.body ?? {});
  const scope = assertWelcomeScope(one(source.company_id), one(source.store_id));
  if (!scope.ok) return sendError(res, scope.error);

  const svc = getSupabaseAdmin();
  const auth = await authorizePromoLinkCaller(req, svc, scope.companyId, {
    write: req.method === 'POST',
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const result = req.method === 'GET'
    ? await listPromoLinks({ svc, companyId: scope.companyId, storeId: scope.storeId })
    : await savePromoLink({
      svc,
      companyId: scope.companyId,
      storeId: scope.storeId,
      userId: auth.userId,
      payload: req.body ?? {},
    });

  if (!result.ok) return sendError(res, result.error);
  if (req.method === 'GET') return res.status(200).json({ links: result.links });
  return res.status(201).json({ link: result.link });
}
