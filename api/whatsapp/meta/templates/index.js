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
function sanitizeTemplate(raw) {
  // Campos mínimos obrigatórios — excluir do DTO se ausentes/inválidos
  if (typeof raw?.id !== 'string'       || raw.id.length === 0)       return null;
  if (typeof raw?.name !== 'string'     || raw.name.length === 0)     return null;
  if (typeof raw?.language !== 'string' || raw.language.length === 0) return null;
  if (typeof raw?.status !== 'string'   || raw.status.length === 0)   return null;
  if (typeof raw?.category !== 'string' || raw.category.length === 0) return null;

  // status deve ser APPROVED (segunda linha de defesa após o filtro Graph)
  if (raw.status !== 'APPROVED') return null;

  // Delegar análise completa ao engine.
  // Fonte canônica: component.text — component.example é somente hint de exemplo.
  const analysis = analyzeTemplate(raw);

  // safeComponents: remove `example` top-level de cada componente.
  // Justificativa: `example` é redundante (já normalizado em analysis.parameters)
  // e expõe referências internas Meta (header_handle) desnecessariamente.
  // Não muta o objeto Graph original (spread cria novo objeto por componente).
  const components    = Array.isArray(raw.components) ? raw.components : [];
  const safeComponents = components.map(({ example: _ex, ...rest }) => rest);

  return {
    id:                 raw.id,
    name:               raw.name,
    language:           raw.language,
    status:             'APPROVED',
    category:           raw.category,
    parameter_format:   analysis.parameter_format,
    components:         safeComponents,
    parameters:         analysis.parameters,
    supported:          analysis.supported,
    unsupported_reason: analysis.unsupported_reason,
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
