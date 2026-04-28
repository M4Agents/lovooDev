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
//   sanitizeLegacyOperationalData(c) → remove dados operacionais congelados (on-read)
//   buildPromptFromConfig(config, cd) → monta agent.prompt final
//
// DESIGN:
//   - prompt_config armazena APENAS comportamento (5 campos)
//   - companyData é injetado em runtime (sempre fresco, nunca salvo no config)
//   - Seção A: identidade + objetivo + estilo + regras + notas (prompt_config)
//   - Seção B: dados da empresa (companies — fonte de verdade, não editável pelo usuário)
//
// SEPARAÇÃO DE RESPONSABILIDADE (REGRA DE OURO):
//   - prompt_config → comportamento, tom, estratégia, regras comerciais
//   - companyData   → telefone, e-mail, site, horário, endereço, descrição (runtime)
//   - extra_context → catálogo, ai_notes, disponibilidade, lead (runtime)
//
// SEGURANÇA:
//   - sanitizePromptConfig em modo 'save' lança erro ao detectar padrão proibido
//   - sanitizePromptConfig em modo 'mount' omite campo e loga [PROMPT:sanitize-block]
//   - sanitizeLegacyOperationalData remove dados operacionais de configs antigos on-read
//   - Campos do cliente NUNCA controlam framing — apenas conteúdo das seções
//   - Seção B sempre ao final e precedida de instrução de fonte de verdade
//
// COMPATIBILIDADE:
//   - Agentes com prompt_config=null continuam usando agent.prompt raw sem mudança
//   - buildPromptFromConfig retorna null em falha → caller usa agent.prompt raw
// =============================================================================

// ── Schema dos campos do prompt_config ───────────────────────────────────────

const PROMPT_CONFIG_SCHEMA = {
  identity:             { required: true,  minLength: 20, maxLength: 800  },
  objective:            { required: true,  minLength: 20, maxLength: 600  },
  communication_style:  { required: false, minLength: 10, maxLength: 500  },
  commercial_rules:     { required: false, minLength: 10, maxLength: 800  },
  custom_notes:         { required: false, minLength: 10, maxLength: 1500 },
  tool_instructions:    { required: false, minLength: 10, maxLength: 3000 },
};

const KNOWN_FIELDS = Object.keys(PROMPT_CONFIG_SCHEMA);

// ── Padrões bloqueados ────────────────────────────────────────────────────────
//
// Bloqueados apenas padrões genuinamente perigosos.
// Conteúdo legítimo de negócio ("Não informe preços", "Seja educado") é permitido.

const BLOCKED_PATTERNS = [
  // Script de fluxo sequencial com 5+ passos numerados (3 era muito restritivo para conteúdo legítimo gerado por LLM)
  { pattern: /(\d+\s*[.)]\s+\w.+\n){5,}/m,                            label: 'sequential_script'   },

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

    // Opcional ausente ou vazio — ok (string vazia equivale a não fornecido)
    if (value === undefined || value === null || value === '') continue;

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

// ── sanitizeLegacyOperationalData ────────────────────────────────────────────

/**
 * Remove dados operacionais que podem ter sido congelados em prompt_config de
 * agentes criados antes da correção arquitetural (versões anteriores do generate.js
 * enviavam telefone, e-mail, site e horário ao LLM que os embutia nos campos).
 *
 * Aplicado em modo on-read (nunca modifica o banco): o config retornado é
 * temporário, usado apenas para montar o prompt final. O valor persistido
 * no banco não é alterado.
 *
 * Padrões removidos por regex — conservadores para evitar falsos positivos:
 *   - Telefones: (xx) xxxxx-xxxx, +55 11 99999-9999, etc.
 *   - E-mails: word@domain.ext
 *   - URLs: http(s)://... e domínios com .com/.br/.net/.io
 *   - Horários isolados: "9h às 18h", "09:00 às 18:00", "segunda a sexta"
 *
 * Cada match é substituído por string vazia. Espaços duplos resultantes são
 * compactados. Campos que ficarem vazios após a limpeza são removidos.
 *
 * @param {object} config - prompt_config original (não é mutado)
 * @returns {object} config limpo (novo objeto)
 */
export function sanitizeLegacyOperationalData(config) {
  if (!config || typeof config !== 'object') return config;

  const OPERATIONAL_PATTERNS = [
    // Telefones brasileiros — formatos variados
    /(\+?55\s?)?(\(?\d{2}\)?\s?)(\d{4,5}[-\s]?\d{4})/g,
    // E-mails
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    // URLs e domínios
    /https?:\/\/[^\s,)]+/g,
    /\bwww\.[^\s,)]+/g,
    /\b[a-zA-Z0-9\-]+\.(com\.br|com|com\.br|net|io|org|br)\b/g,
    // Horários de funcionamento — padrões comuns em pt-BR
    /\b\d{1,2}[h:]\d{0,2}\s*(às|a|até|-)\s*\d{1,2}[h:]\d{0,2}\b/gi,
    /\b(segunda|terça|quarta|quinta|sexta|sábado|domingo|seg|ter|qua|qui|sex|sáb|dom)[\s\-a]+(a|à|até|segunda|terça|quarta|quinta|sexta|sábado|domingo|seg|ter|qua|qui|sex|sáb|dom)\b/gi,
  ];

  const result = {};
  let removedCount = 0;

  for (const field of KNOWN_FIELDS) {
    const value = config[field];
    if (typeof value !== 'string') {
      if (value !== undefined) result[field] = value;
      continue;
    }

    let cleaned = value;
    for (const pattern of OPERATIONAL_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }
    // Compactar espaços e pontuação residual
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

    if (cleaned !== value) {
      removedCount++;
      console.log('[PROMPT:legacy-sanitize]', { field, original_len: value.length, cleaned_len: cleaned.length });
    }

    if (cleaned.length >= 10) {
      result[field] = cleaned;
    }
    // Se ficou vazio ou muito curto após a limpeza, omite o campo (não quebra o runtime)
  }

  if (removedCount > 0) {
    console.warn('[PROMPT:legacy-operational-data-removed]', { fields_affected: removedCount });
  }

  return result;
}

// ── buildPromptFromConfig ─────────────────────────────────────────────────────

/**
 * Monta o agent.prompt a partir de prompt_config + dados live da empresa.
 *
 * Seção A — Comportamento do agente (de prompt_config):
 *   Identidade, objetivo, estilo de comunicação, regras comerciais, notas.
 *   Sanitização on-read remove dados operacionais congelados em configs legados.
 *
 * Seção B — Contexto da empresa (de companyData, injetado pelo sistema):
 *   Nome, localização, contatos, horário, descrição.
 *   FONTE DE VERDADE: dados vêm exclusivamente das colunas diretas de companies.
 *   Nunca editável pelo usuário. Sempre fresco — lido em runtime, não salvo.
 *   Precedida de instrução explícita ao LLM sobre fonte de verdade.
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

  // 2. Sanitizar padrões perigosos (modo mount — nunca lança, apenas omite)
  const afterSanitize = sanitizePromptConfig(config, 'mount');

  // 3. Sanitização on-read de dados operacionais congelados (legado)
  //    Remove telefones, e-mails, URLs e horários que gerações antigas possam
  //    ter embutido nos campos. Não altera o banco — apenas o prompt montado.
  const clean = sanitizeLegacyOperationalData(afterSanitize);

  // 4. Normalizar
  const norm = {};
  for (const field of KNOWN_FIELDS) {
    norm[field] = typeof clean[field] === 'string'
      ? normalizeField(clean[field])
      : clean[field];
  }

  // ── Seção A: Comportamento do agente ─────────────────────────────────────
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

  if (norm.tool_instructions?.trim()) {
    parts.push(`\n\n[INSTRUÇÕES PARA AÇÕES DO AGENTE]\n${norm.tool_instructions}`);
  }

  // ── Seção B: Dados da empresa (fonte de verdade — runtime, nunca salvo) ──
  //
  // Usa exclusivamente colunas diretas da tabela companies.
  // Fontes legadas (ai_profile.business_hours, ai_profile.descricao,
  // ai_profile.diferenciais, cd.whatsapp) foram removidas — as colunas
  // diretas horario_atendimento e descricao_empresa são a fonte correta.
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

    // Contatos (apenas colunas diretas — whatsapp removido: coberto por telefone_principal)
    const contatos = [];
    if (cd.telefone_principal) contatos.push(cd.telefone_principal);
    if (cd.email_principal)    contatos.push(cd.email_principal);
    if (cd.site_principal)     contatos.push(cd.site_principal);
    if (contatos.length > 0) {
      companyLines.push(`Contato: ${contatos.join(' | ')}.`);
    }

    // Horário de atendimento — coluna direta (fallback ai_profile removido)
    if (cd.horario_atendimento) {
      companyLines.push(`Horário de atendimento: ${cd.horario_atendimento}.`);
    }

    // Ponto de referência
    if (cd.ponto_referencia) {
      companyLines.push(`Ponto de referência: ${cd.ponto_referencia}.`);
    }

    // Descrição da empresa — coluna direta (fallback ai_profile removido)
    if (cd.descricao_empresa) {
      companyLines.push(String(cd.descricao_empresa).trim());
    }

    if (companyLines.length > 0) {
      // Instrução de fonte de verdade: garante que o LLM priorize estes dados
      // sobre qualquer informação que possa ter ficado congelada na Seção A.
      parts.push(
        '\n\n---\n' +
        'DADOS DA EMPRESA (fonte de verdade — sempre use estes, nunca invente ou reutilize outros):\n' +
        companyLines.join('\n')
      );
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
    has_tool_instructions:    Boolean(norm.tool_instructions?.trim()),
    has_company_section:      companyData ? true : false,
  });

  return result;
}
