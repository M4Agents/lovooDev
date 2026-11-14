// =============================================================================
// POST   /api/nuvemshop/welcome-popup/test
// DELETE /api/nuvemshop/welcome-popup/test
//
// Teste autenticado. Não concede cupom, não altera lead e não publica.
// =============================================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller } from '../../lib/nuvemshop/validateNuvemshopCaller.js';
import { assertWelcomeScope, WELCOME_WRITE_ROLES } from '../../lib/nuvemshop/welcomePopupDraft.js';
import { clearWelcomeTests, runWelcomeTest } from '../../lib/nuvemshop/welcomeTestRun.js';

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function sendError(res, error) {
  return res.status(error.status ?? 500).json({
    error: error.message,
    code: error.code,
    ...(error.field ? { field: error.field } : {}),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Método não permitido', code: 'method_not_allowed' });
  }

  const source = req.body ?? {};
  const scope = assertWelcomeScope(one(source.company_id), one(source.store_id));
  if (!scope.ok) return sendError(res, scope.error);

  const svc = getSupabaseAdmin();
  const auth = await validateNuvemshopCaller(req, svc, scope.companyId, {
    roles: WELCOME_WRITE_ROLES,
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const result = req.method === 'DELETE'
    ? await clearWelcomeTests({ svc, companyId: scope.companyId, storeId: scope.storeId })
    : await runWelcomeTest({
      svc,
      companyId: scope.companyId,
      storeId: scope.storeId,
      userId: auth.userId,
      payload: source,
    });

  if (!result.ok) return sendError(res, result.error);
  return res.status(200).json(result);
}
