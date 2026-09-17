// =============================================================================
// POST /api/whatsapp/meta/onboarding/start
//
// Inicia uma sessão de onboarding Meta WhatsApp Embedded Signup.
//
// Responsabilidades:
//   - Aceitar somente POST
//   - Validar company_id no body
//   - Autenticar + autorizar via validateMetaCaller (RBAC + feature flag)
//   - Obter config pública Meta (appId, configId) — sem secrets
//   - Calcular expires_at (now + 30 minutos)
//   - Inserir sessão em meta_whatsapp_onboarding
//   - Retornar state (id gerado pelo Postgres), app_id, config_id, expires_at
//
// Segurança:
//   - company_id vem do body mas é validado pelo guard (membership + RBAC + flag)
//   - user_id vem EXCLUSIVAMENTE do JWT validado — nunca do body
//   - id da sessão gerado pelo Postgres (gen_random_uuid) — nunca no runtime
//   - META_APP_SECRET não é lida nem retornada
//   - Erros internos nunca refletem detalhes de infra ao caller
//
// Ordem de execução (não alterar):
//   1. Method guard
//   2. Body/company_id parsing
//   3. getSupabaseAdmin()
//   4. validateMetaCaller() — auth + RBAC + feature flag
//   5. getMetaPublicConfig() — somente após auth
//   6. Calcular expires_at
//   7. INSERT meta_whatsapp_onboarding
//   8. Retornar response
// =============================================================================

import { getSupabaseAdmin }                         from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_CONNECT_ROLES }   from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { getMetaPublicConfig }                      from '../../../lib/meta-whatsapp/config.js';

// TTL da sessão de onboarding.
// 30 minutos para acomodar o fluxo interativo do Embedded Signup da Meta.
const ONBOARDING_TTL_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Body / company_id ───────────────────────────────────────────────────
  const { company_id: companyId } = req.body ?? {};

  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  try {
    // ── 3. Supabase service client ─────────────────────────────────────────
    const svc = getSupabaseAdmin();

    // ── 4. Auth + RBAC + feature flag ─────────────────────────────────────
    // validateMetaCaller valida (nesta ordem):
    //   Bearer → JWT → UUID format → membership → role → partner → parent → flag
    // user_id vem do JWT real — nunca do body.
    const auth = await validateMetaCaller(req, svc, companyId, { roles: META_CONNECT_ROLES });
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    // ── 5. Config pública Meta (sem secrets) ──────────────────────────────
    // Chamada somente após autorização bem-sucedida.
    // getMetaPublicConfig não lê META_APP_SECRET nem META_TOKEN_ENC_KEY_V1.
    let publicCfg;
    try {
      publicCfg = getMetaPublicConfig();
    } catch {
      return res.status(500).json({ error: 'Configuração Meta incompleta' });
    }

    // ── 6. TTL ────────────────────────────────────────────────────────────
    const expiresAt = new Date(Date.now() + ONBOARDING_TTL_MS).toISOString();

    // ── 7. INSERT — id gerado pelo Postgres (DEFAULT gen_random_uuid()) ───
    // Objeto inserido não inclui:
    //   id        → banco gera via DEFAULT
    //   used_at   → nasce NULL (sessão disponível)
    //   created_at → banco gera via DEFAULT now()
    const { data: session, error: insertErr } = await svc
      .from('meta_whatsapp_onboarding')
      .insert({
        company_id: companyId,
        user_id:    auth.userId,   // JWT validado — nunca req.body.user_id
        expires_at: expiresAt,
      })
      .select('id, expires_at')
      .single();

    if (insertErr || !session?.id) {
      return res.status(500).json({ error: 'Erro ao criar sessão de onboarding' });
    }

    // ── 8. Response ───────────────────────────────────────────────────────
    // state = session.id (UUID do Postgres — opaco para o frontend)
    // expires_at = valor confirmado pelo banco (não a variável local)
    // Não retornar: user_id, company_id, role, accessPath, secrets
    return res.status(200).json({
      state:      session.id,
      app_id:     publicCfg.appId,
      config_id:  publicCfg.configId,
      expires_at: session.expires_at,
    });

  } catch {
    // Erros inesperados de infra (getSupabaseAdmin, network, etc.)
    // Não refletir exception.message, stack, JWT, tokens, secrets.
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
