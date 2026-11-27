// =============================================================================
// validateMetaCaller
//
// Helper de autenticação e autorização para endpoints Meta WhatsApp Cloud API.
//
// A autorização de empresa vem de validateCompanyCaller, nesta ordem:
//   1. Authorization: Bearer <token>  — prefixo obrigatório
//   2. svc.auth.getUser(token)        — JWT validado remotamente
//   3. Formato UUID do companyId      — rejeitado se inválido
//   4. Membership direta ativa na empresa alvo — prevalece sobre a pai
//   5. Role dentro da lista permitida pela ação
//   6. Partner direto: assignment ativo na empresa alvo
//   7. Sem membership direta: partner herdado só com membership ativa de
//      partner na pai, company_type parent, assignment ativo na filha e
//      parent_company_id da filha igual a essa pai
//   8. Trilha seguinte: super_admin ou system_admin dessa mesma pai
//   9. Feature flag companies.meta_whatsapp_enabled — SEMPRE obrigatória
//
// A feature flag não possui bypass público. Todo caller Meta deve operar em
// empresa com meta_whatsapp_enabled = true. Se houver necessidade futura de
// ignorar a flag, ela será analisada e aprovada explicitamente.
//
// Roles disponíveis (exportadas para uso nos endpoints):
//   META_VIEW_ROLES    — leitura de instâncias e configurações
//   META_CONNECT_ROLES — iniciar onboarding, conectar, desconectar, rotacionar token
//   META_SEND_ROLES    — envio de mensagens
//
// Retorna em sucesso:
//   { ok: true, userId, companyId, role, accessPath }
//   accessPath: 'direct' | 'partner' | 'parent'
//
// Retorna em falha:
//   { ok: false, status, error }
//
// SEGURANÇA:
//   - Nunca confiar em company_id sem validar membership real.
//   - Nunca usar permission template como fonte de autorização.
//   - Nunca usar companies.user_id ou companies.is_super_admin.
//   - Usuário inativo (is_active = false) é tratado como sem acesso.
//   - Partner, direto ou herdado, exige assignment ativo na empresa alvo.
//   - Partner herdado também exige membership na pai e a mesma parent_company_id.
//   - auth_user_is_platform_admin() NÃO utilizado (cross-tenant inseguro).
//   - Nenhum dado sensível (token, key, ciphertext) é lido ou logado.
// =============================================================================

import { validateCompanyCaller } from '../auth/validateCompanyCaller.js';

/**
 * Roles que podem visualizar instâncias conectadas e configurações Meta.
 * Inclui seller — pode listar números configurados para envio.
 */
export const META_VIEW_ROLES = [
  'super_admin',
  'system_admin',
  'partner',
  'admin',
  'manager',
  'seller',
];

/**
 * Roles que podem iniciar onboarding Embedded Signup, conectar,
 * desconectar ou rotacionar token de uma instância.
 *
 * ATENÇÃO PARA PARTNER: presença aqui exige obrigatoriamente assignment ativo
 * em partner_company_assignments. O role sozinho NÃO garante acesso.
 */
export const META_CONNECT_ROLES = [
  'super_admin',
  'system_admin',
  'partner',
  'admin',
];

/**
 * Roles que podem enviar mensagens via Meta WhatsApp Cloud API.
 *
 * Matriz independente — não derivar de META_VIEW_ROLES ou META_CONNECT_ROLES.
 * Inclui seller: finalidade primária do CRM é envio de mensagens por operadores.
 *
 * ATENÇÃO PARA PARTNER: exige obrigatoriamente assignment ativo em
 * partner_company_assignments. O role sozinho NÃO garante acesso.
 */
export const META_SEND_ROLES = [
  'super_admin',
  'system_admin',
  'partner',
  'admin',
  'manager',
  'seller',
];

/**
 * Valida JWT + RBAC + feature flag para endpoints Meta WhatsApp Cloud API.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} companyId
 * @param {{ roles?: string[] }} [options]
 * @returns {Promise<
 *   | { ok: true, userId: string, companyId: string, role: string, accessPath: 'direct'|'partner'|'parent' }
 *   | { ok: false, status: number, error: string }
 * >}
 */
export async function validateMetaCaller(req, svc, companyId, options = {}) {
  const companyAuth = await validateCompanyCaller(req, svc, companyId, {
    roles: options.roles ?? META_VIEW_ROLES,
  });
  if (!companyAuth.ok) return companyAuth;
  return _checkFeatureFlagAndReturn(svc, companyAuth);
}

/**
 * Verifica companies.meta_whatsapp_enabled depois da autorização de empresa.
 * Não existe bypass. Flag ausente ou falsa nega o endpoint Meta.
 *
 * @private
 */
async function _checkFeatureFlagAndReturn(svc, { companyId, userId, role, accessPath }) {
  const { data: company } = await svc
    .from('companies')
    .select('meta_whatsapp_enabled')
    .eq('id', companyId)
    .maybeSingle();

  if (!company?.meta_whatsapp_enabled) {
    return { ok: false, status: 403, error: 'Meta WhatsApp não habilitado para esta empresa' };
  }

  return { ok: true, userId, companyId, role, accessPath };
}
