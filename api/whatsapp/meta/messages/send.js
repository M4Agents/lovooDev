// =============================================================================
// POST /api/whatsapp/meta/messages/send
//
// Envia uma mensagem de texto WhatsApp via Meta Cloud API (MVP3D).
// Persiste a mensagem outbound tanto no tracking (meta_whatsapp_messages)
// quanto na fonte lida pelo chat (meta_messages), para exibição imediata.
//
// Contrato (MVP3D — breaking change controlado):
//   Contrato anterior MVP2 aceitava `to` (wa_id) diretamente do body.
//   Contrato MVP3D remove `to` do body e exige `conversation_id`.
//   O destinatário é derivado server-side de meta_conversations.wa_id.
//   Não há consumidores do contrato anterior além de testes manuais/E2E.
//
// Fluxo (ordem de segurança obrigatória — não alterar):
//   1.  Method guard (POST only)
//   2.  Extração de campos do body
//   3.  getSupabaseAdmin()
//   4.  validateMetaCaller() — auth + RBAC + feature flag (META_SEND_ROLES)
//   5.  Validação de contrato restante (instanceId, conversationId, message)
//   6.  Lookup de instância (company_id autorizado + deleted_at IS NULL)
//   7.  Verificação de status (connected)
//   8.  Lookup de conversa (company_id + instance_id) → deriva to
//   9.  Lookup de credencial (instance_id)
//  10.  Decrypt do token (decryptMetaToken)
//  11.  Envio via sendTextMessage (primitive isolado)
//  12.  Persistência em meta_whatsapp_messages (tracking/status webhook)
//  13.  Persistência em meta_messages (chat — fonte lida pelo GET messages)
//  14.  Resposta sanitizada
//
// Persistência (etapas 12–13):
//   Ambos os INSERTs ocorrem somente após Graph success confirmado.
//   Ordem: meta_whatsapp_messages primeiro (tracking), depois meta_messages.
//   Se meta_whatsapp_messages falhar: 500 send_persistence_failed (nenhum retry Graph,
//     nenhuma tentativa de meta_messages).
//   Se meta_messages falhar após meta_whatsapp_messages: 500 send_persistence_failed
//     (Graph já executou, tracking registrado; estado de chat indeterminado).
//   Não existe atomicidade entre as duas gravações — documentado intencionalmente.
//   Unique violation (23505) → mesmo tratamento: 500 send_persistence_failed.
//   Nenhum retry de Graph após wamid obtido.
//
// Segurança:
//   - company_id do body identifica o tenant solicitado — não autoriza acesso.
//     Autorização real via validateMetaCaller; lookups usam auth.companyId.
//   - instance_id do body nunca determina phone_number_id; este vem do banco.
//   - to (wa_id) nunca aceito do body — sempre derivado de meta_conversations.
//   - phone_number_id NÃO é aceito no body — nunca usado no Graph diretamente.
//   - access_token NÃO é aceito no body — sempre obtido do banco.
//   - Plaintext do token nunca retornado, nunca logado.
//   - Erros internos nunca expõem message, stack, token, to ou body Graph.
//   - Credential lookup ocorre SOMENTE após instance válida e connected.
//   - Decrypt ocorre SOMENTE após credential válida.
//   - sendTextMessage ocorre SOMENTE após todas as validações.
//   - Lookup de instance cross-tenant não é realizado (resposta genérica 404).
//   - Lookup de conversation cross-tenant/cross-instance → 404 genérico.
//   - Sem fallback global de instance ou conversation.
// =============================================================================

import { getSupabaseAdmin }                     from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_SEND_ROLES }  from '../../../lib/meta-whatsapp/validateMetaCaller.js';
import { decryptMetaToken }                     from '../../../lib/meta-whatsapp/tokenCrypto.js';
import { sendTextMessage }                      from '../../../lib/meta-whatsapp/graphClient.js';

// UUID v4 básico — mesma regex de validateMetaCaller.js.
// Rejeita inputs obviamente inválidos antes de qualquer query no banco.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Extrair campos do body ──────────────────────────────────────────────
  // Destructuring com fallback seguro — body pode ser undefined (bodyParser off etc.)
  // Campos sensíveis como phone_number_id, access_token, waba_id, to são ignorados
  // mesmo que presentes no body: não fazem parte do contrato MVP3D e nunca são usados.
  // `to` foi removido do contrato: destinatário é derivado server-side de
  // meta_conversations.wa_id (ver etapa 8).
  const {
    company_id:      companyId,
    instance_id:     instanceId,
    conversation_id: conversationId,
    message,
  } = req.body ?? {};

  // ── 3. Supabase admin client ───────────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Proteção defensiva externa — captura throws inesperados.
  // Nunca logar: Authorization, token, stack.
  try {

  // ── 4. Auth + RBAC + feature flag ─────────────────────────────────────────
  // validateMetaCaller valida (nesta ordem):
  //   Bearer → JWT → UUID format (company_id) → membership → role →
  //   partner assignment → parent/child → feature flag
  //
  // META_SEND_ROLES inclui seller — finalidade primária do CRM é envio.
  // Partner exige assignment ativo (validado internamente pelo guard).
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_SEND_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 5. Validar contrato restante (somente após auth bem-sucedida) ──────────

  // instance_id: UUID obrigatório
  if (!instanceId || !UUID_RE.test(instanceId)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // conversation_id: UUID obrigatório (MVP3D — substitui `to` do contrato MVP2)
  // O destinatário (wa_id) é derivado server-side do registro validado da conversa.
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // message.type: somente "text" suportado no MVP3D
  if (message?.type !== 'text') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // message.text.body: string não vazia
  if (typeof message?.text?.body !== 'string' || message.text.body.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // ── 6. Lookup de instância ─────────────────────────────────────────────────
  // Usa EXCLUSIVAMENTE auth.companyId — nunca req.body.company_id diretamente.
  //
  // Filtros obrigatórios:
  //   id = instanceId          → identifica a instância solicitada
  //   company_id = auth.companyId → isolamento de tenant (guard autorizado)
  //   deleted_at IS NULL       → somente instâncias ativas
  //
  // Se não encontrada (não existe, outra company, deletada): 404 genérico.
  // NÃO realizar lookup global para confirmar existência cross-tenant.
  const { data: instance, error: instErr } = await svc
    .from('meta_whatsapp_instances')
    .select('id, company_id, phone_number_id, status')
    .eq('id', instanceId)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (instErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  if (!instance) {
    // Resposta genérica — não distingue "não existe" de "outra company" de "deletada"
    return res.status(404).json({ error: 'instance_not_found' });
  }

  // ── 7. Verificar status connected ──────────────────────────────────────────
  // Somente instâncias 'connected' podem enviar mensagens.
  // Conversation lookup e credential lookup NÃO ocorrem antes desta verificação.
  if (instance.status !== 'connected') {
    return res.status(409).json({ error: 'instance_not_connected' });
  }

  // ── 8. Lookup de conversa ──────────────────────────────────────────────────
  // Somente após instance válida e connected.
  //
  // Triple-filter obrigatório:
  //   id           = conversationId     → identifica a conversa solicitada
  //   company_id   = auth.companyId     → isolamento de tenant (JWT validado)
  //   instance_id  = instance.id        → garante que a conversa pertence à
  //                                        instância já validada (sem cross-instance)
  //
  // Resposta genérica 404 para: inexistente, outro tenant, outra instance.
  // Nunca revelar se a conversa existe num tenant/instance diferente.
  //
  // wa_id derivado do registro validado — nunca aceito do body.
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
    // Resposta genérica — não distingue inexistente / outro tenant / outra instance
    return res.status(404).json({ error: 'conversation_not_found' });
  }

  // Normalizar wa_id: strip de '+' inicial (precaução defensiva), somente dígitos.
  // wa_id em meta_conversations é persistido pelo webhook inbound sem '+', mas
  // a normalização garante robustez contra dados legados ou edge cases.
  // Falha de normalização = dado corrompido no banco → 500 internal_error.
  const waIdRaw      = conversation.wa_id ?? '';
  const toNormalized = waIdRaw.startsWith('+') ? waIdRaw.slice(1) : waIdRaw;
  if (!/^[0-9]+$/.test(toNormalized) || toNormalized.length === 0) {
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 9. Lookup de credencial ────────────────────────────────────────────────
  // Somente após instance válida e connected.
  // Seleciona somente access_token_enc — nunca campos desnecessários.
  const { data: credential, error: credErr } = await svc
    .from('meta_whatsapp_credentials')
    .select('access_token_enc')
    .eq('instance_id', instance.id)
    .maybeSingle();

  if (credErr || !credential?.access_token_enc) {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 10. Decrypt do token ───────────────────────────────────────────────────
  // Somente após credential confirmada.
  // Falhas de decrypt (missing, corrupto, crypto failure) → resposta genérica.
  // Externamente: não distinguir entre os casos (previne oracle attacks).
  let plainToken;
  try {
    plainToken = decryptMetaToken(credential.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 11. Envio via primitive ────────────────────────────────────────────────
  // phone_number_id vem EXCLUSIVAMENTE de instance.phone_number_id (banco).
  // access_token é plainToken (decriptado) — nunca do body.
  // toNormalized derivado de conversation.wa_id (banco) — nunca do body.
  let result;
  try {
    result = await sendTextMessage(
      plainToken,
      instance.phone_number_id,
      toNormalized,
      message.text.body,
    );
  } catch (err) {
    const code = err?.code;
    if (code === 'send_invalid_input') {
      return res.status(400).json({ error: 'invalid_message' });
    }
    if (code === 'send_timeout' || code === 'send_network_error') {
      return res.status(503).json({ error: 'provider_unavailable' });
    }
    if (code === 'send_failed' || code === 'send_invalid_response') {
      return res.status(502).json({ error: 'provider_error' });
    }
    // Código desconhecido ou throw inesperado do primitive
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 12. Persistir wamid em meta_whatsapp_messages (tracking outbound) ──────
  // Executado SOMENTE após Graph success confirmado.
  // INSERT explícito — sem upsert/ignoreDuplicates para observar conflitos.
  //
  // Propósito: tracking operacional (status webhook, auditoria).
  // Campos persistidos: somente company_id, instance_id, meta_message_id, status.
  // NÃO persistir: to, message body, token, phone_number_id, Graph payload.
  //
  // Unique violation (23505) → send_persistence_failed (estado indeterminado).
  // Qualquer outro erro DB   → send_persistence_failed.
  // Nenhum retry de Graph ocorre após falha de persistência.
  // Falha aqui → sem tentativa de meta_messages (etapa 13 não executa).
  //
  // Tenant: company_id = auth.companyId (validado).
  //         instance_id = instance.id (lookup filtrado por auth.companyId).
  //         FK composta no banco adiciona segunda garantia declarativa.
  const { error: insertTrackingErr } = await svc
    .from('meta_whatsapp_messages')
    .insert({
      company_id:      auth.companyId,
      instance_id:     instance.id,
      meta_message_id: result.messageId,
      status:          'accepted',
    });

  if (insertTrackingErr) {
    // Graph já executou — estado de entrega é indeterminado localmente.
    // NÃO reenviar. NÃO expor erro bruto, wamid, telefone ou token.
    return res.status(500).json({ error: 'send_persistence_failed' });
  }

  // ── 13. Persistir mensagem outbound em meta_messages (chat) ─────────────
  // Executado SOMENTE após Graph success E meta_whatsapp_messages success.
  // Permite que GET /conversations/:id/messages retorne a mensagem enviada.
  //
  // Campos obrigatórios conforme schema:
  //   company_id      = auth.companyId (validado)
  //   conversation_id = conversation.id (lookup com triple-filter)
  //   instance_id     = instance.id (lookup filtrado por auth.companyId)
  //   meta_message_id = result.messageId (wamid do Graph)
  //   direction       = 'outbound'
  //   message_type    = 'text'
  //   body            = message.text.body.trim()
  //   provider_timestamp = now() — Meta não retorna timestamp na resposta de envio;
  //                        valor serve como âncora de ordenação cronológica.
  //
  // FK tripla composta (company_id, instance_id, conversation_id) →
  //   meta_conversations(company_id, instance_id, id): garantia declarativa
  //   de que a mensagem pertence ao tenant+instância+conversa corretos.
  //
  // Unique (instance_id, meta_message_id): impede duplicação de wamid.
  // Falha → 500 send_persistence_failed (Graph e tracking já executaram).
  const bodyTrimmed = message.text.body.trim();
  const { error: insertChatErr } = await svc
    .from('meta_messages')
    .insert({
      company_id:        auth.companyId,
      conversation_id:   conversation.id,
      instance_id:       instance.id,
      meta_message_id:   result.messageId,
      direction:         'outbound',
      message_type:      'text',
      body:              bodyTrimmed,
      provider_timestamp: new Date().toISOString(),
    });

  if (insertChatErr) {
    // Graph executou + tracking inserido; estado de chat indeterminado.
    // NÃO reenviar. NÃO expor erro bruto, wamid, conversa ou token.
    return res.status(500).json({ error: 'send_persistence_failed' });
  }

  // ── 14. Resposta sanitizada ───────────────────────────────────────────────
  // Somente message_id (wamid) retornado — nunca token, credencial ou payload Graph.
  return res.status(200).json({ ok: true, message_id: result.messageId });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos acima.
    // Nunca retornar err.message, err.code, stack ou qualquer detalhe de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
