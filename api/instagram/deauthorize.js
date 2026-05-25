// =============================================================================
// POST /api/instagram/deauthorize
//
// Callback de desautorização Instagram Business Login (Meta).
// Chamado quando o usuário remove o aplicativo das permissões no Instagram.
//
// PROTOCOLO META:
//   - Content-Type: application/x-www-form-urlencoded
//   - Body: signed_request=<base64url_sig>.<base64url_payload>
//   - Sem JWT — chamada vem diretamente da Meta
//   - Resposta esperada: 200 OK
//
// FLUXO:
//   1. Validar signed_request (HMAC-SHA256 + timingSafeEqual + anti-replay)
//   2. Extrair instagram_user_id do payload validado
//   3. Buscar TODAS as conexões com esse instagram_user_id (multi-tenant)
//   4. Para cada conexão:
//      - NÃO anonimizar dados (sem exclusão de mensagens/conversas/comentários)
//      - Apenas revogar: access_token_enc=NULL, status='revoked'
//      - Registrar audit log por company_id
//   5. Retornar 200 OK
//
// DIFERENÇA vs DATA DELETION:
//   - Deauthorize: apenas revoga token (sem anonimização de dados)
//   - Data Deletion: anonimiza username, avatar, social links, token
//
// SEGURANÇA:
//   - Sem JWT — endpoint público validado por signed_request
//   - user_id extraído exclusivamente do signed_request validado
//   - Nunca expor token, ciphertext ou PII em logs
//   - multi-tenant: processa TODAS as empresas do instagram_user_id
// =============================================================================

import { parseSignedRequest } from '../lib/meta/parseSignedRequest.js';
import { getSupabaseAdmin }   from '../lib/automation/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const APP_SECRET = process.env.INSTAGRAM_APP_SECRET ?? '';
  const svc        = getSupabaseAdmin();

  // ── 1. Extrair e validar signed_request ───────────────────────────────────
  const signedRequest = req.body?.signed_request ?? req.query?.signed_request ?? '';

  const payload = parseSignedRequest(signedRequest, APP_SECRET);
  if (!payload) {
    return res.status(400).json({ error: 'invalid_signed_request' });
  }

  const instagramUserId = payload.user_id;

  // ── 2. Buscar TODAS as conexões do instagram_user_id (multi-tenant) ────────
  // Sem filtro de company_id — o mesmo IG user pode estar em múltiplas empresas.
  const { data: connections, error: fetchErr } = await svc
    .from('instagram_connections')
    .select('id, company_id, status')
    .eq('instagram_user_id', instagramUserId);

  if (fetchErr) {
    console.error('[deauthorize] fetch connections error:', fetchErr.message);
    return res.status(500).json({ error: 'internal_error' });
  }

  // Se não há conexões: responder 200 (Meta não precisa saber sobre estado interno)
  if (!connections || connections.length === 0) {
    return res.status(200).end();
  }

  const now = new Date().toISOString();

  // ── 3. Processar cada empresa separadamente ────────────────────────────────
  for (const conn of connections) {
    // Revogar token — sem anonimizar dados de conversa/comentários
    const { error: updateErr } = await svc
      .from('instagram_connections')
      .update({
        access_token_enc: null,
        status:           'revoked',
        status_reason:    'deauthorize_callback_meta',
        updated_at:       now,
      })
      .eq('id', conn.id);

    if (updateErr) {
      console.error('[deauthorize] update error:', conn.id, updateErr.message);
    }

    // Audit log por company_id (multi-tenant: log separado por empresa)
    svc.from('instagram_audit_logs').insert({
      company_id:    conn.company_id,
      connection_id: conn.id,
      action:        'deauthorize_received',
      performed_by:  null,
      metadata: {
        trigger:            'meta_deauthorize_callback',
        previous_status:    conn.status,
      },
    }).then(() => {}).catch(() => {});
  }

  // ── 4. Meta espera apenas 200 OK ───────────────────────────────────────────
  return res.status(200).end();
}
