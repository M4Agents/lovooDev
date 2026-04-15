// GET /api/leads/:id/entries
// Lista o histórico de entradas (lead_entries) de um lead específico.
// Requer: query param company_id + autenticação via Bearer token.

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

  const leadId = req.query.id;
  const companyId = req.query.company_id;

  if (!leadId || !companyId) {
    return res.status(400).json({ error: 'Parâmetros lead id e company_id são obrigatórios' });
  }

  // Validar autenticação do usuário via JWT
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' });
  }
  const userToken = authHeader.split(' ')[1];

  // Verificar se o usuário tem acesso à empresa (membership ativo)
  const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });

  const { data: memberCheck, error: memberError } = await supabaseUser
    .rpc('auth_user_is_company_member', { p_company_id: companyId });

  if (memberError || !memberCheck) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  // Buscar entradas do lead com service_role
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Verificar se o lead existe e não está soft-deletado antes de retornar entradas
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!lead) {
    return res.status(404).json({ error: 'Lead não encontrado ou inativo' });
  }

  const { data: entries, error } = await supabase
    .from('lead_entries')
    .select('id, source, origin_channel, external_event_id, created_at, metadata')
    .eq('lead_id', leadId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/leads/:id/entries] Erro:', error.message);
    return res.status(500).json({ error: 'Erro ao buscar histórico de entradas' });
  }

  return res.status(200).json({ entries: entries || [] });
}
