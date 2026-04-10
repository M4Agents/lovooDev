// =============================================================================
// POST /api/ai/policies/update
//
// Cria ou atualiza a policy global de governança de IA da empresa-pai.
//
// AUTENTICAÇÃO: JWT + role super_admin + company_type = 'parent'
// UPSERT: se já existe policy ativa → UPDATE; caso contrário → INSERT
// ACESSO: exclusivo da empresa-pai — empresas filhas são bloqueadas na validação
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://etzdsywunlpbgxkphuil.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── Validação de caller (JWT + super_admin + company_type='parent') ───────────

async function validateSaaSAdmin(req, companyId) {
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const authHeader = req.headers?.authorization;

  if (!authHeader || !String(authHeader).startsWith('Bearer ') || !anonKey) {
    return { ok: false, status: 401, error: 'Autenticação necessária' };
  }

  const callerClient = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: String(authHeader) } },
    auth:   { persistSession: false, autoRefreshToken: false }
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  const { data: membership } = await callerClient
    .from('company_users')
    .select('role, company_id')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!membership) {
    return { ok: false, status: 403, error: 'Acesso negado à empresa' };
  }

  if (membership.role !== 'super_admin') {
    return { ok: false, status: 403, error: 'Acesso restrito a super_admin.' };
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('company_type')
    .eq('id', companyId)
    .maybeSingle();

  if (!company || company.company_type !== 'parent') {
    return { ok: false, status: 403, error: 'Acesso restrito à empresa-pai.' };
  }

  return { ok: true, callerId: user.id, callerCompanyId: companyId };
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use POST.' });
  }
  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ success: false, error: 'Configuração interna inválida.' });
  }

  const { company_id, content } = req.body ?? {};

  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  const trimmedContent = typeof content === 'string' ? content.trim() : '';
  if (!trimmedContent) {
    return res.status(400).json({ success: false, error: 'content é obrigatório e não pode estar vazio.' });
  }

  const auth = await validateSaaSAdmin(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── Upsert: verifica policy ativa existente ───────────────────────────────
  // Sempre filtra por company_id explícito — nunca depende de "única policy global".

  const { data: existing } = await supabaseAdmin
    .from('ai_system_policies')
    .select('id')
    .eq('company_id', auth.callerCompanyId)
    .eq('is_active', true)
    .maybeSingle();

  let policy;
  let dbErr;

  if (existing) {
    // UPDATE da policy existente
    const { data, error } = await supabaseAdmin
      .from('ai_system_policies')
      .update({ content: trimmedContent })
      .eq('id', existing.id)
      .eq('company_id', auth.callerCompanyId)  // proteção extra
      .select('id, is_active, created_at, updated_at')
      .single();

    policy = data;
    dbErr  = error;
  } else {
    // INSERT: primeira policy da empresa-pai
    const { data, error } = await supabaseAdmin
      .from('ai_system_policies')
      .insert({
        company_id: auth.callerCompanyId,
        content:    trimmedContent,
        is_active:  true
      })
      .select('id, is_active, created_at, updated_at')
      .single();

    policy = data;
    dbErr  = error;
  }

  if (dbErr) {
    console.error('[ai/policies-update] Erro ao salvar policy:', dbErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao salvar diretrizes.' });
  }

  console.log('[ai/policies-update] Policy atualizada:', {
    policy_id:  policy.id,
    company_id: auth.callerCompanyId,
    by:         auth.callerId,
    operation:  existing ? 'update' : 'insert'
    // NÃO logar o conteúdo da policy
  });

  // Retornar metadados — nunca retornar o content na response de atualização
  // (já está no frontend após o save, não precisa ser reemitido)
  return res.status(200).json({
    success: true,
    data: {
      id:         policy.id,
      is_active:  policy.is_active,
      created_at: policy.created_at,
      updated_at: policy.updated_at
    }
  });
}
