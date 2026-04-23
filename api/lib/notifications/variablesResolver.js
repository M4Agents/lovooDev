// =============================================================================
// api/lib/notifications/variablesResolver.js
//
// Resolução das variáveis dinâmicas para notificações de trial alerts.
//
// Responsabilidades:
//   1. resolveTrialAlertBaseVariables() — variáveis compartilhadas por empresa
//      (company_name, days_remaining, trial_end_date, plan_name, cta_url)
//   2. withAdminName()                  — adiciona admin_name para email
//   3. getCompanyAdminUsers()           — busca admins ativos da empresa cliente
//
// Separação de responsabilidades:
//   - Este módulo MONTA variáveis — não renderiza, não envia, não loga
//   - renderTemplate() é responsabilidade de templateDb.js
//   - Envio é responsabilidade de resendClient.js / notificationSender.js
//
// Fonte de dados (service_role):
//   - companies → company_name
//   - company_subscriptions + plans → trial_end, plan_name
//   - company_users → admins ativos da empresa cliente
//   - auth.admin.getUserById → email e display_name do admin
//
// Para a V1, event_type suportado: 'trial_alert'
// Fase 2: adicionar resolvers para 'payment_failed', 'welcome', etc.
// =============================================================================

import { getSupabaseAdmin } from '../automation/supabaseAdmin.js'

// ── Constantes ────────────────────────────────────────────────────────────────

/**
 * URL fixa da tela de contratação de planos.
 * Usada como {{cta_url}} em todos os templates de trial alert.
 */
const CTA_URL = 'https://app.lovoocrm.com/settings?tab=planos-uso'

/**
 * Roles de admin que recebem notificações de trial alert por email.
 * system_admin e super_admin são administradores de plataforma — não da empresa cliente.
 */
const ADMIN_ROLES_FOR_NOTIFICATION = ['admin', 'super_admin', 'system_admin']

// ── Formatação de datas ───────────────────────────────────────────────────────

/**
 * Formata uma data para exibição amigável no padrão pt-BR (dd/mm/aaaa).
 * Tolerante a datas inválidas — retorna string vazia em caso de erro.
 *
 * @param {string|Date} date - Data a formatar
 * @returns {string} ex.: "25/05/2026"
 */
function formatTrialEndDate(date) {
  if (!date) return ''
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    }).format(d)
  } catch {
    return typeof date === 'string' ? date : ''
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TrialAlertBaseVariables
 * @property {string} company_name    - Nome da empresa cliente
 * @property {string} days_remaining  - Dias restantes (string do número)
 * @property {string} trial_end_date  - Data de expiração formatada pt-BR
 * @property {string} plan_name       - Nome do plano atual
 * @property {string} cta_url         - URL fixa da tela de planos
 */

/**
 * @typedef {TrialAlertBaseVariables & { admin_name: string }} TrialAlertVariables
 */

/**
 * @typedef {Object} AdminUser
 * @property {string} user_id      - UUID do usuário
 * @property {string} email        - Email do admin
 * @property {string} display_name - Nome de exibição (ou email como fallback)
 * @property {string} role         - Role na empresa
 */

/**
 * Resolve as variáveis base de um trial alert para uma empresa.
 * Variáveis base são compartilhadas por todos os destinatários da mesma empresa.
 *
 * Aceita o candidate retornado por get_trial_alert_candidates() como ponto de partida
 * (já contém company_id, company_name, trial_end, days_remaining) e enriquece
 * com plan_name (busca adicional no banco).
 *
 * Retorna null se a empresa ou o plano não forem encontrados.
 *
 * @param {Object} candidate - Linha retornada por get_trial_alert_candidates()
 * @param {string} candidate.company_id
 * @param {string} candidate.company_name
 * @param {string} candidate.trial_end     - ISO timestamp
 * @param {number} candidate.days_remaining
 * @returns {Promise<TrialAlertBaseVariables|null>}
 */
export async function resolveTrialAlertBaseVariables(candidate) {
  const { company_id, company_name, trial_end, days_remaining } = candidate

  if (!company_id || !company_name) return null

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    return null
  }

  // Busca plan_name via company_subscriptions + plans
  // A RPC já retornou a empresa em trialing — confirmamos o plan_id aqui
  const { data: sub } = await supabase
    .from('company_subscriptions')
    .select('plan_id')
    .eq('company_id', company_id)
    .maybeSingle()

  let plan_name = ''
  if (sub?.plan_id) {
    const { data: plan } = await supabase
      .from('plans')
      .select('name')
      .eq('id', sub.plan_id)
      .maybeSingle()
    plan_name = plan?.name ?? ''
  }

  return {
    company_name,
    days_remaining: String(days_remaining ?? 0),
    trial_end_date: formatTrialEndDate(trial_end),
    plan_name,
    cta_url: CTA_URL,
  }
}

/**
 * Adiciona admin_name às variáveis base para personalização de email.
 * Função pura (sem DB) — admin_name é resolvido fora desta função.
 *
 * Se admin_name estiver vazio, usa 'Administrador' como fallback amigável.
 *
 * @param {TrialAlertBaseVariables} baseVariables
 * @param {string} adminName - Nome de exibição do admin destinatário
 * @returns {TrialAlertVariables}
 */
export function withAdminName(baseVariables, adminName) {
  return {
    ...baseVariables,
    admin_name: adminName?.trim() || 'Administrador',
  }
}

/**
 * Busca admins ativos de uma empresa cliente para envio de email.
 *
 * Critérios:
 *   - company_users.is_active = true
 *   - role IN ('admin', 'super_admin', 'system_admin')
 *   - Apenas usuários com email no auth.users
 *
 * Retorna array vazio se nenhum admin encontrado ou em caso de erro.
 * O cron loga 'skipped' com error_message='no_admin_recipients' se o array estiver vazio.
 *
 * @param {string} companyId - UUID da empresa cliente (filha)
 * @returns {Promise<AdminUser[]>}
 */
export async function getCompanyAdminUsers(companyId) {
  if (!companyId) return []

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    return []
  }

  // 1. Busca user_ids dos admins ativos da empresa
  const { data: memberRows, error: memberError } = await supabase
    .from('company_users')
    .select('user_id, role')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .in('role', ADMIN_ROLES_FOR_NOTIFICATION)

  if (memberError || !memberRows?.length) return []

  // 2. Para cada user_id, busca email e display_name no auth.users
  const admins = []

  for (const member of memberRows) {
    try {
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(
        member.user_id
      )
      if (authError || !authUser?.user?.email) continue

      const email = authUser.user.email
      const metadata = authUser.user.user_metadata ?? {}
      const display_name =
        metadata.display_name?.trim() ||
        metadata.full_name?.trim() ||
        metadata.name?.trim() ||
        email

      admins.push({
        user_id: member.user_id,
        email,
        display_name,
        role: member.role,
      })
    } catch {
      // ignora erros individuais — continua para o próximo admin
    }
  }

  return admins
}

/**
 * Resolve o número de telefone principal da empresa cliente para WhatsApp.
 *
 * PRÉ-CONDIÇÃO BLOQUEANTE: confirmar nome real da coluna antes de ativar WA.
 * O campo `telefone_principal` é declarado no tipo TypeScript — confirmar no banco
 * via: SELECT column_name FROM information_schema.columns WHERE table_name = 'companies'
 *
 * Retorna null se:
 *   - Coluna ausente ou vazia na empresa
 *   - Telefone não passou na validação E.164
 *
 * @param {string} companyId - UUID da empresa cliente
 * @returns {Promise<string|null>} Número E.164 normalizado ou null
 */
export async function resolveCompanyWhatsAppPhone(companyId) {
  if (!companyId) return null

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    return null
  }

  const { data: company, error } = await supabase
    .from('companies')
    .select('telefone_principal')
    .eq('id', companyId)
    .maybeSingle()

  if (error || !company?.telefone_principal) return null

  const normalized = normalizeToE164(company.telefone_principal)
  return normalized
}

// ── Normalização E.164 ────────────────────────────────────────────────────────

/**
 * Tenta normalizar um número de telefone para o formato E.164.
 *
 * Regras de normalização (Brasil foco, extensível):
 *   1. Remove todos os caracteres não numéricos exceto '+'
 *   2. Se começar com '0' e tiver 10-11 dígitos: assume Brasil, adiciona '+55'
 *   3. Se não tiver '+' e tiver 10-13 dígitos: adiciona '+55' (assume Brasil)
 *   4. Valida comprimento mínimo (10 dígitos após o '+')
 *
 * Retorna null se o número não atender os critérios mínimos.
 * O cron loga 'skipped' com error_message='phone_invalid_format' se retornar null.
 *
 * @param {string} raw - Número de telefone como armazenado
 * @returns {string|null} Número E.164 (ex.: '+5511999999999') ou null
 */
export function normalizeToE164(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null

  // Remove tudo exceto dígitos e '+'
  let cleaned = raw.replace(/[^\d+]/g, '')

  if (!cleaned) return null

  // Se começa com '00' (discagem internacional), troca por '+'
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2)
  }

  // Se não tem '+', tenta inferir Brasil
  if (!cleaned.startsWith('+')) {
    // Remove '0' inicial (discagem nacional)
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.slice(1)
    }
    cleaned = '+55' + cleaned
  }

  // Valida: pelo menos '+' + 10 dígitos
  const digits = cleaned.slice(1) // sem o '+'
  if (!/^\d+$/.test(digits) || digits.length < 10 || digits.length > 15) {
    return null
  }

  return cleaned
}
