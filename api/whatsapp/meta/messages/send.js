// =============================================================================
// POST /api/whatsapp/meta/messages/send
//
// Envia uma mensagem de texto WhatsApp via Meta Cloud API (outbound MVP2).
//
// Fluxo (ordem de segurança obrigatória — não alterar):
//   1.  Method guard (POST only)
//   2.  Extração de campos do body
//   3.  getSupabaseAdmin()
//   4.  validateMetaCaller() — auth + RBAC + feature flag (META_SEND_ROLES)
//   5.  Validação de contrato restante (instanceId, to, message)
//   6.  Lookup de instância (company_id autorizado + deleted_at IS NULL)
//   7.  Verificação de status (connected)
//   8.  Lookup de credencial (instance_id)
//   9.  Decrypt do token (decryptMetaToken)
//  10.  Envio via sendTextMessage (primitive isolado)
//  11.  Persistência do wamid em meta_whatsapp_messages (INSERT explícito)
//  12.  Resposta sanitizada
//
// Persistência (etapa 11):
//   INSERT somente após Graph success confirmado.
//   Campos: company_id, instance_id, meta_message_id, status='accepted'.
//   Nenhum PII (to, body, token) é persistido.
//   Falha de INSERT → 500 send_persistence_failed (Graph já executou).
//   Unique violation (23505) → mesmo tratamento: 500 send_persistence_failed.
//   Nenhum retry de Graph após falha de persistência.
//
// OPEN_DESIGN_ITEM_2C4 — Race webhook vs INSERT:
//   Graph success → webhook status potencialmente chega antes do INSERT local.
//   Decisão sobre wamid desconhecido no webhook (200 ou 5xx/pending) será
//   tomada em 2C.4 após análise específica do webhook processor.
//
// Segurança:
//   - company_id do body identifica o tenant solicitado — não autoriza acesso.
//     Autorização real via validateMetaCaller; lookups usam auth.companyId.
//   - instance_id do body nunca determina phone_number_id; este vem do banco.
//   - phone_number_id NÃO é aceito no body — nunca usado no Graph diretamente.
//   - access_token NÃO é aceito no body — sempre obtido do banco.
//   - Plaintext do token nunca retornado, nunca logado.
//   - Erros internos nunca expõem message, stack, token, to ou body Graph.
//   - Credential lookup ocorre SOMENTE após instance válida e connected.
//   - Decrypt ocorre SOMENTE após credential válida.
//   - sendTextMessage ocorre SOMENTE após todas as validações.
//   - Lookup de instance cross-tenant não é realizado (resposta genérica 404).
//   - Sem fallback global de instance — query sempre inclui auth.companyId.
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
  // Campos sensíveis como phone_number_id, access_token, waba_id são ignorados
  // mesmo que presentes no body: não fazem parte do contrato e nunca são usados.
  const {
    company_id:  companyId,
    instance_id: instanceId,
    to:          toRaw,
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

  // to: string não vazia, normalizar strip de '+' inicial, somente dígitos
  // Espaços, parênteses, hífens são rejeitados — não normalizados silenciosamente.
  if (typeof toRaw !== 'string' || toRaw.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const toTrimmed    = toRaw.trim();
  const toNormalized = toTrimmed.startsWith('+') ? toTrimmed.slice(1) : toTrimmed;
  if (!/^[0-9]+$/.test(toNormalized)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // message.type: somente "text" suportado no MVP2
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
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 9. Decrypt do token ────────────────────────────────────────────────────
  // Somente após credential confirmada.
  // Falhas de decrypt (missing, corrupto, crypto failure) → resposta genérica.
  // Externamente: não distinguir entre os casos (previne oracle attacks).
  let plainToken;
  try {
    plainToken = decryptMetaToken(credential.access_token_enc);
  } catch {
    return res.status(500).json({ error: 'credential_unavailable' });
  }

  // ── 10. Envio via primitive ────────────────────────────────────────────────
  // phone_number_id vem EXCLUSIVAMENTE de instance.phone_number_id (banco).
  // access_token é plainToken (decriptado) — nunca do body.
  // toNormalized já foi validado e normalizado acima.
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

  // ── 11. Persistir wamid em meta_whatsapp_messages ─────────────────────────
  // Executado SOMENTE após Graph success confirmado.
  // INSERT explícito — sem upsert/ignoreDuplicates para observar conflitos.
  //
  // Campos persistidos: somente company_id, instance_id, meta_message_id, status.
  // NÃO persistir: to, message body, token, phone_number_id, Graph payload.
  //
  // Unique violation (23505) → send_persistence_failed (estado indeterminado).
  // Qualquer outro erro DB   → send_persistence_failed.
  // Nenhum retry de Graph ocorre após falha de persistência.
  //
  // Tenant: company_id = auth.companyId (validado).
  //         instance_id = instance.id (lookup filtrado por auth.companyId).
  //         FK composta no banco adiciona segunda garantia declarativa.
  const { error: insertErr } = await svc
    .from('meta_whatsapp_messages')
    .insert({
      company_id:      auth.companyId,
      instance_id:     instance.id,
      meta_message_id: result.messageId,
      status:          'accepted',
    });

  if (insertErr) {
    // Graph já executou — estado de entrega é indeterminado localmente.
    // NÃO reenviar. NÃO expor erro bruto, wamid, telefone ou token.
    return res.status(500).json({ error: 'send_persistence_failed' });
  }

  // ── 12. Resposta sanitizada ────────────────────────────────────────────────
  // Somente message_id (wamid) retornado — nunca token, credencial ou payload Graph.
  return res.status(200).json({ ok: true, message_id: result.messageId });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos acima.
    // Nunca retornar err.message, err.code, stack ou qualquer detalhe de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
