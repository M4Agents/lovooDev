// =============================================================================
// GET /api/whatsapp/meta/templates
//
// Lista templates APPROVED da WABA associada à instância Meta conectada.
//
// Query params:
//   company_id   (UUID, obrigatório)
//   instance_id  (UUID, obrigatório)
//   after        (string, opcional) — cursor opaco de paginação
//   status       (string, opcional) — filtro Graph. Omitido = APPROVED (contrato do chat).
//                Valores: APPROVED | PENDING | REJECTED | PAUSED | DISABLED |
//                IN_APPEAL | PENDING_DELETION | ALL.
//                ALL omite o filtro status na Graph (listagem administrativa).
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
//  10. listMessageTemplates (status do filtro validado; default APPROVED, limit=100, after)
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
//   parameter_format, components, parameters, supported, unsupported_reason,
//   header_media_format, buttons.
//   'parameters' é lista normalizada derivada server-side (picker-ready).
//   'supported' / 'unsupported_reason' indicam capacidade do MVP atual.
//   'header_media_format' classifica o tipo de mídia do HEADER: null | 'IMAGE' | 'VIDEO' | 'DOCUMENT'.
//   'buttons' é classificação sanitizada do engine (index/type/text/url_kind).
//   'supported' / 'unsupported_reason' refletem analysis do engine (QR-only = true).
//   MVP4B.2: IMAGE/VIDEO/DOCUMENT → supported=true. O envio real de mídia pertence à 4B.4.
//
// Parsing de placeholders:
//   Delegado ao templateEngine (analyzeTemplate). Fonte canônica: component.text.
//   component.example é somente hint para example no DTO — nunca determina aridade.
// =============================================================================

import { getSupabaseAdmin }                   from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_VIEW_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken }                   from '../../../lib/meta-whatsapp/tokenCrypto.js';
import { listMessageTemplates }               from '../../../lib/meta-whatsapp/graphClient.js';
import { analyzeTemplate }                    from '../../../lib/meta-whatsapp/templateEngine.js';

// UUID v4 básico — mesma regex de outros endpoints Meta.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limite máximo aceito para o parâmetro after (cursor opaco).
// Cursors Graph são tipicamente base64 com até ~300 chars.
// 1024 chars é margem confortável sem risco de buffer injection.
const AFTER_MAX_LEN = 1024;

// Status Graph aceitos na listagem administrativa. ALL = sem filtro na Graph.
const GRAPH_TEMPLATE_STATUSES = new Set([
  'APPROVED',
  'PENDING',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'IN_APPEAL',
  'PENDING_DELETION',
]);
const STATUS_FILTER_ALL = 'ALL';

// (extração de parâmetros e classificação delegadas ao templateEngine.js)

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
/**
 * Interpreta o query param status.
 * Ausente / vazio → APPROVED (contrato do chat).
 * ALL → listagem sem filtro Graph.
 * Outro valor fora da allowlist → inválido.
 * @returns {{ ok: true, filter: string } | { ok: false }}
 * @private
 */
function parseStatusFilter(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, filter: 'APPROVED' };
  }
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim().toUpperCase();
  if (value.length === 0) return { ok: true, filter: 'APPROVED' };
  if (value === STATUS_FILTER_ALL || GRAPH_TEMPLATE_STATUSES.has(value)) {
    return { ok: true, filter: value };
  }
  return { ok: false };
}

function sanitizeTemplate(raw, { requireApproved }) {
  // Campos mínimos obrigatórios — excluir do DTO se ausentes/inválidos
  if (typeof raw?.id !== 'string'       || raw.id.length === 0)       return null;
  if (typeof raw?.name !== 'string'     || raw.name.length === 0)     return null;
  if (typeof raw?.language !== 'string' || raw.language.length === 0) return null;
  if (typeof raw?.status !== 'string'   || raw.status.length === 0)   return null;
  if (typeof raw?.category !== 'string' || raw.category.length === 0) return null;

  if (requireApproved) {
    // Segunda linha de defesa do chat: só APPROVED.
    if (raw.status !== 'APPROVED') return null;
  } else if (!GRAPH_TEMPLATE_STATUSES.has(raw.status)) {
    return null;
  }

  const isAdmin = !requireApproved;

  // Delegar análise completa ao engine.
  // Fonte canônica: component.text — component.example é somente hint de exemplo.
  const analysis = analyzeTemplate(raw);

  // Chat: strip example/phone_number/payload (contrato do picker).
  // Admin: preserva conteúdo Graph para visualização integral, sem token.
  const components     = Array.isArray(raw.components) ? raw.components : [];
  const safeComponents = sanitizePublicComponents(components, {
    includeExamples:    isAdmin,
    includePhoneNumber: isAdmin,
    includePayload:     isAdmin,
  });
  const publicButtons = sanitizePublicAnalysisButtons(analysis.buttons, {
    includePhoneNumber: isAdmin,
  });

  const dto = {
    id:                  raw.id,
    name:                raw.name,
    language:            raw.language,
    status:              requireApproved ? 'APPROVED' : raw.status,
    category:            raw.category,
    parameter_format:    analysis.parameter_format,
    components:          safeComponents,
    parameters:          analysis.parameters,
    supported:           analysis.supported,
    unsupported_reason:  analysis.unsupported_reason,
    header_media_format: analysis.headerMediaFormat, // null | 'IMAGE' | 'VIDEO' | 'DOCUMENT' (MVP4B.3)
    buttons:             publicButtons,              // classificação sanitizada (MVP4C.2A / 4C.5B.B)
  };

  if (isAdmin) {
    dto.rejected_reason = typeof raw.rejected_reason === 'string' && raw.rejected_reason.length > 0
      ? raw.rejected_reason
      : null;
    dto.quality_score = sanitizeQualityScore(raw.quality_score);
  }

  return dto;
}

/**
 * Remove phone_number de um botão sem mutar o original.
 * Preserva type/index/text/url/url_kind e demais campos já públicos.
 * @private
 */
function omitPhoneNumberFromButton(button) {
  if (button === null || typeof button !== 'object' || Array.isArray(button)) {
    return button;
  }
  const { phone_number: _phoneNumber, ...rest } = button;
  return rest;
}

/**
 * DTO público de analysis.buttons.
 * Chat: sem phone_number. Admin: preserva o número da definição do template.
 * @private
 */
function sanitizePublicAnalysisButtons(buttons, { includePhoneNumber } = {}) {
  if (!Array.isArray(buttons)) return [];
  if (includePhoneNumber) return buttons.map((button) => cloneJsonValue(button));
  return buttons.map(omitPhoneNumberFromButton);
}

/**
 * Botão Graph em components[]: omite phone_number e payload, sem mutar o original.
 * Preserva type/text/url e demais campos já públicos.
 * @private
 */
function omitInternalFieldsFromGraphButton(button, { includePhoneNumber, includePayload } = {}) {
  if (button === null || typeof button !== 'object' || Array.isArray(button)) {
    return button;
  }
  const next = { ...button };
  if (!includePhoneNumber) delete next.phone_number;
  if (!includePayload) delete next.payload;
  return next;
}

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function sanitizeQualityScore(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const score = typeof raw.score === 'string' ? raw.score : null;
  const date  = typeof raw.date === 'number' ? raw.date : null;
  if (score === null && date === null) return null;
  return { score, date };
}

/**
 * Copia components Graph para o DTO.
 * Chat: strip `example`, `phone_number` e `payload`.
 * Admin: preserva example/phone/payload para visualização integral.
 * Não muta o objeto Graph original usado pelo backend de envio.
 * @private
 */
function sanitizePublicComponents(rawComponents, options = {}) {
  if (!Array.isArray(rawComponents)) return [];
  const { includeExamples, includePhoneNumber, includePayload } = options;
  return rawComponents.map((comp) => {
    if (comp === null || typeof comp !== 'object' || Array.isArray(comp)) return comp;
    const next = includeExamples ? cloneJsonValue(comp) : { ...comp };
    if (!includeExamples) delete next.example;
    if (!Array.isArray(next.buttons)) return next;
    return {
      ...next,
      buttons: next.buttons.map((button) => omitInternalFieldsFromGraphButton(button, {
        includePhoneNumber,
        includePayload,
      })),
    };
  });
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
  const statusParam = req.query?.status;

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

  const parsedStatus = parseStatusFilter(statusParam);
  if (!parsedStatus.ok) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const statusFilter = parsedStatus.filter;
  const requireApproved = statusFilter === 'APPROVED';
  const graphStatus = statusFilter === STATUS_FILTER_ALL ? null : statusFilter;

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
  // status: omitido/APPROVED = chat; ALL = sem filtro Graph; demais = filtro validado.
  // limit=100 hardcoded — uma página por chamada; caller usa after para navegar.
  // after=safeAfter (cursor validado, opaco) — passado diretamente ao graphClient.
  //   O graphClient reconstrói a URL internamente — cursor nunca vira URL de fetch.
  let listResult;
  try {
    listResult = await listMessageTemplates(
      plainToken,
      instance.waba_id,
      {
        status: graphStatus,
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
    .map((raw) => sanitizeTemplate(raw, { requireApproved }))
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
