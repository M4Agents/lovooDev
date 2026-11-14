// =============================================================================
// GET/POST /api/nuvemshop/welcome-popup/public
//
// Nesta etapa o cadastro público não abre. enabled=false bloqueia a publicação
// e nenhuma combinação de corpo, origem ou parâmetro de URL grava dados.
// =============================================================================

import { publicSignupClosed } from '../../lib/nuvemshop/welcomePopupAccess.js';

function send(res, error) {
  return res.status(error.status).json({
    error: error.message,
    code: error.code,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'OPTIONS') {
    return res.status(405).json({ error: 'Método não permitido', code: 'method_not_allowed' });
  }
  return send(res, publicSignupClosed({ enabled: false }));
}
