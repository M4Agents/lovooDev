// GET  /api/companies/:id/lead-config — ler configuração da empresa
// PUT  /api/companies/:id/lead-config — atualizar configuração (requer admin)
// Persiste em company_lead_config. Validação de permissão: auth_user_is_company_admin.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta' });
  }

  const companyId = req.query.id;
  if (!companyId) return res.status(400).json({ error: 'company_id obrigatório' });

  // Validar autenticação
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' });
  }
  const userToken = authHeader.split(' ')[1];

  const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // --- GET: qualquer membro pode ler ---
  if (req.method === 'GET') {
    const { data: memberCheck } = await supabaseUser
      .rpc('auth_user_is_company_member', { p_company_id: companyId });

    if (!memberCheck) return res.status(403).json({ error: 'Acesso negado' });

    const { data, error } = await supabase
      .from('company_lead_config')
      .select('enabled, duplicate_lead_config, updated_at')
      .eq('company_id', companyId)
      .single();

    if (error) return res.status(500).json({ error: 'Erro ao buscar configuração' });

    return res.status(200).json({ config: data });
  }

  // --- PUT: apenas admin ---
  if (req.method === 'PUT') {
    const { data: adminCheck } = await supabaseUser
      .rpc('auth_user_is_company_admin', { p_company_id: companyId });

    if (!adminCheck) return res.status(403).json({ error: 'Permissão de administrador necessária' });

    const body = req.body;
    if (!body) return res.status(400).json({ error: 'Body obrigatório' });

    const { enabled, duplicate_lead_config } = body;

    // Validar valores permitidos
    const VALID_WON  = ['EVENT_ONLY', 'NEW_OPPORTUNITY'];
    const VALID_LOST = ['REOPEN', 'NEW_OPPORTUNITY', 'EVENT_ONLY'];
    const VALID_OPEN = ['EVENT_ONLY', 'RESET_PIPELINE', 'NEW_OPPORTUNITY', 'IGNORE'];

    if (duplicate_lead_config) {
      const { won, lost, open } = duplicate_lead_config;
      if (won  && !VALID_WON.includes(won))  return res.status(400).json({ error: `Valor inválido para won: ${won}` });
      if (lost && !VALID_LOST.includes(lost)) return res.status(400).json({ error: `Valor inválido para lost: ${lost}` });
      if (open && !VALID_OPEN.includes(open)) return res.status(400).json({ error: `Valor inválido para open: ${open}` });
    }

    const updates = {};
    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (duplicate_lead_config)        updates.duplicate_lead_config = duplicate_lead_config;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    // Upsert: garante que empresas sem registro prévio também sejam atendidas
    const { data, error } = await supabase
      .from('company_lead_config')
      .upsert({ company_id: companyId, ...updates }, { onConflict: 'company_id' })
      .select('enabled, duplicate_lead_config, updated_at')
      .single();

    if (error) {
      console.error('[PUT /api/companies/:id/lead-config] Erro:', error.message);
      return res.status(500).json({ error: 'Erro ao atualizar configuração' });
    }

    return res.status(200).json({ config: data });
  }

  return res.status(405).json({ error: 'Método não permitido' });
}
