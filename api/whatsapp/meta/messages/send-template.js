// =============================================================================
// POST /api/whatsapp/meta/messages/send-template
//
// Envia uma mensagem de template WhatsApp via Meta Cloud API (MVP4A + MVP4B).
// Valida, busca, constrói e persiste o template de forma determinística.
//
// Contrato (MVP4A — textual):
//   Body: { company_id, instance_id, conversation_id,
//            template_name, template_language, parameter_values }
//
// Contrato adicional (MVP4B — media HEADER):
//   Body: { ..., header_media_asset_id }   — UUID do asset validado server-side
//   Campos NÃO aceitos como fonte de verdade: to, waba_id, phone_number_id,
//     token, components, status, category, parameter_format,
//     media_id, mime, mime_type, filename, url, preview_url, s3_key, bucket.
//
// Fluxo (ordem de segurança obrigatória — não alterar):
//   1.  Method guard (POST only)
//   2.  Extração de campos do body (campos sensíveis ignorados)
//   3.  getSupabaseAdmin()
//   4.  validateMetaCaller() — auth + RBAC + feature flag (META_SEND_ROLES)
//   5.  Validação de contrato restante (pós-auth, antes de lookups)
//   6.  Lookup de instância (auth.companyId, deleted_at IS NULL)
//   7.  Verificação de status (connected)
//   8.  Lookup de conversa (auth.companyId + instance.id) → deriva recipient
//   9.  Normalização de recipient (wa_id do banco)
//  10.  Lookup de credencial (instance.id)
//  11.  Decrypt do token
//  12.  Lookup paginado do template (≤3 páginas, server-side language filter)
//  13.  Detecção de duplicata / busca incompleta / not found / language not found
//  14.  analyzeTemplate → supported check → headerMediaFormat
//  14.5 Cross-check media: hasMediaHeader vs header_media_asset_id
//  15.  validateParameterValues → mismatch check
//  16.  interpolateBody (antecipado pré-writes — função pura)
//  17A. validateMediaAsset (pré-write: download + MIME real) [somente media]
//  17B. uploadMedia → WRITE 1 → mediaId [somente media]
//  17C. buildGraphComponents (com ou sem headerMedia)
//  18.  sendTemplateMessage → WRITE 2
//  19.  Persistência em meta_whatsapp_messages (tracking)
//  20.  Persistência em meta_messages (chat) — inclui media_asset_id
//  21.  Resposta sanitizada
//
// Segurança:
//   - company_id identifica tenant solicitado — não autoriza acesso.
//   - auth.companyId é a fonte de verdade para todos os lookups DB.
//   - recipient (to) vem EXCLUSIVAMENTE de conversation.wa_id (banco).
//   - phone_number_id vem EXCLUSIVAMENTE de instance.phone_number_id (banco).
//   - waba_id vem EXCLUSIVAMENTE de instance.waba_id (banco).
//   - token descriptografado no backend — nunca exposto ao caller.
//   - components construídos server-side pelo engine — nunca do frontend.
//   - asset validado server-side (tenant-safe) — blob/MIME nunca do frontend.
//   - mediaId retornado pelo Graph /media — nunca aceito do frontend.
//   - Erros internos nunca expõem token, wamid, wa_id, parameter values ou stack.
//   - Lookup cross-tenant: 404 opaco idêntico a inexistente.
//   - Duplicata ou busca incompleta: fail-closed antes de Graph WRITE.
//   - Nenhum retry automático após Graph WRITE.
//
// Persistência (etapas 19–20):
//   Ambos os INSERTs ocorrem somente após Graph WRITE 2 success confirmado.
//   Ordem: meta_whatsapp_messages primeiro, depois meta_messages.
//   Falha em qualquer INSERT → 500 send_persistence_failed.
//   Nenhum retry de Graph ocorre após falha de persistência.
//
// Write budget:
//   Template textual: 0×/media + 1×/messages = 1 Graph WRITE total.
//   Template media:   1×/media + 1×/messages = 2 Graph WRITEs total.
//   Nenhum retry automático em nenhum WRITE.
//
// Dívidas documentadas:
//   [DEBT D-TNA]    template_not_approved indistinguível de template_not_found.
//   [DEBT D-ORPHAN] orphan media_id se WRITE 2 falhar após WRITE 1 — sem rollback automático.
//   [DEBT D-DUPLI]  mensagem duplicada em retry manual pelo caller.
// =============================================================================

import { getSupabaseAdmin }                    from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_SEND_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken }                    from '../../../lib/meta-whatsapp/tokenCrypto.js';
import { listMessageTemplates,
         sendTemplateMessage,
         uploadMedia }                         from '../../../lib/meta-whatsapp/graphClient.js';
import { analyzeTemplate,
         validateParameterValues,
         buildGraphComponents,
         interpolateBody }                     from '../../../lib/meta-whatsapp/templateEngine.js';
import { validateMediaAsset }                  from '../../../lib/meta-whatsapp/mediaAsset.js';

// UUID v4 básico — mesma regex de validateMetaCaller.js.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limites de tamanho para campos de template.
const TEMPLATE_NAME_MAX_LEN     = 512;
const TEMPLATE_LANGUAGE_MAX_LEN = 64;

// Limite máximo de páginas de template lookup por request.
const MAX_TEMPLATE_LOOKUP_PAGES = 3;

// Itens por página no lookup de template.
const TEMPLATE_LOOKUP_LIMIT = 20;

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Extrair campos do body ──────────────────────────────────────────────
  // Campos sensíveis (to, waba_id, phone_number_id, token, components, status,
  // category, parameter_format, media_id, mime, filename, url, preview_url,
  // s3_key, bucket) são ignorados mesmo que presentes no body.
  const {
    company_id:            companyId,
    instance_id:           instanceId,
    conversation_id:       conversationId,
    template_name:         templateName,
    template_language:     templateLanguage,
    parameter_values:      parameterValues,
    header_media_asset_id: headerMediaAssetId,
  } = req.body ?? {};

  // ── 3. Supabase admin client ───────────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Proteção defensiva externa — captura throws inesperados não cobertos abaixo.
  try {

  // ── 4. Auth + RBAC + feature flag ─────────────────────────────────────────
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_SEND_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 5. Validar contrato restante (somente após auth bem-sucedida) ──────────

  // instance_id: UUID obrigatório
  if (!instanceId || !UUID_RE.test(instanceId)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // conversation_id: UUID obrigatório
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // template_name: string não vazia, máximo 512 caracteres (L-01)
  if (typeof templateName !== 'string' || templateName.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (templateName.length > TEMPLATE_NAME_MAX_LEN) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // template_language: string não vazia, máximo 64 caracteres (L-01)
  if (typeof templateLanguage !== 'string' || templateLanguage.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (templateLanguage.length > TEMPLATE_LANGUAGE_MAX_LEN) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // parameter_values: estrutura mínima obrigatória.
  if (
    parameterValues === null ||
    typeof parameterValues !== 'object' ||
    Array.isArray(parameterValues)
  ) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (!Object.prototype.hasOwnProperty.call(parameterValues, 'body')) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const bodyPreCheck = parameterValues.body;
  if (
    bodyPreCheck === null ||
    typeof bodyPreCheck !== 'object' ||
    Array.isArray(bodyPreCheck)
  ) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // header_media_asset_id: se presente, deve ser UUID válido.
  // Ausente (undefined) é permitido — cross-check vs template ocorre na etapa 14.5.
  if (headerMediaAssetId !== undefined) {
    if (typeof headerMediaAssetId !== 'string' || !UUID_RE.test(headerMediaAssetId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
  }

  // ── 6. Lookup de instância ─────────────────────────────────────────────────
  const { data: instance, error: instErr } = await svc
    .from('meta_whatsapp_instances')
    .select('id, company_id, phone_number_id, waba_id, status')
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
  if (instance.status !== 'connected') {
    return res.status(409).json({ error: 'instance_not_connected' });
  }

  // ── 8. Lookup de conversa ──────────────────────────────────────────────────
  const { data: conversation, error: convErr } = await svc
    .from('meta_conversations')
    .select('id, wa_id, company_id, instance_id')
    .eq('id', conversationId)
    .eq('company_id', auth.companyId)
    .eq('instance_id', instance.id)
    .maybeSingle();

  if (convErr) {
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!conversation) {
    return res.status(404).json({ error: 'conversation_not_found' });
  }

  // ── 9. Normalizar recipient ────────────────────────────────────────────────
  const waIdRaw     = conversation.wa_id ?? '';
  const toRecipient = waIdRaw.startsWith('+') ? waIdRaw.slice(1) : waIdRaw;
  if (!/^[0-9]+$/.test(toRecipient) || toRecipient.length === 0) {
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 10. Lookup de credencial ───────────────────────────────────────────────
  const { data: credential, error: credErr } = await svc
    .from('meta_whatsapp_credentials')
    .select('access_token_enc')
    .eq('instance_id', instance.id)
    .maybeSingle();

  if (credErr || !credential?.access_token_enc) {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 11. Decrypt do token ───────────────────────────────────────────────────
  let plainToken;
  try {
    plainToken = decryptMetaToken(credential.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 12. Lookup paginado do template (máximo 3 páginas, server-side language) ──
  let matches        = [];
  let nameMatchCount = 0;
  let cursor;
  let lookupComplete = false;

  for (let page = 1; page <= MAX_TEMPLATE_LOOKUP_PAGES; page++) {
    let listResult;
    try {
      listResult = await listMessageTemplates(
        plainToken,
        instance.waba_id,
        {
          name:   templateName,
          status: 'APPROVED',
          limit:  TEMPLATE_LOOKUP_LIMIT,
          after:  cursor,
        },
      );
    } catch (err) {
      const code = err?.code;
      if (code === 'graph_timeout' || code === 'graph_network_error') {
        return res.status(503).json({ error: 'provider_unavailable' });
      }
      return res.status(502).json({ error: 'provider_error' });
    }

    for (const tpl of (listResult.templates ?? [])) {
      if (tpl === null || typeof tpl !== 'object' || Array.isArray(tpl)) continue;
      if (tpl.name === templateName && tpl.status === 'APPROVED') {
        nameMatchCount++;
        if (tpl.language === templateLanguage) {
          matches.push(tpl);
          if (matches.length > 1) {
            return res.status(422).json({ error: 'template_unsupported' });
          }
        }
      }
    }

    if (!listResult.nextCursor) {
      lookupComplete = true;
      break;
    }

    cursor = listResult.nextCursor;
  }

  // ── 13. Decisão pós-lookup ─────────────────────────────────────────────────
  if (!lookupComplete) {
    return res.status(422).json({ error: 'template_unsupported' });
  }

  if (matches.length === 0) {
    if (nameMatchCount === 0) {
      return res.status(404).json({ error: 'template_not_found' });
    }
    return res.status(404).json({ error: 'template_language_not_found' });
  }

  const rawTemplate = matches[0];

  // ── 14. Analisar template ──────────────────────────────────────────────────
  const analysis = analyzeTemplate(rawTemplate);
  if (!analysis.supported) {
    return res.status(422).json({ error: 'template_unsupported' });
  }

  // ── 14.5 Cross-check media: hasMediaHeader vs header_media_asset_id ────────
  // Fail-closed antes de qualquer Graph WRITE.
  //
  // A) Template tem HEADER media + asset ausente → rejeitar.
  // B) Template NÃO tem HEADER media + asset presente → rejeitar.
  //
  // analysis.headerMediaFormat: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null.
  const hasMediaHeader = analysis.headerMediaFormat !== null;

  if (hasMediaHeader && !headerMediaAssetId) {
    return res.status(400).json({ error: 'media_header_required' });
  }
  if (!hasMediaHeader && headerMediaAssetId) {
    return res.status(400).json({ error: 'media_header_unexpected' });
  }

  // ── 15. Validar parameter_values ──────────────────────────────────────────
  const pvValidation = validateParameterValues(analysis.parameters, parameterValues);
  if (!pvValidation.valid) {
    const status = pvValidation.error === 'invalid_request' ? 400 : 422;
    return res.status(status).json({ error: pvValidation.error });
  }

  // ── 16. Interpolar body (antecipado pré-writes — função pura) ─────────────
  // Executado antes de qualquer Graph WRITE para minimizar gap entre WRITE 1 e WRITE 2.
  // renderedBody persiste como body da mensagem — nunca recebe mediaId, filename ou URL.
  const renderedBody = interpolateBody(
    analysis.bodyText,
    analysis.parameter_format,
    parameterValues.body,
  );

  // ── 17A–17B. Validar asset + WRITE 1 (somente para template media) ─────────
  // validateMediaAsset: lookup tenant-safe + download + MIME real. NÃO é Graph WRITE.
  // uploadMedia: WRITE 1 — exatamente 1 fetch, sem retry.
  let assetId           = null;   // persiste em meta_messages.media_asset_id
  let uploadedMediaId   = null;   // retornado pelo WRITE 1
  let uploadedMediaType = null;   // de assetResult.mediaType
  let uploadedFilename  = undefined; // de assetResult.filename (somente DOCUMENT)

  if (hasMediaHeader) {
    // ── 17A. Validar asset ─────────────────────────────────────────────────
    // companyId: auth.companyId — nunca do body.
    // expectedMediaType: analysis.headerMediaFormat — do banco Graph, nunca do body.
    let assetResult;
    try {
      assetResult = await validateMediaAsset({
        supabase:          svc,
        companyId:         auth.companyId,
        assetId:           headerMediaAssetId,
        expectedMediaType: analysis.headerMediaFormat,
      });
    } catch (err) {
      const code = err?.code;
      if (code === 'media_asset_not_found')        return res.status(404).json({ error: 'media_asset_not_found' });
      if (code === 'media_asset_invalid')          return res.status(400).json({ error: 'invalid_request' });
      if (code === 'media_asset_download_failed')  return res.status(503).json({ error: 'media_provider_unavailable' });
      if (code === 'media_asset_too_large')        return res.status(422).json({ error: 'media_asset_too_large' });
      if (code === 'media_asset_type_unknown')     return res.status(422).json({ error: 'media_asset_type_unknown' });
      if (code === 'media_asset_type_unsupported') return res.status(422).json({ error: 'media_asset_type_unsupported' });
      if (code === 'media_asset_type_mismatch')    return res.status(422).json({ error: 'media_asset_type_mismatch' });
      return res.status(500).json({ error: 'internal_error' });
    }

    assetId           = assetResult.assetId;
    uploadedMediaType = assetResult.mediaType;
    uploadedFilename  = assetResult.filename; // undefined para IMAGE/VIDEO

    // ── 17B. Upload para Graph /media (WRITE 1) ────────────────────────────
    // token e phone_number_id vêm EXCLUSIVAMENTE do banco — nunca do body.
    // blob e mimeType vêm EXCLUSIVAMENTE de assetResult (validado server-side).
    // Exatamente 1 fetch — sem retry.
    let uploadResult;
    try {
      uploadResult = await uploadMedia(
        plainToken,
        instance.phone_number_id,
        assetResult.blob,
        assetResult.mimeType,
        uploadedFilename,
      );
    } catch (err) {
      const code = err?.code;
      if (code === 'upload_media_timeout' || code === 'upload_media_network_error') {
        return res.status(503).json({ error: 'provider_unavailable' });
      }
      if (code === 'upload_media_failed' || code === 'upload_media_invalid_response') {
        return res.status(502).json({ error: 'provider_error' });
      }
      // upload_media_invalid_input ou código inesperado
      return res.status(500).json({ error: 'internal_error' });
    }

    uploadedMediaId = uploadResult.mediaId;
  }

  // ── 17C. Construir Graph components ───────────────────────────────────────
  // Para template textual: sem headerMedia (comportamento MVP4A inalterado).
  // Para template media: com headerMedia resolvido server-side.
  // buildGraphComponents é puro mas pode lançar — proteger explicitamente.
  // Se lançar após uploadMedia (WRITE 1): orphan media_id — dívida operacional [DEBT D-ORPHAN].
  let components;
  try {
    components = buildGraphComponents(
      rawTemplate.components,
      analysis.parameter_format,
      parameterValues,
      hasMediaHeader
        ? { headerMedia: { mediaId: uploadedMediaId, mediaType: uploadedMediaType, filename: uploadedFilename } }
        : {},
    );
  } catch {
    // NÃO repetir upload. NÃO chamar sendTemplateMessage.
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 18. Envio via Graph API (WRITE 2) ─────────────────────────────────────
  // phone_number_id e toRecipient vêm EXCLUSIVAMENTE do banco.
  // components construídos server-side pelo engine.
  // Exatamente 1 fetch — sem retry.
  const templatePayload = {
    name:     templateName,
    language: { code: templateLanguage },
    ...(components.length > 0 ? { components } : {}),
  };

  let result;
  try {
    result = await sendTemplateMessage(
      plainToken,
      instance.phone_number_id,
      toRecipient,
      templatePayload,
    );
  } catch (err) {
    const code = err?.code;
    if (code === 'send_template_timeout' || code === 'send_template_network_error') {
      return res.status(503).json({ error: 'provider_unavailable' });
    }
    if (code === 'send_template_failed' || code === 'send_template_invalid_response') {
      return res.status(502).json({ error: 'provider_error' });
    }
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 19. Persistir wamid em meta_whatsapp_messages (tracking) ──────────────
  const { error: insertTrackingErr } = await svc
    .from('meta_whatsapp_messages')
    .insert({
      company_id:      auth.companyId,
      instance_id:     instance.id,
      meta_message_id: result.messageId,
      status:          'accepted',
    });

  if (insertTrackingErr) {
    return res.status(500).json({ error: 'send_persistence_failed' });
  }

  // ── 20. Persistir mensagem outbound em meta_messages (chat) ───────────────
  // media_asset_id: UUID do asset validado (para template media) ou null (para textual).
  // body: renderedBody — exclusivamente texto interpolado do BODY.
  // Nunca: mediaId, filename, URL ou s3_key no body.
  const { error: insertChatErr } = await svc
    .from('meta_messages')
    .insert({
      company_id:         auth.companyId,
      conversation_id:    conversation.id,
      instance_id:        instance.id,
      meta_message_id:    result.messageId,
      direction:          'outbound',
      message_type:       'template',
      body:               renderedBody,
      template_name:      templateName,
      template_language:  templateLanguage,
      provider_timestamp: new Date().toISOString(),
      media_asset_id:     assetId,
    });

  if (insertChatErr) {
    return res.status(500).json({ error: 'send_persistence_failed' });
  }

  // ── 21. Resposta sanitizada ────────────────────────────────────────────────
  // Somente message_id (wamid) retornado — nunca token, credential, recipient,
  // payload Graph, mediaId ou asset.
  return res.status(200).json({ ok: true, message_id: result.messageId });

  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }
}
