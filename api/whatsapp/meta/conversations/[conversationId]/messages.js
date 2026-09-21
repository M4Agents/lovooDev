// =============================================================================
// GET /api/whatsapp/meta/conversations/:conversationId/messages
//
// Retorna as N mensagens mais recentes de uma conversa Meta WhatsApp,
// em ordem cronológica (mais antiga → mais recente).
//
// Query params:
//   company_id      (string, obrigatório)
//   limit           (integer, opcional) — padrão 50, máximo 100
//
// Fluxo de segurança (ordem obrigatória — não alterar):
//   1. Method guard (GET only)
//   2. Extrair e validar company_id, conversationId e limit — sem DB
//   3. getSupabaseAdmin()
//   4. validateMetaCaller() — auth + RBAC + feature flag
//   5. [somente após auth.ok] Lookup de meta_conversations com auth.companyId
//   6. [somente após conversa válida] Query de meta_messages com auth.companyId
//
// Segurança:
//   - company_id da query identifica o tenant — nunca autoriza acesso diretamente
//   - PROIBIDO consultar meta_conversations antes de auth.ok
//   - Toda query usa auth.companyId (nunca req.query.company_id como filtro DB)
//   - conversation_id e instance_id na query de messages vêm do objeto DB,
//     nunca do caller — impede travessia cross-tenant via IDs injetados
//   - 404 idêntico para: inexistente, outro tenant, archived — sem oracle
//   - SELECT explícito: sem company_id, meta_message_id, updated_at, SELECT *
//   - Respostas 500 nunca expõem stack, erro bruto Supabase, PII ou credentials
//   - Zero logging de Authorization, token ou segredos
//
// RBAC:
//   - META_VIEW_ROLES (todos os roles, incluindo seller)
//   - Partner: exige assignment ativo (validado pelo guard)
//   - Parent → child: somente super_admin/system_admin do parent correto
//
// Ordenação:
//   Busca as N mensagens mais recentes (DESC) e inverte antes de retornar
//   → frontend recebe ordem cronológica (mais antiga → mais recente).
//   Tiebreaker: created_at DESC para desempate determinístico.
//
// Lista vazia:
//   Conversa ativa sem mensagens ainda → 200 { messages: [] }
// =============================================================================

import { getSupabaseAdmin }                   from '../../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_VIEW_ROLES } from '../../../../lib/meta-whatsapp/validateMetaCaller.js';

// UUID v4 básico — rejeita inputs obviamente inválidos antes de qualquer query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Limite máximo de mensagens por request.
const LIMIT_MAX     = 100;
const LIMIT_DEFAULT = 50;

// Campos públicos de meta_conversations necessários para o lookup.
// SELECT mínimo: apenas o que é usado nas queries subsequentes.
const CONV_FIELDS = 'id, instance_id';

// Campos públicos retornados ao frontend.
// Nunca incluir: company_id, meta_message_id (wamid), updated_at.
const MSG_FIELDS = [
  'id',
  'conversation_id',
  'instance_id',
  'direction',
  'message_type',
  'body',
  'provider_timestamp',
  'created_at',
].join(', ');

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Extrair e validar parâmetros (sem DB) ───────────────────────────────
  const companyId      = req.query?.company_id;
  const conversationId = req.query?.conversationId;
  const limitParam     = req.query?.limit;

  // 2a. company_id obrigatório
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  // 2b. conversationId formato UUID
  if (!conversationId || !UUID_RE.test(conversationId)) {
    return res.status(400).json({ error: 'conversationId inválido' });
  }

  // 2c. limit: inteiro >= 1; clamp no máximo
  let safeLimit = LIMIT_DEFAULT;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== limitParam) {
      return res.status(400).json({ error: 'limit inválido — deve ser inteiro positivo' });
    }
    safeLimit = Math.min(parsed, LIMIT_MAX);
  }

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
  //   Bearer → JWT → UUID format → membership → role → partner → parent → flag
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_VIEW_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 5. Conversation lookup — somente após auth.ok ─────────────────────────
  // PROIBIDO executar antes de auth. Segue padrão Meta (não o Instagram).
  // Filtros obrigatórios:
  //   id          = conversationId (do caller, já validado como UUID)
  //   company_id  = auth.companyId (nunca req.query — trava no tenant autorizado)
  //   status      = 'active'       (archived → 404, consistente com /conversations)
  //
  // Resposta 404 idêntica para: inexistente, outro tenant, archived.
  // Impede Existence Oracle: caller não distingue os três casos.
  const { data: conversation, error: convErr } = await svc
    .from('meta_conversations')
    .select(CONV_FIELDS)
    .eq('id', conversationId)
    .eq('company_id', auth.companyId)
    .eq('status', 'active')
    .maybeSingle();

  if (convErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  if (!conversation) {
    return res.status(404).json({ error: 'Conversa não encontrada' });
  }

  // ── 6. Messages query — somente após conversa validada ────────────────────
  // conversation_id e instance_id vêm do objeto DB (nunca do caller).
  // Isso garante que qualquer UUID injetado pelo caller seja substituído
  // pelo valor real pertencente ao tenant autorizado.
  //
  // Estratégia de ordenação:
  //   Busca as N mais recentes (DESC) e inverte antes de retornar.
  //   → O frontend recebe ordem cronológica (mais antiga → mais recente).
  //   Tiebreaker created_at DESC: desempate determinístico quando
  //   provider_timestamp é igual ou NULL.
  //   NULLS LAST em DESC: mensagens sem timestamp Meta ficam ao final
  //   da seleção DESC (portanto ao início após reverse — comportamento
  //   aceitável; em MVP3A todos os inbounds têm provider_timestamp).
  const { data, error: msgErr } = await svc
    .from('meta_messages')
    .select(MSG_FIELDS)
    .eq('company_id', auth.companyId)
    .eq('conversation_id', conversation.id)
    .eq('instance_id', conversation.instance_id)
    .order('provider_timestamp', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (msgErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Inverter para ordem cronológica (mais antiga → mais recente).
  // Spread para evitar mutação do array original retornado pelo Supabase.
  const messages = [...(data ?? [])].reverse();

  return res.status(200).json({ messages });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos acima.
    // Nunca retornar err.message, err.code, stack ou detalhes de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
