// GET /api/leads/:id/timeline
// Timeline paginada: entradas CRM + visitas Track do visitor_id (mais recente → antigo)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta' });
  }

  const leadId = parseInt(String(req.query.id), 10);
  const companyId = req.query.company_id;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
  const offset = (page - 1) * limit;

  if (!leadId || !companyId) {
    return res.status(400).json({ error: 'Parâmetros lead id e company_id são obrigatórios' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' });
  }
  const userToken = authHeader.split(' ')[1];

  const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });

  const { data: memberCheck, error: memberError } = await supabaseUser.rpc(
    'auth_user_is_company_member',
    { p_company_id: companyId }
  );

  if (memberError || !memberCheck) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: lead } = await supabase
    .from('leads')
    .select('id, visitor_id')
    .eq('id', leadId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!lead) {
    return res.status(404).json({ error: 'Lead não encontrado ou inativo' });
  }

  const [timelineRes, totalRes, summaryRes] = await Promise.all([
    supabase.rpc('get_lead_track_timeline', {
      p_company_id: companyId,
      p_lead_id: leadId,
      p_limit: limit,
      p_offset: offset,
    }),
    supabase.rpc('get_lead_track_timeline_total', {
      p_company_id: companyId,
      p_lead_id: leadId,
    }),
    supabase.rpc('get_lead_track_timeline_summary', {
      p_company_id: companyId,
      p_lead_id: leadId,
    }),
  ]);

  if (timelineRes.error) {
    console.error('[GET /api/leads/:id/timeline] timeline error:', timelineRes.error.message);
    return res.status(500).json({ error: 'Erro ao buscar timeline' });
  }
  if (totalRes.error) {
    console.error('[GET /api/leads/:id/timeline] total error:', totalRes.error.message);
    return res.status(500).json({ error: 'Erro ao buscar total da timeline' });
  }
  if (summaryRes.error) {
    console.error('[GET /api/leads/:id/timeline] summary error:', summaryRes.error.message);
    return res.status(500).json({ error: 'Erro ao buscar resumo da timeline' });
  }

  const total = typeof totalRes.data === 'number' ? totalRes.data : Number(totalRes.data) || 0;
  const summaryRow = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
  const hasMore = offset + limit < total;

  return res.status(200).json({
    items: timelineRes.data || [],
    page,
    limit,
    offset,
    total,
    has_more: hasMore,
    summary: {
      entry_count: Number(summaryRow?.entry_count || 0),
      visit_count: Number(summaryRow?.visit_count || 0),
      visits_before_conversion: Number(summaryRow?.visits_before_conversion || 0),
      first_visit_at: summaryRow?.first_visit_at || null,
      first_entry_at: summaryRow?.first_entry_at || null,
      visitor_id: lead.visitor_id || null,
    },
  });
}
