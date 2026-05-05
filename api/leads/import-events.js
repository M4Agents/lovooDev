// =============================================================================
// GET /api/leads/import-events?company_id=<uuid>
//
// Retorna o histórico paginado de importações via API (lead_import_events).
//
// AUTENTICAÇÃO : JWT via Authorization: Bearer <token>
// AUTORIZAÇÃO  : apenas roles admin, system_admin, super_admin
// MULTI-TENANT : company_id validado contra company_users do caller (RLS ativo)
// PAGINAÇÃO    : has_more (sem COUNT(*) por página); ORDER BY created_at DESC, id DESC
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY
                  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
                  ?? '';

const ALLOWED_ROLES    = ['admin', 'system_admin', 'super_admin'];
const ALLOWED_STATUSES = ['success', 'duplicate', 'error', 'rate_limited', 'plan_limit', 'validation_error'];
const MAX_PER_PAGE     = 100;
const DEFAULT_PER_PAGE = 20;
const MAX_SEARCH_LEN   = 100;

// ── Validação de caller (JWT + membership + role) ─────────────────────────────

async function validateCaller(req, companyId) {
  const authHeader = req.headers?.authorization;

  if (!authHeader || !String(authHeader).startsWith('Bearer ') || !ANON_KEY) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: String(authHeader) } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  const { data: membership } = await callerClient
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!membership) {
    return { ok: false, status: 403, error: 'Acesso negado à empresa' };
  }

  // Validação de role no backend — espelha canViewImportHistory do frontend
  if (!ALLOWED_ROLES.includes(membership.role)) {
    return { ok: false, status: 403, error: 'Permissão insuficiente para visualizar histórico de importações' };
  }

  return { ok: true, callerId: user.id, role: membership.role, client: callerClient };
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido. Use GET.' });
  }

  const {
    company_id,
    status,
    date_from,
    date_to,
    search: rawSearch,
    page:     rawPage,
    per_page: rawPerPage,
  } = req.query;

  if (!company_id) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }

  // Autenticação + role validados no backend antes de qualquer query
  const auth = await validateCaller(req, company_id);

  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // Sanitizar e normalizar parâmetros de paginação
  const page    = Math.max(1, parseInt(rawPage, 10) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(rawPerPage, 10) || DEFAULT_PER_PAGE));
  const offset  = (page - 1) * perPage;

  // Sanitizar search: trim + limite de tamanho + escapar wildcards PostgREST
  const search = rawSearch
    ? String(rawSearch).trim().slice(0, MAX_SEARCH_LEN)
    : null;

  // Buscar perPage+1 itens para detectar has_more sem COUNT(*)
  // .range(from, to) é inclusivo nos dois extremos, então range(0,20) = 21 itens
  let query = auth.client
    .from('lead_import_events')
    .select('id, status, error_code, error_message, lead_id, payload_summary, external_reference, created_at')
    .eq('company_id', company_id)
    .order('created_at', { ascending: false })
    .order('id',         { ascending: false })
    .range(offset, offset + perPage);

  // Filtro por status (whitelist explícita)
  if (status && ALLOWED_STATUSES.includes(status)) {
    query = query.eq('status', status);
  }

  // Filtro por intervalo de datas
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to)   query = query.lte('created_at', date_to);

  // Busca parcial em payload_summary (name, email, phone)
  // Caracteres especiais do PostgREST escapados para evitar injeção de filtro
  if (search) {
    const safe = search.replace(/[*,()]/g, '');
    query = query.or(
      `payload_summary->>name.ilike.*${safe}*,` +
      `payload_summary->>email.ilike.*${safe}*,` +
      `payload_summary->>phone.ilike.*${safe}*`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error('[import-events] query error:', error.message);
    return res.status(500).json({ error: 'Erro ao buscar histórico de importações' });
  }

  // has_more: se retornou mais que perPage, há próxima página
  const hasMore = (data?.length ?? 0) > perPage;
  const items   = hasMore ? data.slice(0, perPage) : (data ?? []);

  return res.status(200).json({
    data: items,
    pagination: {
      page,
      per_page: perPage,
      has_more: hasMore,
    },
  });

}
