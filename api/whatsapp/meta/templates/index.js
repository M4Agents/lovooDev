// =============================================================================
// GET /api/whatsapp/meta/templates
//
// Lista templates APPROVED da WABA associada à instância Meta conectada.
//
// Query params:
//   company_id   (UUID, obrigatório)
//   instance_id  (UUID, obrigatório)
//   after        (string, opcional) — cursor opaco de paginação
//
// Fluxo de segurança (ordem obrigatória — não alterar):
//   1. Method guard (GET only)
//   2. Validar company_id e instance_id — sem DB
//   3. Validar after — sem DB
//   4. getSupabaseAdmin()
//   5. validateMetaCaller() — auth + RBAC + feature flag (META_VIEW_ROLES)
//   6. Lookup meta_whatsapp_instances com auth.companyId
//   7. Verificar status connected
//   8. Lookup meta_whatsapp_credentials
//   9. decryptMetaToken
//  10. listMessageTemplates (status=APPROVED, limit=100, after)
//  11. Sanitizar + classificar DTO
//  12. Resposta 200
//
// Segurança:
//   - company_id da query identifica o tenant — nunca autoriza acesso.
//   - Toda query DB usa auth.companyId (validado pelo guard) — nunca req.query.*.
//   - waba_id vem exclusivamente do banco (meta_whatsapp_instances).
//   - access_token decriptado no backend — nunca exposto ao caller.
//   - after tratado como cursor opaco — nunca interpretado como URL.
//   - DTO sanitizado — nunca retornar objeto Graph bruto sem validação.
//   - Resposta opaca para cross-tenant (idêntica a instance inexistente).
//   - Erros internos nunca expõem token, waba_id, phone_number_id, stack.
//
// RBAC:
//   - META_VIEW_ROLES (super_admin, system_admin, partner, admin, manager, seller)
//   - Partner: exige assignment ativo (validado pelo guard)
//   - Parent → child: somente super_admin/system_admin do parent correto
//
// Paginação:
//   - listMessageTemplates busca UMA página (100 itens)
//   - nextCursor retornado como next_cursor ao caller
//   - after passado diretamente ao graphClient — reconstrução interna de URL
//   - cursor nunca tratado como URL (anti-SSRF garantido pelo graphClient)
//
// DTO:
//   Cada template retorna: id, name, language, status, category,
//   parameter_format, components, parameters, supported, unsupported_reason.
//   'parameters' é lista normalizada derivada server-side (picker-ready).
//   'supported' / 'unsupported_reason' indicam capacidade do MVP primeiro incremento.
// =============================================================================

import { getSupabaseAdmin }                   from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_VIEW_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken }                   from '../../../lib/meta-whatsapp/tokenCrypto.js';
import { listMessageTemplates }               from '../../../lib/meta-whatsapp/graphClient.js';

// UUID v4 básico — mesma regex de outros endpoints Meta.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limite máximo aceito para o parâmetro after (cursor opaco).
// Cursors Graph são tipicamente base64 com até ~300 chars.
// 1024 chars é margem confortável sem risco de buffer injection.
const AFTER_MAX_LEN = 1024;

// =============================================================================
// Helpers de extração de parâmetros
// =============================================================================

/**
 * Extrai parâmetros normalizados de um componente HEADER TEXT.
 * Retorna lista vazia se HEADER não for TEXT ou não tiver parâmetros.
 *
 * @param {object} component
 * @param {'NAMED'|'POSITIONAL'} parameterFormat
 * @returns {Array<{component:'HEADER', key:string, position:number|null, example:string|null}>}
 * @private
 */
function extractHeaderParams(component, parameterFormat) {
  // Somente HEADER TEXT tem parâmetros variáveis
  if (component?.format !== 'TEXT') return [];

  const example = component.example;

  if (parameterFormat === 'NAMED') {
    const named = example?.header_text_named_params;
    if (!Array.isArray(named)) return [];
    return named
      .filter(p => typeof p?.param_name === 'string' && p.param_name.length > 0)
      .map(p => ({
        component: 'HEADER',
        key:       p.param_name,
        position:  null,
        example:   typeof p.example === 'string' ? p.example : null,
      }));
  }

  // POSITIONAL: header_text é array simples com um único valor de exemplo
  const headerText = example?.header_text;
  if (Array.isArray(headerText) && headerText.length > 0) {
    return [{
      component: 'HEADER',
      key:       '1',
      position:  1,
      example:   typeof headerText[0] === 'string' ? headerText[0] : null,
    }];
  }

  return [];
}

/**
 * Extrai parâmetros normalizados de um componente BODY.
 * Retorna lista vazia se BODY não tiver parâmetros.
 *
 * @param {object} component
 * @param {'NAMED'|'POSITIONAL'} parameterFormat
 * @returns {Array<{component:'BODY', key:string, position:number|null, example:string|null}>}
 * @private
 */
function extractBodyParams(component, parameterFormat) {
  const example = component?.example;

  if (parameterFormat === 'NAMED') {
    const named = example?.body_text_named_params;
    if (!Array.isArray(named)) return [];
    return named
      .filter(p => typeof p?.param_name === 'string' && p.param_name.length > 0)
      .map(p => ({
        component: 'BODY',
        key:       p.param_name,
        position:  null,
        example:   typeof p.example === 'string' ? p.example : null,
      }));
  }

  // POSITIONAL: body_text é array bidimensional; usar body_text[0]
  const bodyText = example?.body_text;
  if (Array.isArray(bodyText) && Array.isArray(bodyText[0])) {
    return bodyText[0].map((ex, idx) => ({
      component: 'BODY',
      key:       String(idx + 1),
      position:  idx + 1,
      example:   typeof ex === 'string' ? ex : null,
    }));
  }

  return [];
}

// =============================================================================
// Classificação de suporte MVP (primeiro incremento)
// =============================================================================

/**
 * Determina se um template é suportado pelo primeiro incremento de envio.
 *
 * Primeiro incremento suportado SOMENTE quando:
 *   - BODY TEXT presente e compatível
 *   - HEADER ausente OU HEADER format === 'TEXT'
 *   - FOOTER permitido (sem parâmetros variáveis)
 *   - Nenhum componente adicional (BUTTONS, CAROUSEL, OTP, etc.)
 *   - parameter_format NAMED ou POSITIONAL (não desconhecido)
 *   - category !== 'AUTHENTICATION' (OTP fora do escopo MVP)
 *
 * Não falha silenciosamente: marca supported=false com razão explícita.
 *
 * @param {object} template  Objeto template do Graph (não sanitizado)
 * @returns {{ supported: boolean, unsupported_reason: string|null }}
 * @private
 */
function classifySupport(template) {
  const components = template.components;
  const category   = template.category;
  const fmt        = template.parameter_format ?? 'POSITIONAL';

  // AUTHENTICATION: fora do escopo MVP (botões OTP, restrições de conteúdo)
  if (category === 'AUTHENTICATION') {
    return { supported: false, unsupported_reason: 'AUTHENTICATION templates not supported in this version' };
  }

  // parameter_format desconhecido (não NAMED, não POSITIONAL)
  if (fmt !== 'NAMED' && fmt !== 'POSITIONAL') {
    return { supported: false, unsupported_reason: `Unknown parameter_format: ${fmt}` };
  }

  // components deve ser array (pode ser ausente para templates sem variáveis)
  if (components !== undefined && !Array.isArray(components)) {
    return { supported: false, unsupported_reason: 'Invalid components structure' };
  }

  const comps = Array.isArray(components) ? components : [];

  let hasBody   = false;
  let bodyIsText = false;

  for (const comp of comps) {
    const type = comp?.type?.toUpperCase();

    if (type === 'BODY') {
      hasBody = true;
      // BODY sem format é TEXT por contrato Graph — aceito
      bodyIsText = true;
      continue;
    }

    if (type === 'HEADER') {
      const format = comp?.format?.toUpperCase();
      if (format === undefined || format === 'TEXT') continue; // OK
      // IMAGE, VIDEO, DOCUMENT, etc.
      return { supported: false, unsupported_reason: `HEADER format ${format} not supported` };
    }

    if (type === 'FOOTER') continue; // sempre aceito (estático)

    // BUTTONS, CAROUSEL, ALBUM, LIMITED_TIME_OFFER, etc. — fora do escopo MVP
    if (type !== undefined) {
      return { supported: false, unsupported_reason: `Component type ${type} not supported` };
    }
  }

  // Template sem BODY não é enviável por este endpoint.
  // Inclui explicitamente o caso components: [] ou components ausente.
  if (!hasBody) {
    return { supported: false, unsupported_reason: 'Template has no BODY component' };
  }

  return { supported: true, unsupported_reason: null };
}

// =============================================================================
// Sanitizador de template individual
// =============================================================================

/**
 * Converte um objeto Graph bruto num DTO sanitizado e picker-ready.
 * Falhas de sanitização resultam em null (template excluído da listagem).
 * Nunca lança — fail-closed por template, nunca por lista.
 *
 * @param {unknown} raw  Objeto template bruto do Graph
 * @returns {object|null}
 * @private
 */
function sanitizeTemplate(raw) {
  // Campos mínimos obrigatórios
  if (typeof raw?.id !== 'string'       || raw.id.length === 0)       return null;
  if (typeof raw?.name !== 'string'     || raw.name.length === 0)     return null;
  if (typeof raw?.language !== 'string' || raw.language.length === 0) return null;
  if (typeof raw?.status !== 'string'   || raw.status.length === 0)   return null;
  if (typeof raw?.category !== 'string' || raw.category.length === 0) return null;

  // status deve ser APPROVED (segunda linha de defesa após o filtro Graph)
  if (raw.status !== 'APPROVED') return null;

  // parameter_format: NAMED | POSITIONAL | undefined → default POSITIONAL
  const fmt = raw.parameter_format ?? 'POSITIONAL';

  // Extrair parâmetros normalizados
  const components = Array.isArray(raw.components) ? raw.components : [];
  const parameters = [];

  try {
    for (const comp of components) {
      const type = comp?.type?.toUpperCase();
      if (type === 'HEADER') {
        parameters.push(...extractHeaderParams(comp, fmt));
      } else if (type === 'BODY') {
        parameters.push(...extractBodyParams(comp, fmt));
      }
      // FOOTER e outros sem parâmetros variáveis: ignorados
    }
  } catch {
    // Parâmetros inconsistentes → tratar como unsupported mas não excluir
    // safeComponents: remove `example` top-level de cada componente — dado redundante
    // (já normalizado em `parameters`) e desnecessário para preview/picker.
    // Não muta o objeto Graph original.
    const safeComponents = components.map(({ example: _ex, ...rest }) => rest);
    return {
      id:               raw.id,
      name:             raw.name,
      language:         raw.language,
      status:           'APPROVED',
      category:         raw.category,
      parameter_format: fmt,
      components:       safeComponents,
      parameters:       [],
      supported:        false,
      unsupported_reason: 'Failed to extract parameters',
    };
  }

  const { supported, unsupported_reason } = classifySupport(raw);

  // safeComponents: remove `example` top-level de cada componente.
  // Justificativa: `example` é redundante (já normalizado em `parameters`)
  // e expõe referências internas Meta (header_handle) desnecessariamente.
  // O frontend recebe type/format/text/buttons — tudo que precisa para preview.
  // Não muta o objeto Graph original (spread cria novo objeto por componente).
  const safeComponents = components.map(({ example: _ex, ...rest }) => rest);

  return {
    id:               raw.id,
    name:             raw.name,
    language:         raw.language,
    status:           'APPROVED',
    category:         raw.category,
    parameter_format: fmt,
    components:       safeComponents,
    parameters,
    supported,
    unsupported_reason,
  };
}

// =============================================================================
// Handler principal
// =============================================================================

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Validar parâmetros da query (sem DB) ────────────────────────────────
  const companyId  = req.query?.company_id;
  const instanceId = req.query?.instance_id;
  const afterParam = req.query?.after;

  if (!companyId) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // instance_id é obrigatório para templates — endpoint é por instância
  if (!instanceId || !UUID_RE.test(instanceId)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // ── 3. Validar after (cursor opaco) ───────────────────────────────────────
  // after é opcional; se presente deve ser string não vazia com tamanho razoável.
  // Nunca interpretado como URL (graphClient garante reconstrução interna).
  let safeAfter;
  if (afterParam !== undefined) {
    if (typeof afterParam !== 'string' || afterParam.trim().length === 0) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    if (afterParam.length > AFTER_MAX_LEN) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    safeAfter = afterParam;
  }

  // ── 4. Supabase admin client ───────────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Proteção defensiva externa — captura throws inesperados não cobertos abaixo.
  try {

  // ── 5. Auth + RBAC + feature flag ─────────────────────────────────────────
  // validateMetaCaller valida: Bearer → JWT → UUID → membership →
  //   role → partner assignment → parent/child → feature flag.
  // META_VIEW_ROLES inclui seller: listar templates é necessário para envio.
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_VIEW_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 6. Lookup de instância ─────────────────────────────────────────────────
  // Usa EXCLUSIVAMENTE auth.companyId — nunca req.query.company_id diretamente.
  //
  // Campos selecionados: somente id, waba_id, status.
  // phone_number_id NÃO necessário para listagem de templates.
  //
  // Resposta opaca 404: não distingue "não existe" de "outra company" de "deletada".
  const { data: instance, error: instErr } = await svc
    .from('meta_whatsapp_instances')
    .select('id, waba_id, status')
    .eq('id', instanceId)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (instErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  if (!instance) {
    return res.status(404).json({ error: 'instance_not_found' });
  }

  // ── 7. Verificar status connected ──────────────────────────────────────────
  // Templates só podem ser listados para instâncias conectadas (WABA ativa).
  // Credential lookup NÃO ocorre antes desta verificação.
  if (instance.status !== 'connected') {
    return res.status(409).json({ error: 'instance_not_connected' });
  }

  // ── 8. Lookup de credencial ────────────────────────────────────────────────
  // Somente após instance válida e connected.
  // Seleciona somente access_token_enc — nunca campos desnecessários.
  const { data: credential, error: credErr } = await svc
    .from('meta_whatsapp_credentials')
    .select('access_token_enc')
    .eq('instance_id', instance.id)
    .maybeSingle();

  if (credErr || !credential?.access_token_enc) {
    return res.status(500).json({ error: 'credentials_missing' });
  }

  // ── 9. Decrypt do token ────────────────────────────────────────────────────
  // Somente após credential confirmada.
  // Falhas de decrypt (missing, corrupto, crypto failure) → resposta genérica.
  let plainToken;
  try {
    plainToken = decryptMetaToken(credential.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'credentials_missing' });
  }

  // ── 10. Listar templates via Graph API ─────────────────────────────────────
  // waba_id vem EXCLUSIVAMENTE de instance.waba_id (banco) — nunca do caller.
  // access_token é plainToken (decriptado) — nunca do caller.
  // status='APPROVED' hardcoded — endpoint lista somente templates utilizáveis.
  // limit=100 hardcoded — uma página por chamada; caller usa after para navegar.
  // after=safeAfter (cursor validado, opaco) — passado diretamente ao graphClient.
  //   O graphClient reconstrói a URL internamente — cursor nunca vira URL de fetch.
  let listResult;
  try {
    listResult = await listMessageTemplates(
      plainToken,
      instance.waba_id,
      {
        status: 'APPROVED',
        limit:  100,
        after:  safeAfter,
      },
    );
  } catch (err) {
    const code = err?.code;
    if (code === 'graph_timeout' || code === 'graph_network_error') {
      return res.status(503).json({ error: 'provider_unavailable' });
    }
    // graph_templates_failed, graph_invalid_response, e outros
    return res.status(502).json({ error: 'provider_error' });
  }

  // ── 11. Sanitizar DTO ──────────────────────────────────────────────────────
  // Cada template é sanitizado individualmente.
  // Templates malformed (sem id/name/language/status/category ou status!=APPROVED)
  //   são excluídos do DTO (null → filtrado).
  // Um template malformed NÃO compromete os demais.
  // O objeto Graph bruto nunca é retornado diretamente.
  const sanitized = (listResult.templates ?? [])
    .map(sanitizeTemplate)
    .filter(t => t !== null);

  // ── 12. Resposta 200 ───────────────────────────────────────────────────────
  // next_cursor: string opaco | null — nunca retornar paging.next Graph.
  // Lista vazia é estado válido (WABA sem templates aprovados).
  return res.status(200).json({
    templates:   sanitized,
    next_cursor: listResult.nextCursor ?? null,
  });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos acima.
    // Nunca retornar err.message, err.code, stack ou detalhes de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
