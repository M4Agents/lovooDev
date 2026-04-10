// =============================================================================
// api/lib/utils/policyVariables.js
//
// Utilitário de substituição de variáveis nas diretrizes globais de IA.
//
// Responsabilidade:
//   1. Construir o mapa de variáveis a partir dos dados da empresa-pai + runtime
//   2. Aplicar substituição {{variavel}} no conteúdo da policy
//
// Sintaxe: {{nome_variavel}} — compatível com substituteVariables() do runner.ts
//
// VARIÁVEIS DISPONÍVEIS (documentadas também no AiGovernancePanel.tsx):
//
//   Runtime (geradas a cada execução):
//   - {{data_atual}}          → data atual no fuso da empresa       (ex: 08/04/2026)
//   - {{hora_atual}}          → hora atual no fuso da empresa       (ex: 14:30)
//   - {{data_hora_atual}}     → data e hora completa                (ex: 08/04/2026 14:30)
//
//   Empresa-pai (lidas do banco):
//   - {{nome_empresa}}        → companies.name                      (ex: M4 Digital)
//   - {{nome_fantasia}}       → companies.nome_fantasia ou name     (ex: Lovoo CRM)
//   - {{fuso_horario}}        → companies.timezone                  (ex: America/Sao_Paulo)
//   - {{moeda}}               → companies.default_currency           (ex: BRL)
//   - {{pais}}                → companies.pais                      (ex: Brasil)
//   - {{cidade}}              → companies.cidade                    (ex: São Paulo)
//   - {{idioma}}              → derivado de country_code/pais       (ex: Português (pt-BR))
//   - {{telefone}}            → companies.telefone_principal        (ex: +55 11 99999-9999)
//   - {{email}}               → companies.email_principal           (ex: contato@empresa.com)
//   - {{site}}                → companies.site_principal            (ex: https://empresa.com)
//   - {{ramo_atividade}}      → companies.ramo_atividade            (ex: Tecnologia)
// =============================================================================

// ── Mapa de idioma por country_code ou pais ───────────────────────────────────

const LANGUAGE_MAP = {
  BR: 'Português (pt-BR)',
  PT: 'Português (pt-PT)',
  US: 'English (en-US)',
  GB: 'English (en-GB)',
  ES: 'Español (es-ES)',
  AR: 'Español (es-AR)',
  MX: 'Español (es-MX)',
  CO: 'Español (es-CO)',
  FR: 'Français (fr-FR)',
  DE: 'Deutsch (de-DE)',
  IT: 'Italiano (it-IT)',
};

function deriveLanguage(countryCode, pais) {
  if (countryCode && LANGUAGE_MAP[String(countryCode).toUpperCase()]) {
    return LANGUAGE_MAP[String(countryCode).toUpperCase()];
  }
  if (typeof pais === 'string') {
    if (pais.toLowerCase().includes('brasil') || pais.toLowerCase().includes('brazil')) {
      return 'Português (pt-BR)';
    }
    if (pais.toLowerCase().includes('portugal')) return 'Português (pt-PT)';
    if (pais.toLowerCase().includes('spain') || pais.toLowerCase().includes('espanha')) return 'Español (es-ES)';
    if (pais.toLowerCase().includes('united states') || pais.toLowerCase().includes('estados unidos')) return 'English (en-US)';
  }
  return 'Português (pt-BR)'; // padrão
}

// ── Formatação de data/hora no fuso da empresa ─────────────────────────────────

function formatDateTime(date, timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false
    });
    // Formata como "08/04/2026 14:30"
    const parts = fmt.formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value ?? '';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function formatDate(date, timezone) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric'
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatTime(date, timezone) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

// ── Build de variáveis ────────────────────────────────────────────────────────

/**
 * Constrói o mapa de variáveis para substituição na policy global.
 *
 * @param {object} parentCompany - Dados da empresa-pai (fields from companies table)
 * @returns {Record<string, string>} Mapa variavel → valor resolvido
 */
export function buildPolicyVariables(parentCompany) {
  const now      = new Date();
  const timezone = parentCompany?.timezone ?? 'America/Sao_Paulo';

  return {
    // Runtime
    data_atual:      formatDate(now, timezone),
    hora_atual:      formatTime(now, timezone),
    data_hora_atual: formatDateTime(now, timezone),

    // Empresa-pai
    nome_empresa:    parentCompany?.name          ?? '',
    nome_fantasia:   parentCompany?.nome_fantasia ?? parentCompany?.name ?? '',
    fuso_horario:    timezone,
    moeda:           parentCompany?.default_currency ?? 'BRL',
    pais:            parentCompany?.pais            ?? 'Brasil',
    cidade:          parentCompany?.cidade          ?? '',
    idioma:          deriveLanguage(parentCompany?.country_code, parentCompany?.pais),
    telefone:        parentCompany?.telefone_principal ?? '',
    email:           parentCompany?.email_principal    ?? '',
    site:            parentCompany?.site_principal     ?? '',
    ramo_atividade:  parentCompany?.ramo_atividade     ?? '',
  };
}

// ── Substituição de variáveis ─────────────────────────────────────────────────

/**
 * Substitui tokens {{variavel}} no texto pelos valores do mapa.
 * Tokens sem correspondência são mantidos literalmente.
 *
 * @param {string} content - Texto com variáveis no formato {{chave}}
 * @param {Record<string, string>} variables - Mapa chave → valor
 * @returns {string} Texto com variáveis substituídas
 */
export function applyPolicyVariables(content, variables) {
  if (!content || !variables || Object.keys(variables).length === 0) return content;
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match);
}

// ── Catálogo de variáveis disponíveis (para exibição na UI) ──────────────────

/**
 * Lista completa de variáveis disponíveis com descrição e exemplo.
 * Exportada para uso no AiGovernancePanel.tsx.
 */
export const POLICY_VARIABLES_CATALOG = [
  // Runtime
  { group: 'Runtime', variable: '{{data_atual}}',      description: 'Data atual no fuso horário da empresa',        example: '08/04/2026' },
  { group: 'Runtime', variable: '{{hora_atual}}',      description: 'Hora atual no fuso horário da empresa',        example: '14:30' },
  { group: 'Runtime', variable: '{{data_hora_atual}}', description: 'Data e hora atual completa',                   example: '08/04/2026 14:30' },
  // Empresa-pai
  { group: 'Empresa', variable: '{{nome_empresa}}',    description: 'Nome oficial da empresa',                      example: 'M4 Digital' },
  { group: 'Empresa', variable: '{{nome_fantasia}}',   description: 'Nome fantasia da empresa',                     example: 'Lovoo CRM' },
  { group: 'Empresa', variable: '{{idioma}}',          description: 'Idioma derivado do país configurado',          example: 'Português (pt-BR)' },
  { group: 'Empresa', variable: '{{fuso_horario}}',    description: 'Fuso horário configurado',                     example: 'America/Sao_Paulo' },
  { group: 'Empresa', variable: '{{moeda}}',           description: 'Moeda padrão',                                 example: 'BRL' },
  { group: 'Empresa', variable: '{{pais}}',            description: 'País da empresa',                              example: 'Brasil' },
  { group: 'Empresa', variable: '{{cidade}}',          description: 'Cidade da empresa',                            example: 'São Paulo' },
  { group: 'Empresa', variable: '{{telefone}}',        description: 'Telefone principal',                           example: '+55 11 99999-9999' },
  { group: 'Empresa', variable: '{{email}}',           description: 'E-mail principal',                             example: 'contato@empresa.com' },
  { group: 'Empresa', variable: '{{site}}',            description: 'Site principal',                               example: 'https://empresa.com' },
  { group: 'Empresa', variable: '{{ramo_atividade}}',  description: 'Ramo de atividade',                            example: 'Tecnologia' },
];
