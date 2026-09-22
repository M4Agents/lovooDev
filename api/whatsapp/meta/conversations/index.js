// =============================================================================
// GET /api/whatsapp/meta/conversations
//
// Lista conversas Meta WhatsApp de uma empresa com filtros opcionais.
//
// Query params:
//   company_id   (string, obrigatório)
//   instance_id  (UUID, opcional) — filtrar por instância específica
//   filter       (string, opcional) — all | unread (padrão: all)
//   limit        (integer, opcional) — padrão 50, máximo 100
//
// Fluxo de segurança (ordem obrigatória — não alterar):
//   1. Method guard (GET only)
//   2. Validar presença de company_id — sem DB
//   3. Validar formato de instance_id, se fornecido — sem DB
//   4. Validar filter/limit — sem DB
//   5. getSupabaseAdmin()
//   6. validateMetaCaller() — auth + RBAC + feature flag
//   7. [somente após auth.ok] Validar instância dentro do tenant
//   8. Query meta_conversations com auth.companyId
//
// Segurança:
//   - company_id da query identifica o tenant — nunca autoriza acesso
//   - Toda query usa auth.companyId (validado pelo guard) — nunca req.query.*
//   - instance_id validado contra auth.companyId + deleted_at IS NULL
//     antes de ser usado em filtro — impede cross-tenant por UUID
//   - Resposta nunca contém company_id
//   - Nenhum dado de credencial ou secret consultado
//   - Erros internos nunca refletem detalhes de infra ao caller
//   - Zero logging de Authorization, token ou stack
//
// RBAC:
//   - META_VIEW_ROLES (super_admin, system_admin, partner, admin, manager, seller)
//   - Partner: exige assignment ativo (validado pelo guard)
//   - Parent → child: somente super_admin/system_admin do parent correto
//
// Lista vazia é estado válido:
//   Empresa ativa sem conversas ainda → 200 { conversations: [] }
// =============================================================================

import { getSupabaseAdmin }                   from '../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_VIEW_ROLES } from '../../../lib/meta-whatsapp/validateMetaCaller.js';

// UUID v4 básico — rejeita inputs obviamente inválidos antes de qualquer query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Filtros suportados nesta fase.
const ALLOWED_FILTERS = new Set(['all', 'unread']);

// Limite máximo de conversas por request.
const LIMIT_MAX     = 100;
const LIMIT_DEFAULT = 50;

// Campos públicos retornados ao frontend.
// Nunca incluir: company_id, deleted_at.
const PUBLIC_FIELDS = [
  'id',
  'instance_id',
  'wa_id',
  'contact_name',
  'status',
  'unread_count',
  'last_message_at',
  'last_message_preview',
  'created_at',
  'updated_at',
].join(', ');

export default async function handler(req, res) {
  // ── 1. Method guard ────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 2. Validar presença de company_id (sem DB) ─────────────────────────────
  const companyId   = req.query?.company_id;
  const instanceId  = req.query?.instance_id;
  const filterParam = req.query?.filter;
  const limitParam  = req.query?.limit;

  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  // ── 3. Validar formato de instance_id (sem DB) ─────────────────────────────
  if (instanceId !== undefined && !UUID_RE.test(instanceId)) {
    return res.status(400).json({ error: 'instance_id inválido' });
  }

  // ── 4. Validar filter e limit (sem DB) ────────────────────────────────────
  const filterType = filterParam === undefined ? 'all' : filterParam;
  if (!ALLOWED_FILTERS.has(filterType)) {
    return res.status(400).json({ error: 'filter inválido — valores aceitos: all, unread' });
  }

  // limit: se fornecido deve ser inteiro >= 1; clamp no máximo.
  let safeLimit = LIMIT_DEFAULT;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== limitParam) {
      return res.status(400).json({ error: 'limit inválido — deve ser inteiro positivo' });
    }
    safeLimit = Math.min(parsed, LIMIT_MAX);
  }

  // ── 5. Supabase admin client ───────────────────────────────────────────────
  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json({ error: 'internal_error' });
  }

  // Proteção defensiva externa — captura throws inesperados.
  // Nunca logar: Authorization, token, stack.
  try {

  // ── 6. Auth + RBAC + feature flag ─────────────────────────────────────────
  // validateMetaCaller valida (nesta ordem):
  //   Bearer → JWT → UUID format → membership → role → partner → parent → flag
  const auth = await validateMetaCaller(req, svc, companyId, { roles: META_VIEW_ROLES });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // ── 7. Validar instance_id dentro do tenant autorizado ───────────────────
  // Executado somente após auth.ok — usa auth.companyId (nunca req.query).
  // Resposta 404 idêntica para: inexistente, de outro tenant, ou soft-deleted.
  // Isso evita exposição de que o UUID pertence a outra empresa.
  if (instanceId) {
    const { data: inst, error: instErr } = await svc
      .from('meta_whatsapp_instances')
      .select('id')
      .eq('id', instanceId)
      .eq('company_id', auth.companyId)
      .is('deleted_at', null)
      .maybeSingle();

    if (instErr) {
      return res.status(500).json({ error: 'internal_error' });
    }

    if (!inst) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }
  }

  // ── 8. Query meta_conversations ───────────────────────────────────────────
  // auth.companyId garantido pelo guard — nunca usar req.query.company_id.
  // SELECT explícito: nunca SELECT *.
  // Filtros obrigatórios: company_id + status=active.
  // limit() aplicado por último — filtros condicionais são adicionados antes
  // para garantir que o chain Supabase receba todos os filtros antes de resolver.
  let query = svc
    .from('meta_conversations')
    .select(PUBLIC_FIELDS)
    .eq('company_id', auth.companyId)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false, nullsLast: true });

  if (instanceId) {
    query = query.eq('instance_id', instanceId);
  }

  if (filterType === 'unread') {
    query = query.gt('unread_count', 0);
  }

  const { data: conversations, error: queryErr } = await query.limit(safeLimit);

  if (queryErr) {
    return res.status(500).json({ error: 'internal_error' });
  }

  // ── 9. Enriquecer com foto do contato (best-effort) ───────────────────────
  // Fonte: chat_contacts.profile_picture_url (mesma company_id, match por telefone).
  // Estratégia V1: match direto por dígitos puros — wa_id e phone_number ambos em
  //   formato E.164 sem '+' no ambiente atual.
  // Graceful degradation: erro na query retorna profile_picture_url: null para todas
  //   as conversations — não cancela a resposta.
  // Segurança: company_id vem exclusivamente de auth.companyId. Nunca lookup global.
  // Zero N+1: uma única query batch via .in().
  let enriched = conversations ?? [];

  if (enriched.length > 0) {
    // Deduplica wa_ids antes do .in() — evita parâmetros redundantes.
    const waIds = [...new Set(enriched.map(c => c.wa_id))];

    const { data: contacts, error: contactsErr } = await svc
      .from('chat_contacts')
      .select('phone_number, profile_picture_url')
      .eq('company_id', auth.companyId)
      .in('phone_number', waIds);

    if (contactsErr) {
      // Log sanitizado — sem PII (telefone, URL).
      console.error('[meta/conversations] contacts_photo_lookup_failed');
      // Continua: conversations retornam sem foto (profile_picture_url: null).
    }

    // Mapeia phone_number → URL estável. Ignora entradas sem URL.
    const photoMap = new Map(
      (contacts ?? [])
        .filter(c => c.profile_picture_url)
        .map(c => [c.phone_number, c.profile_picture_url])
    );

    enriched = enriched.map(c => ({
      ...c,
      profile_picture_url: photoMap.get(c.wa_id) ?? null,
    }));
  }

  // Lista vazia é estado válido — empresa ativa sem conversas ainda.
  return res.status(200).json({ conversations: enriched });

  } catch {
    // Catch defensivo externo — throws inesperados não cobertos acima.
    // Nunca retornar err.message, err.code, stack ou detalhes de infra.
    return res.status(500).json({ error: 'internal_error' });
  }
}
