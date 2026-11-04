// POST /api/uazapi/qr-session
// Autentica o usuário e só então usa a credencial administrativa do servidor.
// A resposta não contém token administrativo nem token da instância.

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js';
import { extractToken, getUserFromToken } from '../lib/dashboard/auth.js';
import { AdminCredentialError } from '../lib/uazapi/adminCredential.js';
import { authorizeQrSession } from '../lib/uazapi/qrAuthorization.js';
import { createQrSession, QrSessionError } from '../lib/uazapi/qrSession.js';

function send(res, status, body) {
  res.status(status).json(body);
}

function publicRecovery(recovery) {
  if (!recovery || typeof recovery.temp_instance_id !== 'string') return null;
  return {
    temp_instance_id: recovery.temp_instance_id,
    instance_name: recovery.instance_name,
    company_id: recovery.company_id,
    status: recovery.status,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { success: false, error: 'Método não permitido' });
    return;
  }

  try {
    const token = extractToken(req.headers?.authorization ?? req.headers?.Authorization);
    if (!token) {
      send(res, 401, { success: false, error: 'Não autenticado' });
      return;
    }

    const { user, error: authError } = await getUserFromToken(token);
    if (!user || authError) {
      send(res, 401, { success: false, error: 'Não autenticado' });
      return;
    }

    const companyId = req.body?.company_id;
    const instanceName = req.body?.instance_name;
    const tempInstanceId = req.body?.temp_instance_id;
    const svc = getSupabaseAdmin();
    const access = await authorizeQrSession(svc, user.id, companyId);
    if (!access.ok) {
      send(res, access.status, { success: false, error: access.error });
      return;
    }

    const payload = await createQrSession({ svc, companyId, instanceName, tempInstanceId });
    send(res, 200, payload);
  } catch (error) {
    if (error instanceof AdminCredentialError) {
      console.error('[qr-session] credencial administrativa indisponível');
      send(res, 503, { success: false, error: 'Serviço de conexão indisponível' });
      return;
    }
    if (error instanceof QrSessionError) {
      console.error('[qr-session] falha', error.code);
      const body = { success: false, error: error.publicMessage };
      if (error.extra?.planInfo) body.planInfo = error.extra.planInfo;
      const retry = publicRecovery(error.extra?.recovery);
      if (retry) body.data = retry;
      send(res, error.status, body);
      return;
    }
    console.error('[qr-session] erro interno');
    send(res, 500, { success: false, error: 'Erro interno ao gerar o QR Code' });
  }
}
