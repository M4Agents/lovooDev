// =============================================================================
// api/lib/utils/policyVariables.js
//
// Utilitário de variáveis dinâmicas para prompts de agentes e diretrizes de IA.
//
// Responsabilidade:
//   1. Construir mapas de variáveis a partir de dados de empresa, lead e oportunidade
//   2. Aplicar substituição {{variavel}} no conteúdo de policies e prompts
//
// Sintaxe: {{nome_variavel}} — regex \w+ (letras, números, _)
//
// GRUPOS DE VARIÁVEIS:
//   Runtime  → data_atual, hora_atual, data_hora_atual
//   Empresa  → nome_empresa, nome_fantasia, telefone, email, site, cidade,
//              estado, cep, logradouro, bairro, numero, pais, idioma,
//              fuso_horario, moeda, ramo_atividade
//   Lead     → lead_nome, lead_email, lead_telefone, lead_empresa, lead_cargo,
//              lead_cidade, lead_estado, lead_cep, lead_endereco, lead_bairro,
//              lead_numero, lead_origem
//   Oportunidade → oportunidade_titulo, oportunidade_valor, oportunidade_etapa,
//                  oportunidade_status, oportunidade_probabilidade, oportunidade_previsao
//   Campos personalizados → cp_<field_name>  (prefixo cp_ evita colisões)
//
// SEGURANÇA:
//   - Variáveis da empresa sempre resolvem para a empresa que está EXECUTANDO o agente
//   - Nunca resolvem para a empresa-pai (exceto quando a própria pai é a executora)
//   - Tokens sem correspondência são mantidos literalmente {{token}}
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
    if (pais.toLowerCase().includes('brasil') || pais.toLowerCase().includes('brazil')) return 'Português (pt-BR)';
    if (pais.toLowerCase().includes('portugal')) return 'Português (pt-PT)';
    if (pais.toLowerCase().includes('spain') || pais.toLowerCase().includes('espanha')) return 'Español (es-ES)';
    if (pais.toLowerCase().includes('united states') || pais.toLowerCase().includes('estados unidos')) return 'English (en-US)';
  }
  return 'Português (pt-BR)';
}

// ── Formatação de data/hora no fuso da empresa ────────────────────────────────

function formatDateTime(date, timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
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
      timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatTime(date, timezone) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

// ── Variáveis de empresa ──────────────────────────────────────────────────────

/**
 * Constrói variáveis de empresa (Runtime + dados da empresa executora).
 * Aceita qualquer empresa — pai ou filha. A distinção é feita no contextBuilder.
 *
 * @param {object} company - Linha da tabela companies
 * @returns {Record<string, string>}
 */
export function buildCompanyVariables(company) {
  const now      = new Date();
  const timezone = company?.timezone ?? 'America/Sao_Paulo';

  return {
    // Runtime (fuso horário da empresa executora)
    data_atual:      formatDate(now, timezone),
    hora_atual:      formatTime(now, timezone),
    data_hora_atual: formatDateTime(now, timezone),

    // Identidade
    nome_empresa:   company?.name          ?? '',
    nome_fantasia:  company?.nome_fantasia ?? company?.name ?? '',
    idioma:         deriveLanguage(company?.country_code, company?.pais),
    fuso_horario:   timezone,
    moeda:          company?.default_currency ?? 'BRL',

    // Localização
    pais:       company?.pais      ?? '',
    estado:     company?.estado    ?? '',
    cidade:     company?.cidade    ?? '',
    cep:        company?.cep       ?? '',
    logradouro: company?.logradouro ?? '',
    bairro:     company?.bairro    ?? '',
    numero:     company?.numero    ?? '',

    // Contato
    telefone:       company?.telefone_principal ?? '',
    email:          company?.email_principal    ?? '',
    site:           company?.site_principal     ?? '',
    ramo_atividade: company?.ramo_atividade     ?? '',
  };
}

// Alias de compatibilidade (nome antigo usado no contextBuilder v1)
export const buildPolicyVariables = buildCompanyVariables;

// ── Variáveis de Lead / Contato ───────────────────────────────────────────────

/**
 * Constrói variáveis do lead associado à conversa.
 * Retorna mapa com strings vazias quando lead é null.
 *
 * @param {object|null} lead - Dados do lead (da tabela leads) ou null
 * @returns {Record<string, string>}
 */
export function buildLeadVariables(lead) {
  const empty = {
    lead_nome: '', lead_email: '', lead_telefone: '', lead_empresa: '',
    lead_cargo: '', lead_cidade: '', lead_estado: '', lead_cep: '',
    lead_endereco: '', lead_bairro: '', lead_numero: '', lead_origem: '',
  };
  if (!lead) return empty;
  return {
    lead_nome:     lead.name         ?? '',
    lead_email:    lead.email        ?? '',
    lead_telefone: lead.phone        ?? '',
    lead_empresa:  lead.company_name ?? '',
    lead_cargo:    lead.cargo        ?? '',
    lead_cidade:   lead.cidade       ?? '',
    lead_estado:   lead.estado       ?? '',
    lead_cep:      lead.cep          ?? '',
    lead_endereco: lead.endereco     ?? '',
    lead_bairro:   lead.bairro       ?? '',
    lead_numero:   lead.numero       ?? '',
    lead_origem:   lead.origin       ?? '',
  };
}

// ── Variáveis de Oportunidade ─────────────────────────────────────────────────

const STATUS_LABELS = { open: 'Aberta', won: 'Ganha', lost: 'Perdida' };

/**
 * Constrói variáveis da oportunidade aberta vinculada ao lead.
 * Retorna mapa com strings vazias quando oportunidade é null.
 *
 * @param {object|null} opp - Dados da oportunidade (com stage_name resolvido) ou null
 * @returns {Record<string, string>}
 */
export function buildOpportunityVariables(opp) {
  const empty = {
    oportunidade_titulo: '', oportunidade_valor: '', oportunidade_etapa: '',
    oportunidade_status: '', oportunidade_probabilidade: '', oportunidade_previsao: '',
  };
  if (!opp) return empty;

  let valorFormatado = '';
  if (opp.value != null) {
    try {
      valorFormatado = new Intl.NumberFormat('pt-BR', {
        style: 'currency', currency: opp.currency ?? 'BRL'
      }).format(opp.value);
    } catch {
      valorFormatado = String(opp.value);
    }
  }

  let previsao = '';
  if (opp.expected_close_date) {
    try {
      previsao = new Date(opp.expected_close_date + 'T00:00:00')
        .toLocaleDateString('pt-BR');
    } catch {
      previsao = opp.expected_close_date;
    }
  }

  return {
    oportunidade_titulo:        opp.title      ?? '',
    oportunidade_valor:         valorFormatado,
    oportunidade_etapa:         opp.stage_name ?? '',
    oportunidade_status:        STATUS_LABELS[opp.status] ?? opp.status ?? '',
    oportunidade_probabilidade: opp.probability != null ? `${opp.probability}%` : '',
    oportunidade_previsao:      previsao,
  };
}

// ── Variáveis de Campos Personalizados ───────────────────────────────────────

/**
 * Constrói variáveis de campos personalizados do lead (prefixo cp_).
 * O prefixo evita colisão com variáveis padrão.
 *
 * @param {Array} customValues - Array de {value, lead_custom_fields: {field_name}}
 * @returns {Record<string, string>}
 */
export function buildCustomFieldVariables(customValues) {
  if (!Array.isArray(customValues)) return {};
  const vars = {};
  for (const cv of customValues) {
    const fieldName = cv?.lead_custom_fields?.field_name;
    if (fieldName && typeof fieldName === 'string') {
      vars[`cp_${fieldName}`] = cv.value ?? '';
    }
  }
  return vars;
}

// ── Variáveis de Produto em Foco ──────────────────────────────────────────────

const AVAILABILITY_LABELS_VARS = {
  available:    'disponível',
  unavailable:  'indisponível',
  on_demand:    'sob consulta',
  discontinued: 'descontinuado',
};

const STOCK_LABELS_VARS = {
  in_stock:     'em estoque',
  out_of_stock: 'sem estoque',
  low_stock:    'estoque baixo',
};

/**
 * Constrói variáveis do produto/serviço identificado como item de interesse.
 * Retorna strings vazias quando item é null (sem match).
 *
 * O preço respeita a policy de exibição: se default_price for null
 * (removido pelo ContextBuilder via applyCapabilityFilters), a variável fica vazia.
 *
 * @param {object|null} item - Item do catálogo (produto ou serviço) ou null
 * @returns {Record<string, string>}
 */
export function buildProductVariables(item) {
  const empty = {
    produto_nome:      '',
    produto_preco:     '',
    produto_descricao: '',
    produto_categoria: '',
    produto_status:    '',
    produto_estoque:   '',
  };

  if (!item) return empty;

  let preco = '';
  if (item.default_price != null) {
    try {
      preco = Number(item.default_price).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL'
      });
    } catch {
      preco = String(item.default_price);
    }
  }

  return {
    produto_nome:      item.name ?? '',
    produto_preco:     preco,
    produto_descricao: item.description ?? '',
    produto_categoria: item.catalog_categories?.name ?? '',
    produto_status:    AVAILABILITY_LABELS_VARS[item.availability_status] ?? item.availability_status ?? '',
    produto_estoque:   STOCK_LABELS_VARS[item.stock_status] ?? '',
  };
}

// ── Mapa combinado ────────────────────────────────────────────────────────────

/**
 * Combina todos os grupos de variáveis em um único mapa.
 *
 * @param {object|null} company        - Empresa executora
 * @param {object|null} lead           - Lead da conversa (com campo custom_values)
 * @param {object|null} opportunity    - Oportunidade ativa (com stage_name)
 * @param {Array}       customValues   - lead_custom_values do lead
 * @param {object|null} itemOfInterest - Item de catálogo identificado (opcional)
 * @returns {Record<string, string>}
 */
export function buildAllVariables(company, lead, opportunity, customValues, itemOfInterest) {
  return {
    ...buildCompanyVariables(company),
    ...buildLeadVariables(lead),
    ...buildOpportunityVariables(opportunity),
    ...buildCustomFieldVariables(customValues ?? []),
    ...buildProductVariables(itemOfInterest ?? null),
  };
}

// ── Substituição de variáveis ─────────────────────────────────────────────────

/**
 * Substitui tokens {{variavel}} no texto pelos valores do mapa.
 * Tokens sem correspondência são mantidos literalmente.
 *
 * @param {string} content   - Texto com variáveis
 * @param {Record<string, string>} variables - Mapa chave → valor
 * @returns {string}
 */
export function applyPolicyVariables(content, variables) {
  if (!content || !variables || Object.keys(variables).length === 0) return content;
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match);
}

// ── Catálogo estático (para UI — espelhado em src/lib/promptVariables.ts) ─────

export const POLICY_VARIABLES_CATALOG = [
  // Runtime
  { group: 'Runtime', variable: '{{data_atual}}',      description: 'Data atual no fuso horário da empresa',   example: '08/04/2026' },
  { group: 'Runtime', variable: '{{hora_atual}}',      description: 'Hora atual no fuso horário da empresa',   example: '14:30' },
  { group: 'Runtime', variable: '{{data_hora_atual}}', description: 'Data e hora atual completa',              example: '08/04/2026 14:30' },
  // Empresa
  { group: 'Empresa', variable: '{{nome_empresa}}',    description: 'Nome oficial da empresa',                 example: 'Lovoo Ltda' },
  { group: 'Empresa', variable: '{{nome_fantasia}}',   description: 'Nome fantasia',                           example: 'Lovoo CRM' },
  { group: 'Empresa', variable: '{{telefone}}',        description: 'Telefone principal',                      example: '+55 11 99999-9999' },
  { group: 'Empresa', variable: '{{email}}',           description: 'E-mail principal',                        example: 'contato@empresa.com' },
  { group: 'Empresa', variable: '{{site}}',            description: 'Site principal',                          example: 'https://empresa.com' },
  { group: 'Empresa', variable: '{{cidade}}',          description: 'Cidade',                                  example: 'São Paulo' },
  { group: 'Empresa', variable: '{{estado}}',          description: 'Estado',                                  example: 'SP' },
  { group: 'Empresa', variable: '{{cep}}',             description: 'CEP',                                     example: '01310-100' },
  { group: 'Empresa', variable: '{{logradouro}}',      description: 'Logradouro (rua/avenida)',                 example: 'Av. Paulista, 1000' },
  { group: 'Empresa', variable: '{{bairro}}',          description: 'Bairro',                                  example: 'Bela Vista' },
  { group: 'Empresa', variable: '{{pais}}',            description: 'País',                                    example: 'Brasil' },
  { group: 'Empresa', variable: '{{idioma}}',          description: 'Idioma derivado do país',                 example: 'Português (pt-BR)' },
  { group: 'Empresa', variable: '{{fuso_horario}}',    description: 'Fuso horário configurado',                example: 'America/Sao_Paulo' },
  { group: 'Empresa', variable: '{{moeda}}',           description: 'Moeda padrão',                            example: 'BRL' },
  { group: 'Empresa', variable: '{{ramo_atividade}}',  description: 'Ramo de atividade',                       example: 'Tecnologia' },
  // Lead
  { group: 'Lead', variable: '{{lead_nome}}',          description: 'Nome do lead/contato',                    example: 'João Silva' },
  { group: 'Lead', variable: '{{lead_email}}',         description: 'E-mail do lead',                          example: 'joao@email.com' },
  { group: 'Lead', variable: '{{lead_telefone}}',      description: 'Telefone do lead',                        example: '+55 11 98765-4321' },
  { group: 'Lead', variable: '{{lead_empresa}}',       description: 'Empresa do lead',                         example: 'Empresa XYZ' },
  { group: 'Lead', variable: '{{lead_cargo}}',         description: 'Cargo do lead',                           example: 'Gerente de Compras' },
  { group: 'Lead', variable: '{{lead_cidade}}',        description: 'Cidade do lead',                          example: 'Campinas' },
  { group: 'Lead', variable: '{{lead_estado}}',        description: 'Estado do lead',                          example: 'SP' },
  { group: 'Lead', variable: '{{lead_cep}}',           description: 'CEP do lead',                             example: '13010-100' },
  { group: 'Lead', variable: '{{lead_endereco}}',      description: 'Endereço do lead',                        example: 'Rua das Flores, 42' },
  { group: 'Lead', variable: '{{lead_bairro}}',        description: 'Bairro do lead',                          example: 'Centro' },
  { group: 'Lead', variable: '{{lead_origem}}',        description: 'Origem do lead',                          example: 'WhatsApp' },
  // Oportunidade
  { group: 'Oportunidade', variable: '{{oportunidade_titulo}}',        description: 'Título da oportunidade aberta',    example: 'Proposta Premium' },
  { group: 'Oportunidade', variable: '{{oportunidade_valor}}',         description: 'Valor da oportunidade',            example: 'R$ 5.000,00' },
  { group: 'Oportunidade', variable: '{{oportunidade_etapa}}',         description: 'Etapa atual no funil',             example: 'Proposta Enviada' },
  { group: 'Oportunidade', variable: '{{oportunidade_status}}',        description: 'Status (Aberta/Ganha/Perdida)',     example: 'Aberta' },
  { group: 'Oportunidade', variable: '{{oportunidade_probabilidade}}', description: 'Probabilidade de fechamento',       example: '75%' },
  { group: 'Oportunidade', variable: '{{oportunidade_previsao}}',      description: 'Previsão de fechamento',           example: '30/05/2026' },
];
