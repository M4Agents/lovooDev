// =============================================================================
// POST /api/whatsapp/meta/messages/send-template
//
// Envia uma mensagem de template textual WhatsApp via Meta Cloud API (MVP4A).
// Valida, busca, constrói e persiste o template de forma determinística.
//
// Contrato (MVP4A):
//   Body: { company_id, instance_id, conversation_id,
//            template_name, template_language, parameter_values }
//   Campos NÃO aceitos como fonte de verdade: to, waba_id, phone_number_id,
//     token, components, status, category, parameter_format.
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
//  14.  analyzeTemplate → supported check
//  15.  validateParameterValues → mismatch check
//  16.  buildGraphComponents (server-side, nunca do frontend)
//  17.  interpolateBody para persistência
//  18.  sendTemplateMessage (Graph WRITE — exatamente uma vez)
//  19.  Persistência em meta_whatsapp_messages (tracking)
//  20.  Persistência em meta_messages (chat)
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
//   - Erros internos nunca expõem token, wamid, wa_id, parameter values ou stack.
//   - Lookup cross-tenant: 404 opaco idêntico a inexistente.
//   - Duplicata ou busca incompleta: fail-closed antes de Graph WRITE.
//   - Nenhum retry automático após Graph WRITE.
//
// Persistência (etapas 19–20):
//   Ambos os INSERTs ocorrem somente após Graph success confirmado.
//   Ordem: meta_whatsapp_messages primeiro, depois meta_messages.
//   Falha em qualquer INSERT → 500 send_persistence_failed.
//   Nenhum retry de Graph ocorre após falha de persistência.
//
// template_not_approved:
//   Não distinguível sem uma segunda Graph READ (busca usa status=APPROVED).
//   Templates não-APPROVED simplesmente não aparecem nos resultados.
//   Se name existe mas não APPROVED: classificado como template_not_found.
//   [DEBT D-TNA] — documentado, não implementado.
// =============================================================================

import { getSupabaseAdmin }                    from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_SEND_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken }                    from '../../../lib/meta-whatsapp/tokenCrypto.js';
import { listMessageTemplates,
         sendTemplateMessage }                 from '../../../lib/meta-whatsapp/graphClient.js';
import { analyzeTemplate,
         validateParameterValues,
         buildGraphComponents,
         interpolateBody }                     from '../../../lib/meta-whatsapp/templateEngine.js';

// UUID v4 básico — mesma regex de validateMetaCaller.js.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limites de tamanho para campos de template.
// Meta API: template names são identificadores alfanuméricos (≤512 chars na prática).
// Language codes: padrão BCP-47 como "pt_BR" ou "en_US" — 64 chars é margem generosa.
const TEMPLATE_NAME_MAX_LEN     = 512;
const TEMPLATE_LANGUAGE_MAX_LEN = 64;

// Limite máximo de páginas de template lookup por request.
// Cada página consome 1 Graph READ. Valor 3 é defensivo e determinístico.
const MAX_TEMPLATE_LOOKUP_PAGES = 3;

// Itens por página no lookup de template (menor que listagem geral).
const TEMPLATE_LOOKUP_LIMIT = 20;

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Extrair campos do body ──────────────────────────────────────────────
  // Campos sensíveis (to, waba_id, phone_number_id, token, components, status,
  // category, parameter_format) são ignorados mesmo que presentes no body.
  const {
    company_id:        companyId,
    instance_id:       instanceId,
    conversation_id:   conversationId,
    template_name:     templateName,
    template_language: templateLanguage,
    parameter_values:  parameterValues,
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
  // validateMetaCaller valida: Bearer → JWT → UUID → membership → role →
  //   partner assignment → parent/child → feature flag.
  // META_SEND_ROLES inclui seller — finalidade primária do CRM é envio.
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

  // parameter_values: estrutura mínima obrigatória antes de qualquer lookup Graph.
  // Validação completa de keys/values ocorre depois do template lookup (etapa 15).
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
  // parameter_values.body: deve ser plain object (não null, não array). (L-04)
  // Chaves e valores específicos são validados em etapa 15 (pós-lookup).
  const bodyPreCheck = parameterValues.body;
  if (
    bodyPreCheck === null ||
    typeof bodyPreCheck !== 'object' ||
    Array.isArray(bodyPreCheck)
  ) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // ── 6. Lookup de instância ─────────────────────────────────────────────────
  // Usa EXCLUSIVAMENTE auth.companyId.
  // waba_id e phone_number_id vêm SOMENTE do banco — nunca do body.
  // Resposta opaca 404: não distingue inexistente / outra company / deletada.
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
  // Triple-filter: id + company_id (auth) + instance_id (do banco).
  // wa_id derivado do registro validado — nunca aceito do body.
  // Resposta genérica 404: não distingue inexistente / outro tenant / outra instance.
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
  // wa_id em meta_conversations é armazenado sem '+', mas a normalização garante
  // robustez contra dados legados ou edge cases de armazenamento.
  // Recipient inválido no banco = dado corrompido → 500 (não 400: não é culpa do caller).
  const waIdRaw     = conversation.wa_id ?? '';
  const toRecipient = waIdRaw.startsWith('+') ? waIdRaw.slice(1) : waIdRaw;
  if (!/^[0-9]+$/.test(toRecipient) || toRecipient.length === 0) {
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 10. Lookup de credencial ───────────────────────────────────────────────
  // Somente após instance válida e connected.
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
  //
  // Algoritmo determinístico:
  //   - Busca pelo name via Graph API (filtro backend)
  //   - Filtro de language aplicado server-side (Graph não suporta filtro de language)
  //   - Acumula matches (name + language + APPROVED) ao longo das páginas
  //   - Duplicata detectada imediatamente → fail-closed, sem Graph WRITE
  //   - Busca incompleta (3 páginas + nextCursor) → fail-closed
  //   - nameMatchCount rastreia se algum template com o name foi encontrado
  //     (distingue template_not_found de template_language_not_found)
  //
  let matches        = [];   // templates com name + language + APPROVED
  let nameMatchCount = 0;    // templates APPROVED com o name (qualquer language)
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
      // Ignorar entries malformadas (null, primitivos, não-objeto). (L-02)
      // Graph API não deve retornar tais entries, mas a defesa em profundidade
      // garante que TypeError não alcança o outer catch.
      if (tpl === null || typeof tpl !== 'object' || Array.isArray(tpl)) continue;
      // Somente templates que o Graph deveria ter filtrado (defesa em profundidade)
      if (tpl.name === templateName && tpl.status === 'APPROVED') {
        nameMatchCount++;
        if (tpl.language === templateLanguage) {
          matches.push(tpl);
          // Duplicata detectada imediatamente — não continua lookup
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
    // 3 páginas consumidas e nextCursor ainda presente.
    // Busca não foi provada completa → impossível garantir unicidade.
    // Fail-closed: usar template_unsupported sem criar novo código público.
    // Razão interna: template_lookup_incomplete.
    return res.status(422).json({ error: 'template_unsupported' });
  }

  if (matches.length === 0) {
    if (nameMatchCount === 0) {
      // Nenhum template APPROVED com esse name encontrado na busca completa.
      // Nota: template_not_approved não é distinguível aqui (DEBT D-TNA).
      return res.status(404).json({ error: 'template_not_found' });
    }
    // Name encontrado mas language ausente
    return res.status(404).json({ error: 'template_language_not_found' });
  }

  // Exatamente 1 match com busca completa — prosseguir
  const rawTemplate = matches[0];

  // ── 14. Analisar template ──────────────────────────────────────────────────
  // Delega classificação e extração de parâmetros ao engine (fonte canônica: component.text).
  const analysis = analyzeTemplate(rawTemplate);
  if (!analysis.supported) {
    return res.status(422).json({ error: 'template_unsupported' });
  }

  // ── 15. Validar parameter_values ──────────────────────────────────────────
  // Validação completa contra estrutura REAL do template (pós-analyzeTemplate).
  // invalid_request → mismatch estrutural pré-lookup (já passado, mas engine
  //   pode detectar estrutura inválida de body) → 400.
  // template_params_mismatch → chaves faltando, extras ou valores inválidos → 422.
  const pvValidation = validateParameterValues(analysis.parameters, parameterValues);
  if (!pvValidation.valid) {
    const status = pvValidation.error === 'invalid_request' ? 400 : 422;
    return res.status(status).json({ error: pvValidation.error });
  }

  // ── 16. Construir Graph components ────────────────────────────────────────
  // Construídos server-side pelo engine — nunca aceitos do frontend.
  const components = buildGraphComponents(
    rawTemplate.components,
    analysis.parameter_format,
    parameterValues,
  );

  // ── 17. Interpolar body para persistência ─────────────────────────────────
  // renderedBody é o texto do BODY com valores interpolados.
  // Whitespace original preservado (não trimado).
  // HEADER e FOOTER não concatenados.
  const renderedBody = interpolateBody(
    analysis.bodyText,
    analysis.parameter_format,
    parameterValues.body,
  );

  // ── 18. Envio via Graph API ────────────────────────────────────────────────
  // phone_number_id vem EXCLUSIVAMENTE de instance.phone_number_id (banco).
  // toRecipient vem EXCLUSIVAMENTE de conversation.wa_id (banco).
  // Exatamente UMA chamada Graph WRITE — nenhum retry automático.
  // Template payload construído server-side.
  // components: incluído somente se não-vazio (L-05).
  // Template estático (sem variáveis) → components omitido, conforme contrato Meta API.
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
    // send_template_invalid_input ou código inesperado
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 19. Persistir wamid em meta_whatsapp_messages (tracking) ──────────────
  // Executado SOMENTE após Graph success confirmado.
  // Falha → sem tentativa de meta_messages (etapa 20 não executa).
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
  // message_type='template', body=renderedBody (BODY interpolado).
  // template_name e template_language em colunas próprias.
  // HEADER e FOOTER não concatenados no body.
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
    });

  if (insertChatErr) {
    return res.status(500).json({ error: 'send_persistence_failed' });
  }

  // ── 21. Resposta sanitizada ────────────────────────────────────────────────
  // Somente message_id (wamid) retornado — nunca token, credential, recipient
  // ou payload Graph.
  return res.status(200).json({ ok: true, message_id: result.messageId });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos acima.
    return res.status(500).json({ error: 'internal_error' });
  }
}
