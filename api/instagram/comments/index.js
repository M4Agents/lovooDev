// =============================================================================
// GET /api/instagram/comments
//
// Lista comentários Instagram de uma empresa com filtros e paginação.
//
// Query params:
//   company_id   — UUID da empresa (validado contra JWT membership)
//   tab          — 'comments' (todos exceto ignored) | 'pending' (somente status=pending)
//   connection_id — UUID (opcional) filtrar por conexão
//   search       — texto (opcional) busca em ig_username e content
//   limit        — número (padrão 50, máx 100)
//   offset       — número (padrão 0)
//
// SEGURANÇA:
//   - company_id validado contra JWT membership — nunca confiado diretamente
//   - Nunca retorna tokens ou dados sensíveis da conexão
// =============================================================================

import { getSupabaseAdmin }        from '../../lib/automation/supabaseAdmin.js';
import { validateInstagramCaller } from '../../lib/instagram/validateInstagramCaller.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const svc = getSupabaseAdmin();

  const {
    company_id,
    tab = 'comments',
    connection_id,
    search,
    limit: rawLimit = '50',
    offset: rawOffset = '0',
  } = req.query ?? {};

  if (!company_id || !UUID_REGEX.test(String(company_id))) {
    return res.status(400).json({ error: 'company_id inválido' });
  }

  const auth = await validateInstagramCaller(req, svc, company_id);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const limit  = Math.min(Math.max(parseInt(rawLimit, 10)  || 50, 1), 100);
  const offset = Math.max(parseInt(rawOffset, 10) || 0, 0);

  let query = svc
    .from('instagram_comments')
    .select('*', { count: 'exact' })
    .eq('company_id', company_id)
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  // Filtro por tab
  if (tab === 'pending') {
    query = query.eq('status', 'pending');
  } else {
    // 'comments': todos exceto ignored
    query = query.neq('status', 'ignored');
  }

  if (connection_id && UUID_REGEX.test(String(connection_id))) {
    query = query.eq('connection_id', connection_id);
  }

  if (search && typeof search === 'string' && search.trim()) {
    const s = search.trim();
    query = query.or(`ig_username.ilike.%${s}%,content.ilike.%${s}%`);
  }

  const { data: comments, error, count } = await query;

  if (error) {
    console.error('[ig/comments] erro ao buscar comentários:', error.message);
    return res.status(500).json({ error: 'Erro interno ao buscar comentários' });
  }

  return res.status(200).json({
    comments: comments ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
