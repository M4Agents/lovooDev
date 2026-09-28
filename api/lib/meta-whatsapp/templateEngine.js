// =============================================================================
// templateEngine.js — Motor de Templates Meta WhatsApp
//
// Módulo puro: sem IO, sem Supabase, sem Graph, sem auth, sem env, sem side
// effects, sem logging de valores de parâmetros.
//
// Exports públicos:
//   analyzeTemplate(rawTemplate)
//   validateParameterValues(parameters, parameterValues)
//   buildGraphComponents(templateComponents, parameterFormat, parameterValues, options?)
//   interpolateBody(bodyText, parameterFormat, bodyValues)
//
// Fonte canônica de placeholders: component.text
// component.example é usado SOMENTE como hint para example no DTO.
//
// Escopo MVP4A: BODY TEXT obrigatório, HEADER TEXT opcional, FOOTER estático.
// Escopo MVP4B.2: HEADER IMAGE, VIDEO e DOCUMENT reconhecidos como suportados.
// Escopo MVP4B.4B: buildGraphComponents aceita options.headerMedia para construir
//   o componente Graph de HEADER media (IMAGE/VIDEO/DOCUMENT) — puro, sem IO, sem Graph.
//   Media headers NÃO geram parâmetros textuais — parâmetros textuais são
//   exclusivamente de HEADER TEXT e BODY.
// MVP4C.1: BUTTONS é reconhecido e classificado; o envio continua bloqueado
//   (supported=false). CAROUSEL / AUTHENTICATION / CATALOG / outros → unsupported.
// MVP4C.2A: classifyButtons distingue URL static/dynamic/unknown e sanitiza
//   PHONE_NUMBER (sem expor o número). Send continua bloqueado.
// MVP4C.2B: QUICK_REPLY-only → analyzeTemplate.supported=true. Payload runtime
//   gerado no builder (options.templateIdentity). GET/picker continua gated.
// =============================================================================

// Regex — uso interno, reutilizadas pelos helpers privados.
const RE_ANY_PLACEHOLDER  = /\{\{([^}]*)\}\}/g;      // qualquer {{...}}
const RE_POSITIONAL       = /\{\{(\d+)\}\}/g;          // {{N}} dígitos
const RE_NAMED            = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g; // {{name}}

// Formatos de HEADER de mídia suportados a partir do MVP4B.2.
// Cada valor corresponde diretamente ao campo `format` do componente Graph API.
// Formatos desconhecidos continuam fail-closed (unsupported).
const SUPPORTED_MEDIA_HEADER_FORMATS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

// Tipos de botão candidatos ao MVP4C. 4C.2B habilita send somente QUICK_REPLY-only.
// URL / PHONE_NUMBER / FLOW / outros → fail-closed.
const MVP4C_CANDIDATE_BUTTON_TYPES = new Set(['QUICK_REPLY']);

// Limite defensivo Lovoo — NÃO é limite oficial Meta (desconhecido nesta fatia).
// Acima do teto interno de name (512) + language (64) do send-template.
const LOVOO_QR_PAYLOAD_MAX_LEN = 1024;
const QR_PAYLOAD_PREFIX        = 'lovoo:qr:v1';

// =============================================================================
// Helpers privados
// =============================================================================

/**
 * Cria Error com .code — fail-closed, nunca loga dados de entrada.
 * Usado por buildGraphComponents para sinalizar mismatch/ausência de headerMedia.
 * @private
 */
function makeEngineError(code, message) {
  return Object.assign(new Error(message), { code });
}

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
    buttons:            [],
  };
}

/**
 * Classifica url_kind de um botão URL a partir de button.url e parameter_format.
 * button.example NÃO define aridade.
 *
 * POSITIONAL: dinâmica somente com exatamente um {{1}} válido.
 * NAMED:      dinâmica somente com exatamente um {{nome}} válido (RE_NAMED).
 *
 * @private
 * @returns {{ kind: 'static'|'dynamic'|'unknown', url: string|null }}
 */
function classifyUrlKind(rawUrl, parameterFormat) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return { kind: 'unknown', url: null };
  }

  const allInners = collectInners(rawUrl, RE_ANY_PLACEHOLDER);

  if (allInners.size === 0) {
    return { kind: 'static', url: rawUrl };
  }

  if (parameterFormat === 'POSITIONAL') {
    const digitInners = collectInners(rawUrl, RE_POSITIONAL);
    for (const inner of allInners) {
      if (!digitInners.has(inner)) {
        return { kind: 'unknown', url: rawUrl };
      }
    }
    if (digitInners.size === 1 && digitInners.has('1')) {
      return { kind: 'dynamic', url: rawUrl };
    }
    return { kind: 'unknown', url: rawUrl };
  }

  if (parameterFormat === 'NAMED') {
    const namedInners = collectInners(rawUrl, RE_NAMED);
    for (const inner of allInners) {
      if (!namedInners.has(inner)) {
        return { kind: 'unknown', url: rawUrl };
      }
    }
    if (namedInners.size === 1) {
      return { kind: 'dynamic', url: rawUrl };
    }
    return { kind: 'unknown', url: rawUrl };
  }

  return { kind: 'unknown', url: rawUrl };
}

/**
 * Classifica component.buttons na ordem Meta (index 0-based).
 * Preserva type + text. URL adiciona url (quando string válida) + url_kind.
 * PHONE_NUMBER não expõe phone_number. payload de definição nunca entra no DTO.
 * @private
 * @returns {{ ok: false, reason: string } | { ok: true, buttons: object[], blockReason: string }}
 */
function classifyButtons(rawButtons, parameterFormat) {
  if (!Array.isArray(rawButtons)) {
    return { ok: false, reason: 'BUTTONS structure invalid' };
  }

  const buttons = [];
  let unknownType = null;

  for (let i = 0; i < rawButtons.length; i++) {
    const btn = rawButtons[i];
    if (btn === null || typeof btn !== 'object' || Array.isArray(btn)) {
      return { ok: false, reason: 'BUTTONS structure invalid' };
    }

    const rawType = btn.type;
    if (typeof rawType !== 'string' || rawType.trim().length === 0) {
      return { ok: false, reason: 'BUTTONS structure invalid' };
    }

    const type = rawType.trim().toUpperCase();
    const entry = { index: i, type };
    if (typeof btn.text === 'string') {
      entry.text = btn.text;
    }

    if (type === 'URL') {
      const classified = classifyUrlKind(btn.url, parameterFormat);
      if (classified.url !== null) {
        entry.url = classified.url;
      }
      entry.url_kind = classified.kind;
    }

    buttons.push(entry);

    if (!MVP4C_CANDIDATE_BUTTON_TYPES.has(type) && unknownType === null) {
      unknownType = type;
    }
  }

  return {
    ok: true,
    buttons,
    blockReason: unknownType === null
      ? 'BUTTONS send not enabled'
      : `BUTTONS type ${unknownType} not supported`,
  };
}

/** True somente se todos os botões são QUICK_REPLY com text não vazio. @private */
function isQuickReplyOnlyReady(buttons) {
  if (!Array.isArray(buttons) || buttons.length === 0) return false;
  return buttons.every(b =>
    b?.type === 'QUICK_REPLY'
    && typeof b.text === 'string'
    && b.text.trim().length > 0,
  );
}

/**
 * Resolve identity backend-only para payload QR.
 * name/language devem ser strings não vazias (após trim).
 * @private
 */
function resolveTemplateIdentity(options) {
  const raw = options?.templateIdentity;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name     = typeof raw.name === 'string' ? raw.name.trim() : '';
  const language = typeof raw.language === 'string' ? raw.language.trim() : '';
  if (!name || !language) return null;
  return { name, language };
}

/**
 * Payload runtime QUICK_REPLY — determinístico, independente de text.
 * Nunca logar o valor retornado.
 * @private
 */
function buildQuickReplyPayload(name, language, index) {
  return `${QR_PAYLOAD_PREFIX}:${name}:${language}:${index}`;
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
    let classifiedButtons = null; // null = sem component BUTTONS
    let buttonsBlockReason = null;
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

      if (type === 'BUTTONS') {
        // Um único component BUTTONS. Duplicata → estrutura inválida.
        if (classifiedButtons !== null) {
          return makeUnsupported('BUTTONS structure invalid', fmt);
        }
        const classified = classifyButtons(comp.buttons, fmt);
        if (!classified.ok) {
          return makeUnsupported(classified.reason, fmt);
        }
        classifiedButtons  = classified.buttons;
        buttonsBlockReason = classified.blockReason;
        continue;
      }

      // Qualquer outro tipo: unsupported
      return makeUnsupported(`Component type ${type} not supported`, fmt);
    }

    if (!hasBody) {
      return makeUnsupported('Template has no BODY component', fmt);
    }

    // 4C.2B: QUICK_REPLY-only com text válido → supported=true.
    // Mix / vazio / text ausente / tipo desconhecido → supported=false.
    if (classifiedButtons !== null) {
      const qrReady = isQuickReplyOnlyReady(classifiedButtons);
      return {
        supported:          qrReady,
        unsupported_reason: qrReady ? null : buttonsBlockReason,
        parameter_format:   fmt,
        parameters:         params,
        bodyText,
        headerMediaFormat,
        buttons:            classifiedButtons,
      };
    }

    return {
      supported:          true,
      unsupported_reason: null,
      parameter_format:   fmt,
      parameters:         params,
      bodyText,
      headerMediaFormat,
      buttons:            [],
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

  // 4C.2B: chave buttons é runtime proibida — payload nasce só no builder.
  // Dívida: demais chaves extras no root (além de header/body) ainda não são varridas.
  if (Object.prototype.hasOwnProperty.call(parameterValues, 'buttons')) {
    return { valid: false, error: 'template_params_mismatch' };
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
 * MVP4B.4B: aceita options.headerMedia para templates com HEADER de mídia.
 * headerMedia representa dado INTERNO confiável do backend — nunca payload bruto do frontend.
 * Somente mediaId, mediaType e filename são consumidos — extras são ignorados (não propagados).
 *
 * Fail-closed:
 *   - template com HEADER media mas headerMedia ausente → lança
 *   - headerMedia fornecido para template sem HEADER media → lança
 *   - mediaType não corresponde ao formato do HEADER → lança
 *   - mediaId vazio ou whitespace-only → lança
 *
 * @param {Array}  templateComponents  rawTemplate.components (array original)
 * @param {string} parameterFormat     'POSITIONAL' | 'NAMED'
 * @param {object} parameterValues     { header?, body } — já validado
 * @param {object} [options]           Opções adicionais (backward-compatible — padrão {})
 * @param {object} [options.headerMedia]           Mídia resolvida server-side (MVP4B.4B)
 * @param {string}   options.headerMedia.mediaId   Media ID retornado pelo Graph /media upload
 * @param {string}   options.headerMedia.mediaType 'IMAGE' | 'VIDEO' | 'DOCUMENT'
 * @param {string}   [options.headerMedia.filename] Hint de nome de arquivo (DOCUMENT)
 * @param {object} [options.templateIdentity]      Identidade do template relido no WABA (4C.2B)
 * @param {string}   options.templateIdentity.name     rawTemplate.name
 * @param {string}   options.templateIdentity.language rawTemplate.language
 * @returns {Array}  components[] prontos para sendTemplateMessage
 * @throws {Error} err.code in:
 *   build_media_unexpected      — headerMedia fornecido para template sem HEADER media
 *   build_media_header_missing  — template tem HEADER media mas headerMedia ausente
 *   build_media_invalid_input   — mediaId vazio ou whitespace-only
 *   build_media_header_mismatch — mediaType não corresponde ao formato do HEADER
 *   build_buttons_invalid       — BUTTONS malformado
 *   build_buttons_unsupported   — BUTTONS não é QUICK_REPLY-only
 *   build_qr_identity_missing   — templateIdentity ausente/inválido para QR
 *   build_qr_payload_too_long   — payload excede LOVOO_QR_PAYLOAD_MAX_LEN
 */
export function buildGraphComponents(templateComponents, parameterFormat, parameterValues, options = {}) {
  const comps       = Array.isArray(templateComponents) ? templateComponents : [];
  const result      = [];
  const headerMedia = options?.headerMedia ?? null;

  // ── Pré-verificação: template tem HEADER de mídia? ─────────────────────────

  const hasMediaHeader = comps.some(c => {
    if (typeof c?.type !== 'string' || c.type.toUpperCase() !== 'HEADER') return false;
    const fmt = typeof c?.format === 'string' ? c.format.toUpperCase() : null;
    return fmt !== null && SUPPORTED_MEDIA_HEADER_FORMATS.has(fmt);
  });

  // Seção 9: headerMedia fornecido mas template não tem HEADER de mídia → fail-closed
  if (!hasMediaHeader && headerMedia !== null) {
    throw makeEngineError(
      'build_media_unexpected',
      'buildGraphComponents: headerMedia provided for non-media template',
    );
  }

  // ── Loop principal ─────────────────────────────────────────────────────────

  for (const comp of comps) {
    const rawType = comp?.type;
    if (typeof rawType !== 'string') continue;
    const type = rawType.toUpperCase();

    if (type === 'HEADER') {
      const rawFmt   = comp.format;
      const headerFmt = typeof rawFmt === 'string' ? rawFmt.toUpperCase() : null;

      // ── HEADER de mídia: IMAGE | VIDEO | DOCUMENT ──────────────────────────
      if (headerFmt !== null && SUPPORTED_MEDIA_HEADER_FORMATS.has(headerFmt)) {

        // Seção 8: media HEADER presente mas headerMedia ausente → fail-closed
        if (headerMedia === null) {
          throw makeEngineError(
            'build_media_header_missing',
            'buildGraphComponents: headerMedia required for media template header',
          );
        }

        // Seção 10: mediaId — string, trim, não vazio
        const mediaId = typeof headerMedia.mediaId === 'string'
          ? headerMedia.mediaId.trim()
          : null;
        if (!mediaId) {
          throw makeEngineError(
            'build_media_invalid_input',
            'buildGraphComponents: invalid mediaId in headerMedia',
          );
        }

        // Seção 7: mismatch — mediaType deve corresponder ao formato do HEADER
        const mediaType = typeof headerMedia.mediaType === 'string'
          ? headerMedia.mediaType.trim().toUpperCase()
          : null;
        if (mediaType !== headerFmt) {
          throw makeEngineError(
            'build_media_header_mismatch',
            'buildGraphComponents: headerMedia.mediaType does not match template header format',
          );
        }

        // ── Construir componente Graph de mídia ────────────────────────────

        if (headerFmt === 'IMAGE') {
          result.push({
            type:       'header',
            parameters: [{ type: 'image', image: { id: mediaId } }],
          });

        } else if (headerFmt === 'VIDEO') {
          result.push({
            type:       'header',
            parameters: [{ type: 'video', video: { id: mediaId } }],
          });

        } else if (headerFmt === 'DOCUMENT') {
          // filename: hint opcional — auditado no contrato Graph: field recomendado mas não obrigatório.
          // Engine omite quando ausente; camada de negócio pode exigi-lo antes de chamar buildGraphComponents.
          const filename = typeof headerMedia.filename === 'string'
            ? headerMedia.filename.trim()
            : null;
          const docParam = filename ? { id: mediaId, filename } : { id: mediaId };
          result.push({
            type:       'header',
            parameters: [{ type: 'document', document: docParam }],
          });
        }

        continue;
      }

      // ── HEADER TEXT: comportamento original MVP4A (intacto) ────────────────
      const headerValues = parameterValues.header ?? {};
      const parameters   = buildTextParameters(comp.text, parameterFormat, headerValues);
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

    if (type === 'BUTTONS') {
      const classified = classifyButtons(comp.buttons, parameterFormat);
      if (!classified.ok) {
        throw makeEngineError(
          'build_buttons_invalid',
          'buildGraphComponents: BUTTONS structure invalid',
        );
      }
      if (classified.buttons.length === 0) continue;

      if (!isQuickReplyOnlyReady(classified.buttons)) {
        throw makeEngineError(
          'build_buttons_unsupported',
          'buildGraphComponents: BUTTONS type not enabled for send',
        );
      }

      const identity = resolveTemplateIdentity(options);
      if (!identity) {
        throw makeEngineError(
          'build_qr_identity_missing',
          'buildGraphComponents: templateIdentity required for QUICK_REPLY',
        );
      }

      for (const btn of classified.buttons) {
        const payload = buildQuickReplyPayload(identity.name, identity.language, btn.index);
        if (payload.length > LOVOO_QR_PAYLOAD_MAX_LEN) {
          throw makeEngineError(
            'build_qr_payload_too_long',
            'buildGraphComponents: QUICK_REPLY payload exceeds Lovoo safety limit',
          );
        }
        result.push({
          type:       'button',
          sub_type:   'quick_reply',
          index:      String(btn.index),
          parameters: [{ type: 'payload', payload }],
        });
      }
      continue;
    }

    // FOOTER e outros: omitir (preservado de MVP4A)
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
