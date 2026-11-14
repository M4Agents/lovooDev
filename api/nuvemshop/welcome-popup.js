// =============================================================================
// GET  /api/nuvemshop/welcome-popup?company_id=&store_id=
// PUT  /api/nuvemshop/welcome-popup
//
// Configuração por loja do pop-up de boas-vindas. Nesta etapa só existe
// rascunho: enabled=true responde 409 e nenhuma linha é publicada.
//
// Segurança:
//   - JWT obrigatório
//   - company_id conferido na membership; nunca aceito de outro campo
//   - leitura: papéis que já veem a integração
//   - gravação: os mesmos papéis de criar cupom
//   - store_id precisa ser a conexão ativa daquela empresa
// =============================================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js';
import { validateNuvemshopCaller, ALLOWED_ROLES } from '../lib/nuvemshop/validateNuvemshopCaller.js';
import {
  activationRequested,
  assertWelcomeScope,
  getWelcomeCampaign,
  saveWelcomeCampaign,
  WELCOME_WRITE_ROLES,
} from '../lib/nuvemshop/welcomePopupConfig.js';

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
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const source = req.method === 'GET' ? (req.query ?? {}) : (req.body ?? {});
  const scope = assertWelcomeScope(one(source.company_id), one(source.store_id));
  if (!scope.ok) return sendError(res, scope.error);

  const svc = getSupabaseAdmin();
  const auth = await validateNuvemshopCaller(req, svc, scope.companyId, {
    roles: req.method === 'PUT' ? WELCOME_WRITE_ROLES : ALLOWED_ROLES,
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (req.method === 'PUT' && activationRequested(req.body?.enabled)) {
    return res.status(409).json({
      error: 'O pop-up ainda não pode ser publicado. O formulário público não está disponível.',
      code: 'publication_blocked',
      field: 'enabled',
    });
  }

  const result = req.method === 'GET'
    ? await getWelcomeCampaign({ svc, companyId: scope.companyId, storeId: scope.storeId })
    : await saveWelcomeCampaign({
      svc,
      companyId: scope.companyId,
      storeId: scope.storeId,
      userId: auth.userId,
      payload: req.body ?? {},
    });

  if (!result.ok) return sendError(res, result.error);
  return res.status(200).json({ campaign: result.campaign });
}
