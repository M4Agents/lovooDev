// =============================================================================
// api/lib/agents/promptTemplate.js
//
// Template engine para prompt_config dos agentes conversacionais.
//
// RESPONSABILIDADE:
//   Validar, sanitizar e montar o agent.prompt a partir de um prompt_config
//   estruturado (JSONB) combinado com dados live da empresa.
//
// FUNÇÕES EXPORTADAS:
//   normalizeField(value)             → normaliza espaços e aspas
//   validatePromptConfig(config)      → valida schema do prompt_config
//   sanitizePromptConfig(config, mode)→ bloqueia padrões perigosos
//   buildPromptFromConfig(config, cd) → monta agent.prompt final
//
// DESIGN:
//   - prompt_config armazena APENAS intenção do usuário (5 campos)
//   - companyData é injetado em runtime (sempre fresco, nunca salvo no config)
//   - Seção A: identidade + objetivo + estilo + regras + notas (prompt_config)
//   - Seção B: dados da empresa (companies — não editável pelo usuário)
//
// SEGURANÇA:
//   - sanitizePromptConfig em modo 'save' lança erro ao detectar padrão proibido
//   - sanitizePromptConfig em modo 'mount' omite campo e loga [PROMPT:sanitize-block]
//   - Campos do cliente NUNCA controlam framing — apenas conteúdo das seções
//   - Seção B sempre ao final — identidade já estabelecida antes
//
// COMPATIBILIDADE:
//   - Agentes com prompt_config=null continuam usando agent.prompt raw sem mudança
//   - buildPromptFromConfig retorna null em falha → caller usa agent.prompt raw
// =============================================================================

// ── Schema dos campos do prompt_config ───────────────────────────────────────

const PROMPT_CONFIG_SCHEMA = {
  identity:            { required: true,  minLength: 20, maxLength: 500 },
  objective:           { required: true,  minLength: 20, maxLength: 300 },
  communication_style: { required: false, minLength: 10, maxLength: 300 },
  commercial_rules:    { required: false, minLength: 10, maxLength: 500 },
  custom_notes:        { required: false, minLength: 10, maxLength: 1500 },
};

const KNOWN_FIELDS = Object.keys(PROMPT_CONFIG_SCHEMA);

// ── Padrões bloqueados ────────────────────────────────────────────────────────
//
// Bloqueados apenas padrões genuinamente perigosos.
// Conteúdo legítimo de negócio ("Não informe preços", "Seja educado") é permitido.

const BLOCKED_PATTERNS = [
  // Script de fluxo sequencial com 3+ passos numerados
  { pattern: /(\d+\s*[.)]\s+\w.+\n){3,}/m,                            label: 'sequential_script'   },

  // Override de instruções do sistema
  { pattern: /ignore\s+(as\s+)?(instru[çc][õo]es|regras|sistema)/i,   label: 'system_override'     },
  { pattern: /desconsider(e|a|ar)/i,                                    label: 'system_override'     },
  { pattern: /esqueça\s+(tudo|o\s+que)/i,                               label: 'system_override'     },

  // Override de identidade
  { pattern: /você\s+(não\s+é|na\s+verdade|é\s+na\s+verdade)/i,        label: 'identity_override'   },
  { pattern: /seu\s+(verdadeiro\s+)?(papel|objetivo|propósito)\s+é/i,   label: 'identity_override'   },

  // Controle de modo do sistema
  { pattern: /ativ(e|ar)\s+o\s+modo/i,                                  label: 'mode_control'        },
  { pattern: /use\s+o\s+comportamento/i,                                 label: 'mode_control'        },
  { pattern: /entre\s+no\s+modo/i,                                       label: 'mode_control'        },

  // Injeção de variáveis do sistema via template
  { pattern: /\{\{.*?\}\}/,                                              label: 'template_injection'  },
];

// ── normalizeField ────────────────────────────────────────────────────────────

/**
 * Normaliza um campo de texto: remove espaços duplicados e normaliza aspas tipográficas.
 * Não altera conteúdo semântico.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeField(value) {
  if (typeof value !== 'string') return value;
  return value
    .trim()
    .replace(/\s{2,}/g, ' ')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'");
}

// ── validatePromptConfig ──────────────────────────────────────────────────────

/**
 * Valida o schema do prompt_config.
 *
 * Regras:
 *  - identity e objective são obrigatórios
 *  - campos presentes devem ser string com comprimento dentro dos limites
 *  - campos ausentes opcionais são ignorados (não causam erro)
 *  - campos desconhecidos são ignorados (forward-compat)
 *
 * @param {object} config
 * @returns {{ valid: boolean, errors?: Array<{field: string, reason: string}> }}
 */
export function validatePromptConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, errors: [{ field: '_root', reason: 'must_be_object' }] };
  }

  const errors = [];

  for (const [field, rules] of Object.entries(PROMPT_CONFIG_SCHEMA)) {
    const value = config[field];

    // Obrigatório ausente
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push({ field, reason: 'required' });
      continue;
    }

    // Opcional ausente — ok
    if (value === undefined || value === null) continue;

    // Tipo inválido
    if (typeof value !== 'string') {
      errors.push({ field, reason: 'must_be_string' });
      continue;
    }

    const len = value.trim().length;

    if (len < rules.minLength) {
      errors.push({ field, reason: 'too_short', min: rules.minLength, actual: len });
    }

    if (len > rules.maxLength) {
      errors.push({ field, reason: 'too_long', max: rules.maxLength, actual: len });
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── sanitizePromptConfig ──────────────────────────────────────────────────────

/**
 * Verifica padrões bloqueados em cada campo do prompt_config.
 *
 * Modos de operação:
 *  'save'  → lança { field, reason } ao encontrar o primeiro padrão bloqueado.
 *            Usado no endpoint de save: impede gravação de conteúdo inválido.
 *  'mount' → omite o campo afetado, loga [PROMPT:sanitize-block] e continua.
 *            Usado em buildPromptFromConfig: não quebra o runtime.
 *
 * @param {object} config
 * @param {'save'|'mount'} mode
 * @returns {object} config com campos inválidos removidos (modo mount)
 * @throws {{ field: string, reason: string }} em modo save ao detectar padrão
 */
export function sanitizePromptConfig(config, mode = 'mount') {
  const result = {};

  for (const field of KNOWN_FIELDS) {
    const value = config[field];

    if (typeof value !== 'string') {
      if (value !== undefined) result[field] = value;
      continue;
    }

    let blocked = null;
    for (const { pattern, label } of BLOCKED_PATTERNS) {
      if (pattern.test(value)) {
        blocked = { field, reason: label };
        break;
      }
    }

    if (blocked) {
      if (mode === 'save') throw blocked;
      console.warn('[PROMPT:sanitize-block]', blocked);
      continue; // omite campo em modo mount
    }

    result[field] = value;
  }

  return result;
}

// ── buildPromptFromConfig ─────────────────────────────────────────────────────

/**
 * Monta o agent.prompt a partir de prompt_config + dados live da empresa.
 *
 * Seção A — Intenção do usuário (de prompt_config):
 *   Identidade, objetivo, estilo de comunicação, regras comerciais, notas.
 *
 * Seção B — Contexto da empresa (de companyData, injetado pelo sistema):
 *   Nome, localização, contatos, horário, diferenciais, descrição.
 *   Nunca editável pelo usuário. Sempre fresco — lido em runtime, não salvo.
 *
 * Retorna null quando:
 *   - config é null/undefined → caller usa agent.prompt raw (backward-compat)
 *   - validação falha → idem
 *
 * @param {object|null} config      - prompt_config JSONB de lovoo_agents
 * @param {object|null} companyData - dados live de companies (fetchChildCompanyData)
 * @returns {string|null}
 */
export function buildPromptFromConfig(config, companyData = null) {
  if (!config) return null;

  // 1. Validar
  const validation = validatePromptConfig(config);
  if (!validation.valid) {
    console.warn('[PROMPT:config-invalid-fallback]', { errors: validation.errors });
    return null;
  }

  // 2. Sanitizar (modo mount — nunca lança, apenas omite campos problemáticos)
  const clean = sanitizePromptConfig(config, 'mount');

  // 3. Normalizar
  const norm = {};
  for (const field of KNOWN_FIELDS) {
    norm[field] = typeof clean[field] === 'string'
      ? normalizeField(clean[field])
      : clean[field];
  }

  // ── Seção A: Intenção do usuário ──────────────────────────────────────────
  const parts = [];

  parts.push(`Você é ${norm.identity}.`);
  parts.push(`\nObjetivo: ${norm.objective}`);

  if (norm.communication_style?.trim()) {
    parts.push(`\nEstilo de comunicação: ${norm.communication_style}`);
  }

  if (norm.commercial_rules?.trim()) {
    parts.push(`\nRegras comerciais: ${norm.commercial_rules}`);
  }

  if (norm.custom_notes?.trim()) {
    parts.push(`\nContexto adicional sobre o negócio: ${norm.custom_notes}`);
  }

  // ── Seção B: Contexto da empresa (dados live — não editável pelo usuário) ─
  if (companyData && typeof companyData === 'object') {
    const cd = companyData;
    const companyLines = [];

    // Identidade da empresa + localização
    const nome = cd.nome_fantasia || cd.name;
    const location = [cd.cidade, cd.estado].filter(Boolean).join('/');

    if (nome && location) {
      companyLines.push(`A empresa ${nome} atua em ${location}.`);
    } else if (nome) {
      companyLines.push(`Empresa: ${nome}.`);
    }

    if (cd.ramo_atividade) {
      companyLines.push(`Área de atuação: ${cd.ramo_atividade}.`);
    }

    // Endereço
    const endParts = [cd.logradouro, cd.numero, cd.bairro].filter(Boolean);
    if (endParts.length > 0) {
      const cepStr = cd.cep ? ` — CEP ${cd.cep}` : '';
      companyLines.push(`Endereço: ${endParts.join(', ')}${cepStr}.`);
    }

    // Contatos
    const contatos = [];
    if (cd.telefone_principal) contatos.push(cd.telefone_principal);
    if (cd.whatsapp && cd.whatsapp !== cd.telefone_principal) {
      contatos.push(`WhatsApp: ${cd.whatsapp}`);
    }
    if (cd.email_principal) contatos.push(cd.email_principal);
    if (cd.site_principal) contatos.push(cd.site_principal);
    if (contatos.length > 0) {
      companyLines.push(`Contato: ${contatos.join(' | ')}.`);
    }

    // Horário de atendimento — fonte preferencial: coluna direta horario_atendimento.
    // Fallback temporário: ai_profile.business_hours (compatibilidade com registros antigos).
    if (cd.horario_atendimento) {
      companyLines.push(`Horário de atendimento: ${cd.horario_atendimento}.`);
    } else {
      const profile = (cd.ai_profile && typeof cd.ai_profile === 'object') ? cd.ai_profile : {};
      if (profile.business_hours) {
        companyLines.push(`Horário de atendimento: ${profile.business_hours}.`);
      }
    }

    // Ponto de referência — coluna direta ponto_referencia
    if (cd.ponto_referencia) {
      companyLines.push(`Ponto de referência: ${cd.ponto_referencia}.`);
    }

    // Campos opcionais remanescentes do ai_profile
    const profile = (cd.ai_profile && typeof cd.ai_profile === 'object') ? cd.ai_profile : {};

    if (profile.descricao) {
      companyLines.push(String(profile.descricao).trim());
    }

    if (profile.diferenciais) {
      companyLines.push(`Diferenciais: ${profile.diferenciais}.`);
    }

    if (companyLines.length > 0) {
      parts.push('\n\n---\n' + companyLines.join('\n'));
    }
  }

  const result = parts.join('').trim();

  console.log('[PROMPT:build]', {
    has_prompt_config:        true,
    has_company_data:         Boolean(companyData),
    prompt_length:            result.length,
    has_communication_style:  Boolean(norm.communication_style?.trim()),
    has_commercial_rules:     Boolean(norm.commercial_rules?.trim()),
    has_custom_notes:         Boolean(norm.custom_notes?.trim()),
    has_company_section:      companyData ? true : false,
  });

  return result;
}
