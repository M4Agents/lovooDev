// =============================================================================
// POST /api/instagram/data-deletion
//
// Callback obrigatório de exclusão de dados Instagram Business Login (Meta).
// Chamado quando o usuário solicita exclusão de dados do aplicativo.
//
// PROTOCOLO META:
//   - Content-Type: application/x-www-form-urlencoded
//   - Body: signed_request=<base64url_sig>.<base64url_payload>
//   - Sem JWT — chamada vem diretamente da Meta
//   - Resposta esperada: JSON com url e confirmation_code
//
// FLUXO:
//   1. Validar signed_request (HMAC-SHA256 + timingSafeEqual + anti-replay)
//   2. Extrair instagram_user_id
//   3. Gerar confirmation_code (UUID)
//   4. Buscar TODAS as conexões do instagram_user_id (multi-tenant)
//   5. Anonimizar dados por empresa
//   6. Registrar solicitação em instagram_data_deletion_requests
//   7. Audit logs por company_id
//   8. Responder com { url, confirmation_code }
//
// =============================================================================
// POLÍTICA DE RETENÇÃO (LGPD Art. 7 II + Art. 37–38)
//
// ANONIMIZADOS/REMOVIDOS:
//   - access_token_enc            (token de acesso — segurança)
//   - instagram_username          (PII identitária)
//   - profile_picture_url         (PII identitária)
//   - instagram_connections.status → 'revoked'
//   - participant_username        (instagram_conversations — PII)
//   - participant_name            (instagram_conversations — PII)
//   - participant_avatar          (instagram_conversations — PII)
//   - ig_user_id = '[DELETED]'    (instagram_comments — NOT NULL, substituído)
//   - ig_username = NULL          (instagram_comments)
//   - lead_social_profiles        (DELETE do registro — NOT NULL + UNIQUE constraints)
//
// MANTIDOS (base legal contratual/operacional do cliente):
//   - leads e opportunities       (histórico CRM — base legal própria da empresa)
//   - instagram_messages.content  (histórico operacional de atendimento)
//   - instagram_comments.content  (registro de moderação/atendimento)
//   - timestamps e audit logs     (obrigação legal de rastreabilidade)
//
// SEGURANÇA:
//   - Sem JWT — endpoint público validado por signed_request
//   - user_id extraído exclusivamente do signed_request validado
//   - Nunca expor token, ciphertext ou PII em logs/response
//   - multi-tenant: processa TODAS as empresas do instagram_user_id
// =============================================================================

import { parseSignedRequest } from '../../lib/meta/parseSignedRequest.js';
import { getSupabaseAdmin }   from '../../lib/automation/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const APP_SECRET = process.env.INSTAGRAM_APP_SECRET ?? '';
  const BASE_URL   = process.env.VITE_APP_URL ?? process.env.APP_URL ?? '';
  const svc        = getSupabaseAdmin();

  // ── 1. Validar signed_request ──────────────────────────────────────────────
  const signedRequest = req.body?.signed_request ?? req.query?.signed_request ?? '';

  const payload = parseSignedRequest(signedRequest, APP_SECRET);
  if (!payload) {
    return res.status(400).json({ error: 'invalid_signed_request' });
  }

  const instagramUserId = payload.user_id;

  // ── 2. Gerar confirmation_code ─────────────────────────────────────────────
  const { randomUUID } = await import('crypto');
  const confirmationCode = randomUUID();

  // ── 3. Buscar TODAS as conexões do instagram_user_id (multi-tenant) ────────
  // Sem filtro de company_id — o mesmo IG user pode estar em múltiplas empresas.
  const { data: connections, error: fetchErr } = await svc
    .from('instagram_connections')
    .select('id, company_id, status')
    .eq('instagram_user_id', instagramUserId);

  if (fetchErr) {
    console.error('[data-deletion] fetch connections error:', fetchErr.message);
    return res.status(500).json({ error: 'internal_error' });
  }

  const affectedCompanies = [];
  const now = new Date().toISOString();

  if (!connections || connections.length === 0) {
    // Sem conexões: registrar como not_found e retornar normalmente
    await svc.from('instagram_data_deletion_requests').insert({
      instagram_user_id:  instagramUserId,
      confirmation_code:  confirmationCode,
      status:             'not_found',
      affected_companies: [],
      created_at:         now,
      completed_at:       now,
    });

    const statusUrl = `${BASE_URL}/api/instagram/data-deletion/status?code=${confirmationCode}`;
    return res.status(200).json({ url: statusUrl, confirmation_code: confirmationCode });
  }

  // ── 4. Processar cada empresa separadamente ────────────────────────────────
  for (const conn of connections) {
    const companyId = conn.company_id;
    affectedCompanies.push(companyId);

    // ── 4a. Anonimizar instagram_connections ──────────────────────────────
    const { error: connUpdateErr } = await svc
      .from('instagram_connections')
      .update({
        access_token_enc:              null,
        instagram_username:            '[DELETED]',
        profile_picture_url:           null,
        status:                        'revoked',
        status_reason:                 'data_deletion_requested',
        data_deletion_requested_at:    now,
        data_deletion_completed_at:    now,
        updated_at:                    now,
      })
      .eq('id', conn.id);

    if (connUpdateErr) {
      console.error('[data-deletion] connections update error:', conn.id, connUpdateErr.message);
    }

    // ── 4b. Anonimizar instagram_conversations ─────────────────────────────
    // participant_username, participant_name, participant_avatar são PII
    const { error: convUpdateErr } = await svc
      .from('instagram_conversations')
      .update({
        participant_username: null,
        participant_name:     null,
        participant_avatar:   null,
      })
      .eq('company_id', companyId)
      .eq('connection_id', conn.id);

    if (convUpdateErr) {
      console.error('[data-deletion] conversations update error:', conn.id, convUpdateErr.message);
    }

    // ── 4c. Anonimizar instagram_comments ─────────────────────────────────
    // ig_user_id é NOT NULL → substitui por '[DELETED]'
    // ig_username é nullable → NULL
    const { error: commentsUpdateErr } = await svc
      .from('instagram_comments')
      .update({
        ig_user_id:   '[DELETED]',
        ig_username:  null,
      })
      .eq('company_id', companyId)
      .eq('connection_id', conn.id);

    if (commentsUpdateErr) {
      console.error('[data-deletion] comments update error:', conn.id, commentsUpdateErr.message);
    }

    // ── 4d. Deletar lead_social_profiles ──────────────────────────────────
    // NÃO usar UPDATE NULL — provider_user_id tem NOT NULL + UNIQUE constraint.
    // O registro é deletado; o lead permanece (base legal contratual).
    const { error: socialDeleteErr } = await svc
      .from('lead_social_profiles')
      .delete()
      .eq('provider', 'instagram')
      .eq('provider_user_id', instagramUserId);

    if (socialDeleteErr) {
      console.error('[data-deletion] social profiles delete error:', conn.id, socialDeleteErr.message);
    }

    // ── 4e. Audit log por company_id ──────────────────────────────────────
    // Sem PII sensível, sem token
    svc.from('instagram_audit_logs').insert({
      company_id:    companyId,
      connection_id: conn.id,
      action:        'data_deletion_requested',
      performed_by:  null,
      metadata: {
        trigger:            'meta_data_deletion_callback',
        confirmation_code:  confirmationCode,
        previous_status:    conn.status,
      },
    }).then(() => {}).catch(() => {});

    // ── 4f. Audit log de conclusão ─────────────────────────────────────────
    svc.from('instagram_audit_logs').insert({
      company_id:    companyId,
      connection_id: conn.id,
      action:        'data_deletion_completed',
      performed_by:  null,
      metadata: {
        confirmation_code: confirmationCode,
      },
    }).then(() => {}).catch(() => {});
  }

  // ── 5. Registrar solicitação na tabela de rastreamento ─────────────────────
  const { error: insertErr } = await svc
    .from('instagram_data_deletion_requests')
    .insert({
      instagram_user_id:  instagramUserId,
      confirmation_code:  confirmationCode,
      status:             'completed',
      affected_companies: affectedCompanies,
      created_at:         now,
      completed_at:       now,
    });

  if (insertErr) {
    console.error('[data-deletion] insert request error:', insertErr.message);
  }

  // ── 6. Resposta exigida pela Meta ──────────────────────────────────────────
  // Formato padrão JSON conforme RFC e exemplos oficiais Meta.
  // statusUrl: endpoint público sem PII para consulta de status.
  const statusUrl = `${BASE_URL}/api/instagram/data-deletion/status?code=${confirmationCode}`;

  return res.status(200).json({
    url:               statusUrl,
    confirmation_code: confirmationCode,
  });
}
