// =============================================================================
// api/lib/notifications/templateDb.js
//
// Leitura de templates, validação de variáveis e renderização textual.
//
// Responsabilidades:
//   1. ALLOWED_VARIABLES  — catálogo centralizado de variáveis por event_type
//   2. fetchTemplate()    — busca template ativo no banco (service_role)
//   3. validateTemplateVariables() — valida {{vars}} antes do save (PUT endpoint)
//   4. renderTemplate()   — substituição server-side, função pura, sem DB
//
// Regras:
//   - Sem fallback hardcoded: template ausente retorna null → cron loga 'skipped'
//   - Variáveis não mapeadas são mantidas literais no render (tolerante em runtime)
//   - Validação de variáveis é ESTRITA no save (endpoint PUT)
//   - Sem side effects em qualquer função
// =============================================================================

import { getSupabaseAdmin } from '../automation/supabaseAdmin.js'

// ── Catálogo centralizado de variáveis permitidas por event_type ──────────────

/**
 * Fonte única de verdade: variáveis válidas por event_type.
 *
 * Usado em:
 *   - validateTemplateVariables() → valida body no save do template
 *   - variablesResolver.js        → constrói o objeto de variáveis para render
 *   - Frontend (TemplateEditor)   → lista variáveis disponíveis por evento
 *
 * Para adicionar novo event_type: inserir nova chave sem alterar as existentes.
 *
 * @type {Record<string, string[]>}
 */
export const ALLOWED_VARIABLES = {
  trial_alert: [
    'company_name',    // nome da empresa cliente
    'days_remaining',  // dias restantes de trial (inteiro)
    'trial_end_date',  // data de expiração formatada pt-BR (ex.: "25/05/2026")
    'plan_name',       // nome do plano atual da empresa
    'cta_url',         // URL fixa para a tela de planos
    'admin_name',      // nome do admin destinatário (para email)
  ],
  // Fase 2 — adicionar quando os handlers de billing forem criados:
  // payment_failed:   ['company_name', 'invoice_amount', 'invoice_due_date', 'cta_url', 'admin_name'],
  // payment_approved: ['company_name', 'invoice_amount', 'plan_name', 'cta_url', 'admin_name'],
  // welcome:          ['company_name', 'plan_name', 'cta_url', 'admin_name'],
}

// ── Validação de variáveis (usada no endpoint PUT /api/notifications/templates/:id) ──

/**
 * Extrai todas as variáveis {{...}} de um texto.
 * Regex: \w+ — apenas letras, números e underscore (sem espaços, sem hífen).
 *
 * @param {string} text
 * @returns {string[]} Lista de nomes de variáveis sem chaves
 */
export function extractVariables(text) {
  if (typeof text !== 'string') return []
  const matches = text.match(/\{\{(\w+)\}\}/g) ?? []
  return matches.map(m => m.slice(2, -2))
}

/**
 * Valida que todas as variáveis {{...}} do body pertencem ao catálogo
 * permitido para o event_type informado.
 *
 * Usada no endpoint PUT antes de salvar o template.
 * NÃO usada no cron (runtime é tolerante, mantém literal se não encontrar).
 *
 * @param {string} body       - Corpo do template (texto puro)
 * @param {string} eventType  - Tipo do evento (ex.: 'trial_alert')
 * @throws {Error} Se houver variável não permitida ou event_type desconhecido
 */
export function validateTemplateVariables(body, eventType) {
  const allowed = ALLOWED_VARIABLES[eventType]
  if (!allowed) {
    throw new Error(
      `[templateDb] event_type desconhecido: "${eventType}". ` +
      `Valores aceitos: ${Object.keys(ALLOWED_VARIABLES).join(', ')}`
    )
  }

  const found = extractVariables(body)
  if (found.length === 0) return // sem variáveis é válido

  const allowedSet = new Set(allowed)
  const invalid = found.filter(v => !allowedSet.has(v))

  if (invalid.length > 0) {
    throw new Error(
      `[templateDb] Variáveis não permitidas para "${eventType}": ` +
      `{{${invalid.join('}}, {')}}}. ` +
      `Variáveis aceitas: ${allowed.map(v => `{{${v}}}`).join(', ')}`
    )
  }
}

// ── Render textual (função pura) ──────────────────────────────────────────────

/**
 * Substitui {{variavel}} no template pelos valores do mapa de variáveis.
 *
 * Comportamento:
 *   - Se a variável existir em `variables`: substitui pelo valor (convertido para string)
 *   - Se a variável NÃO existir: mantém o placeholder literal {{variavel}}
 *   - Sem HTML, sem lógica condicional, sem side effects
 *
 * O HTML do email é responsabilidade do emailRenderer.js (Etapa B), não aqui.
 * Esta função processa apenas o conteúdo de notification_templates.body.
 *
 * @param {string} body         - Texto com {{variáveis}}
 * @param {Record<string, unknown>} variables - Mapa chave → valor
 * @returns {string} Texto com variáveis substituídas
 */
export function renderTemplate(body, variables) {
  if (typeof body !== 'string' || !body) return ''
  if (!variables || typeof variables !== 'object') return body

  return body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in variables && variables[key] != null) {
      return String(variables[key])
    }
    return match // mantém {{variavel}} literal se não encontrar
  })
}

// ── Busca de template no banco ────────────────────────────────────────────────

/**
 * @typedef {Object} NotificationTemplate
 * @property {string}      id
 * @property {string}      company_id
 * @property {string}      event_type
 * @property {string|null} event_subtype
 * @property {string}      channel
 * @property {string}      name
 * @property {string|null} subject      - Assunto do email; null para WhatsApp
 * @property {string}      body         - Texto puro com {{variáveis}}
 * @property {boolean}     is_active
 */

/**
 * Busca template ativo para um evento/canal específico.
 * Usa service_role — chamada pelo cron sem contexto de usuário.
 *
 * Retorna null (não lança) quando:
 *   - Template não existe no banco
 *   - Template existe mas is_active=false
 *   - Erro de DB
 *
 * O cron loga 'skipped' com error_message='template_not_found' quando retorna null.
 * O dedup NÃO recebe INSERT nesse caso (permite nova tentativa ao criar o template).
 *
 * @param {Object} params
 * @param {string}      params.companyId     - UUID da empresa pai (PARENT_COMPANY_ID)
 * @param {string}      params.eventType     - ex.: 'trial_alert'
 * @param {string|null} params.eventSubtype  - ex.: '3d', '1d', null
 * @param {'email'|'whatsapp'} params.channel
 * @returns {Promise<NotificationTemplate|null>}
 */
export async function fetchTemplate({ companyId, eventType, eventSubtype, channel }) {
  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch {
    return null
  }

  const query = supabase
    .from('notification_templates')
    .select('id, company_id, event_type, event_subtype, channel, name, subject, body, is_active')
    .eq('company_id', companyId)
    .eq('event_type', eventType)
    .eq('channel', channel)
    .eq('is_active', true)

  // event_subtype pode ser null (eventos sem subtipo, ex.: 'welcome')
  if (eventSubtype != null) {
    query.eq('event_subtype', eventSubtype)
  } else {
    query.is('event_subtype', null)
  }

  const { data, error } = await query.maybeSingle()

  if (error || !data) return null

  return /** @type {NotificationTemplate} */ (data)
}
