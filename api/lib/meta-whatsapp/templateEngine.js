// =============================================================================
// templateEngine.js — Motor de Templates Meta WhatsApp
//
// Módulo puro: sem IO, sem Supabase, sem Graph, sem auth, sem env, sem side
// effects, sem logging de valores de parâmetros.
//
// Exports públicos:
//   analyzeTemplate(rawTemplate)
//   validateParameterValues(parameters, parameterValues)
//   buildGraphComponents(templateComponents, parameterFormat, parameterValues)
//   interpolateBody(bodyText, parameterFormat, bodyValues)
//
// Fonte canônica de placeholders: component.text
// component.example é usado SOMENTE como hint para example no DTO.
//
// Escopo MVP4A: BODY TEXT obrigatório, HEADER TEXT opcional, FOOTER estático.
// Escopo MVP4B.2: HEADER IMAGE, VIDEO e DOCUMENT reconhecidos como suportados.
//   A construção do componente Graph de mídia (link/id) pertence à 4B.4.
//   Media headers NÃO geram parâmetros textuais — parâmetros textuais são
//   exclusivamente de HEADER TEXT e BODY.
// BUTTONS / CAROUSEL / AUTHENTICATION / CATALOG / outros → unsupported.
// =============================================================================

// Regex — uso interno, reutilizadas pelos helpers privados.
const RE_ANY_PLACEHOLDER  = /\{\{([^}]*)\}\}/g;      // qualquer {{...}}
const RE_POSITIONAL       = /\{\{(\d+)\}\}/g;          // {{N}} dígitos
const RE_NAMED            = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g; // {{name}}

// Formatos de HEADER de mídia suportados a partir do MVP4B.2.
// Cada valor corresponde diretamente ao campo `format` do componente Graph API.
// Formatos desconhecidos continuam fail-closed (unsupported).
const SUPPORTED_MEDIA_HEADER_FORMATS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

// =============================================================================
// Helpers privados
// =============================================================================

/** Valida/normaliza parameter_format. Retorna 'POSITIONAL'|'NAMED'|null. */
function validFmt(raw) {
  const f = raw ?? 'POSITIONAL';
  if (f === 'POSITIONAL' || f === 'NAMED') return f;
  return null;
}

/** Cria um objeto de retorno para template não suportado. */
function makeUnsupported(reason, fmt) {
  return {
    supported:          false,
    unsupported_reason: reason,
    parameter_format:   fmt,
    parameters:         [],
    bodyText:           null,
    headerMediaFormat:  null,
  };
}

/** Extrai exemplo POSITIONAL de um componente. */
function getPositionalExample(example, componentType, position) {
  try {
    if (componentType === 'BODY') {
      const arr = example?.body_text;
      if (Array.isArray(arr) && Array.isArray(arr[0])) {
        const val = arr[0][position - 1];
        return typeof val === 'string' ? val : null;
      }
    } else if (componentType === 'HEADER') {
      const arr = example?.header_text;
      if (Array.isArray(arr)) {
        return typeof arr[0] === 'string' ? arr[0] : null;
      }
    }
  } catch { /* malformed example — não crítico */ }
  return null;
}

/** Extrai exemplo NAMED de um componente. */
function getNamedExample(example, componentType, paramName) {
  try {
    const key = componentType === 'HEADER' ? 'header_text_named_params' : 'body_text_named_params';
    const named = example?.[key];
    if (Array.isArray(named)) {
      const entry = named.find(p => p?.param_name === paramName);
      return typeof entry?.example === 'string' ? entry.example : null;
    }
  } catch { /* malformed example — não crítico */ }
  return null;
}

/**
 * Verifica conjunto de inner strings de duas passagens e retorna residuals.
 * Não usa for...in — usa Set e iteração segura.
 * @private
 */
function collectInners(text, regex) {
  const result = new Set();
  const re = new RegExp(regex.source, regex.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    result.add(m[1]);
  }
  return result;
}

/**
 * Analisa placeholders de component.text conforme parameter_format.
 * Retorna { ok: true, params } ou { ok: false, reason }.
 * @private
 */
function parsePlaceholders(text, format, componentType, example) {
  // Pass 1: qualquer {{...}} no texto
  const allInners = collectInners(text, RE_ANY_PLACEHOLDER);

  if (format === 'POSITIONAL') {
    // Pass 2: somente {{N}} dígitos
    const digitInners = collectInners(text, RE_POSITIONAL);

    // Residuals: qualquer inner que não seja dígitos = malformed
    for (const inner of allInners) {
      if (!digitInners.has(inner)) {
        return { ok: false, reason: 'malformed_placeholder' };
      }
    }

    // {{0}}: detectado pelo parser (é dígito), mas índice inválido
    if (digitInners.has('0')) {
      return { ok: false, reason: 'invalid_placeholder_index' };
    }

    // Índices válidos únicos, ordenados
    const indices = [...digitInners].map(s => parseInt(s, 10)).sort((a, b) => a - b);

    // Verificar sequência contígua 1..N
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i + 1) {
        return { ok: false, reason: 'placeholder_gap' };
      }
    }

    const params = indices.map(n => ({
      component: componentType,
      key:       String(n),
      position:  n,
      example:   getPositionalExample(example, componentType, n),
    }));

    return { ok: true, params };
  }

  // NAMED
  const namedInners = collectInners(text, RE_NAMED);
  // Residuals para NAMED
  for (const inner of allInners) {
    if (!namedInners.has(inner)) {
      return { ok: false, reason: 'malformed_placeholder' };
    }
  }

  // Preservar ordem de primeira ocorrência
  const seen   = new Set();
  const order  = [];
  const re     = new RegExp(RE_NAMED.source, RE_NAMED.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); order.push(m[1]); }
  }

  const params = order.map(name => ({
    component: componentType,
    key:       name,
    position:  null,
    example:   getNamedExample(example, componentType, name),
  }));

  return { ok: true, params };
}

/**
 * Constrói parameters[] da Graph API a partir do texto e dos valores fornecidos.
 * POSITIONAL: ordena por índice. NAMED: ordem de primeira ocorrência.
 * @private
 */
function buildTextParameters(text, format, values) {
  if (typeof text !== 'string') return [];

  if (format === 'POSITIONAL') {
    const indices = new Set();
    const re = new RegExp(RE_POSITIONAL.source, RE_POSITIONAL.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0) indices.add(n);
    }
    return [...indices].sort((a, b) => a - b).map(n => ({
      type: 'text',
      text: values[String(n)] ?? '',
    }));
  }

  // NAMED
  const seen  = new Set();
  const order = [];
  const re    = new RegExp(RE_NAMED.source, RE_NAMED.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); order.push(m[1]); }
  }
  return order.map(name => ({
    type:           'text',
    parameter_name: name,
    text:           values[name] ?? '',
  }));
}

/** Verifica igualdade exata (sem ordem) entre dois arrays de chaves. @private */
function strictKeyMatch(expected, actual) {
  if (expected.length !== actual.length) return false;
  const set = new Set(expected);
  for (const k of actual) {
    if (!set.has(k)) return false;
  }
  return true;
}

// =============================================================================
// API pública
// =============================================================================

/**
 * Analisa um template Meta bruto e retorna classificação e parâmetros esperados.
 *
 * Fonte canônica: component.text (não component.example).
 * Fail-closed: nunca lança — retorna supported=false em casos inesperados.
 *
 * @param {unknown} rawTemplate  Template bruto da Graph API (não sanitizado)
 * @returns {{
 *   supported:          boolean,
 *   unsupported_reason: string | null,
 *   parameter_format:   'POSITIONAL' | 'NAMED',
 *   parameters:         Array<{component:'HEADER'|'BODY', key:string,
 *                              position:number|null, example:string|null}>,
 *   bodyText:           string | null
 * }}
 */
export function analyzeTemplate(rawTemplate) {
  try {
    // Payload malformado — não é objeto
    if (rawTemplate === null || typeof rawTemplate !== 'object' || Array.isArray(rawTemplate)) {
      return makeUnsupported('invalid_template_structure', 'POSITIONAL');
    }

    // AUTHENTICATION: fora do escopo MVP
    if (rawTemplate.category === 'AUTHENTICATION') {
      const fmt = validFmt(rawTemplate.parameter_format) ?? 'POSITIONAL';
      return makeUnsupported('AUTHENTICATION templates not supported', fmt);
    }

    // parameter_format com fallback POSITIONAL
    const fmt = validFmt(rawTemplate.parameter_format);
    if (fmt === null) {
      return makeUnsupported(
        `Unknown parameter_format: ${rawTemplate.parameter_format}`,
        'POSITIONAL',
      );
    }

    // components: array ou ausente (templates sem variáveis)
    const components = rawTemplate.components;
    if (components !== undefined && !Array.isArray(components)) {
      return makeUnsupported('Invalid components structure', fmt);
    }
    const comps = Array.isArray(components) ? components : [];

    let hasBody           = false;
    let bodyText          = null;
    let headerMediaFormat = null; // 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null
    const params          = [];

    for (const comp of comps) {
      // Component sem type válido → fail-closed
      const rawType = comp?.type;
      if (typeof rawType !== 'string' || rawType.length === 0) {
        return makeUnsupported('Invalid component structure', fmt);
      }
      const type = rawType.toUpperCase();

      if (type === 'BODY') {
        hasBody = true;
        if (typeof comp.text !== 'string') {
          return makeUnsupported('body_text_missing', fmt);
        }
        bodyText = comp.text;
        const result = parsePlaceholders(comp.text, fmt, 'BODY', comp.example);
        if (!result.ok) return makeUnsupported(result.reason, fmt);
        params.push(...result.params);
        continue;
      }

      if (type === 'HEADER') {
        // format ausente → TEXT (default Graph API)
        const rawFmt = comp.format;
        const headerFmt = rawFmt == null
          ? 'TEXT'
          : typeof rawFmt === 'string'
            ? rawFmt.toUpperCase()
            : null;

        // Mídia suportada: IMAGE, VIDEO, DOCUMENT (MVP4B.2)
        // Não geram parâmetros textuais — a referência de mídia pertence à 4B.4.
        if (headerFmt !== null && SUPPORTED_MEDIA_HEADER_FORMATS.has(headerFmt)) {
          headerMediaFormat = headerFmt;
          continue;
        }

        // TEXT: cabeçalho textual — comportamento original MVP4A.
        if (headerFmt === 'TEXT') {
          if (typeof comp.text !== 'string') {
            return makeUnsupported('header_text_missing', fmt);
          }
          const result = parsePlaceholders(comp.text, fmt, 'HEADER', comp.example);
          if (!result.ok) return makeUnsupported(result.reason, fmt);
          params.push(...result.params);
          continue;
        }

        // Qualquer outro formato (null de rawFmt não-string, 'GIF', 'LOCATION', etc.): fail-closed.
        return makeUnsupported(
          `HEADER format ${String(rawFmt ?? 'unknown')} not supported`,
          fmt,
        );
      }

      if (type === 'FOOTER') continue; // estático, sempre permitido, sem parâmetros

      // Qualquer outro tipo: unsupported
      return makeUnsupported(`Component type ${type} not supported`, fmt);
    }

    if (!hasBody) {
      return makeUnsupported('Template has no BODY component', fmt);
    }

    return {
      supported:          true,
      unsupported_reason: null,
      parameter_format:   fmt,
      parameters:         params,
      bodyText,
      headerMediaFormat,
    };
  } catch {
    // Catch defensivo — nenhum dado de rawTemplate vaza
    return makeUnsupported('internal_engine_error', 'POSITIONAL');
  }
}

/**
 * Valida que parameter_values satisfaz exatamente os parâmetros esperados.
 * Fail-closed: qualquer discrepância retorna valid=false.
 *
 * Protocolo:
 *   - plain object obrigatório;
 *   - body obrigatório (mesmo sem parâmetros, deve ser {});
 *   - header: obrigatório se template tem parâmetros HEADER, proibido caso contrário;
 *   - keys stritas: faltando OU extra → mismatch;
 *   - valores string não-vazia após trim;
 *   - Object.keys() — sem for...in, sem prototype chain.
 *
 * @param {Array}  parameters      Saída de analyzeTemplate().parameters
 * @param {unknown} parameterValues  Valor bruto enviado pelo frontend
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateParameterValues(parameters, parameterValues) {
  // Validação estrutural de parameterValues
  if (
    parameterValues === null ||
    typeof parameterValues !== 'object' ||
    Array.isArray(parameterValues)
  ) {
    return { valid: false, error: 'invalid_request' };
  }

  // body: obrigatório, plain object
  if (!Object.prototype.hasOwnProperty.call(parameterValues, 'body')) {
    return { valid: false, error: 'invalid_request' };
  }
  const bodyValues = parameterValues.body;
  if (
    bodyValues === null ||
    typeof bodyValues !== 'object' ||
    Array.isArray(bodyValues)
  ) {
    return { valid: false, error: 'invalid_request' };
  }

  const hasHeaderParam = parameters.some(p => p.component === 'HEADER');
  const hasOwnHeader   = Object.prototype.hasOwnProperty.call(parameterValues, 'header');

  if (hasHeaderParam) {
    // header esperado e obrigatório
    if (!hasOwnHeader) return { valid: false, error: 'template_params_mismatch' };
    const headerValues = parameterValues.header;
    if (
      headerValues === null ||
      typeof headerValues !== 'object' ||
      Array.isArray(headerValues)
    ) {
      return { valid: false, error: 'template_params_mismatch' };
    }
  } else {
    // header NÃO esperado — se presente = extra = mismatch
    if (hasOwnHeader) return { valid: false, error: 'template_params_mismatch' };
  }

  // Chaves e valores esperados por componente
  const expectedBodyKeys   = parameters.filter(p => p.component === 'BODY').map(p => p.key);
  const expectedHeaderKeys = parameters.filter(p => p.component === 'HEADER').map(p => p.key);

  // Validar body (strict keys + valor string não-whitespace-only)
  if (!strictKeyMatch(expectedBodyKeys, Object.keys(bodyValues))) {
    return { valid: false, error: 'template_params_mismatch' };
  }
  for (const key of expectedBodyKeys) {
    if (!Object.prototype.hasOwnProperty.call(bodyValues, key)) {
      return { valid: false, error: 'template_params_mismatch' };
    }
    const val = bodyValues[key];
    if (typeof val !== 'string') return { valid: false, error: 'template_params_mismatch' };
    if (val.trim().length === 0)  return { valid: false, error: 'template_params_mismatch' };
  }

  // Validar header (strict keys + valor string não-whitespace-only)
  if (hasHeaderParam) {
    const headerValues = parameterValues.header;
    if (!strictKeyMatch(expectedHeaderKeys, Object.keys(headerValues))) {
      return { valid: false, error: 'template_params_mismatch' };
    }
    for (const key of expectedHeaderKeys) {
      if (!Object.prototype.hasOwnProperty.call(headerValues, key)) {
        return { valid: false, error: 'template_params_mismatch' };
      }
      const val = headerValues[key];
      if (typeof val !== 'string') return { valid: false, error: 'template_params_mismatch' };
      if (val.trim().length === 0)  return { valid: false, error: 'template_params_mismatch' };
    }
  }

  return { valid: true };
}

/**
 * Constrói components[] para a Graph API a partir do template e dos valores.
 * Chamado somente após analyzeTemplate supported=true e validateParameterValues valid=true.
 *
 * FOOTER não é incluído — Graph API não espera entry de FOOTER para envio.
 * Componentes sem parâmetros (estáticos) são omitidos.
 *
 * @param {Array}  templateComponents  rawTemplate.components (array original)
 * @param {string} parameterFormat     'POSITIONAL' | 'NAMED'
 * @param {object} parameterValues     { header?, body } — já validado
 * @returns {Array}  components[] prontos para sendTemplateMessage
 */
export function buildGraphComponents(templateComponents, parameterFormat, parameterValues) {
  const comps  = Array.isArray(templateComponents) ? templateComponents : [];
  const result = [];

  for (const comp of comps) {
    const rawType = comp?.type;
    if (typeof rawType !== 'string') continue;
    const type = rawType.toUpperCase();

    if (type === 'HEADER') {
      const headerValues = parameterValues.header ?? {};
      const parameters = buildTextParameters(comp.text, parameterFormat, headerValues);
      if (parameters.length > 0) {
        result.push({ type: 'header', parameters });
      }
      continue;
    }

    if (type === 'BODY') {
      const bodyValues = parameterValues.body ?? {};
      const parameters = buildTextParameters(comp.text, parameterFormat, bodyValues);
      if (parameters.length > 0) {
        result.push({ type: 'body', parameters });
      }
      continue;
    }

    // FOOTER e outros: omitir
  }

  return result;
}

/**
 * Interpola bodyText com os valores enviados para persistência em meta_messages.body.
 * Whitespace dos valores preservado (não trimado).
 * Placeholders duplicados recebem o mesmo valor em todas as ocorrências.
 * BODY estático (sem placeholders): retorna bodyText intacto.
 *
 * @param {string} bodyText        Texto bruto do BODY (de analyzeTemplate().bodyText)
 * @param {string} parameterFormat 'POSITIONAL' | 'NAMED'
 * @param {object} bodyValues      parameter_values.body — já validado
 * @returns {string}
 */
export function interpolateBody(bodyText, parameterFormat, bodyValues) {
  if (typeof bodyText !== 'string') return '';

  if (parameterFormat === 'POSITIONAL') {
    return bodyText.replace(/\{\{(\d+)\}\}/g, (match, n) => {
      const val = Object.prototype.hasOwnProperty.call(bodyValues, n) ? bodyValues[n] : null;
      return typeof val === 'string' ? val : match;
    });
  }

  if (parameterFormat === 'NAMED') {
    return bodyText.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (match, name) => {
      const val = Object.prototype.hasOwnProperty.call(bodyValues, name) ? bodyValues[name] : null;
      return typeof val === 'string' ? val : match;
    });
  }

  return bodyText;
}
