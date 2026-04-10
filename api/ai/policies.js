// =============================================================================
// GET /api/ai/policies?company_id=<uuid>
//
// Retorna a policy global de governança de IA ativa da empresa-pai.
//
// AUTENTICAÇÃO: JWT + role super_admin + company_type = 'parent'
// ACESSO: exclusivo da empresa-pai — empresas filhas são bloqueadas na validação
// SEGURANÇA: policy nunca é enviada ao frontend de empresa filha
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

  // Validar membership ativa + role super_admin
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

  // Validar que é empresa-pai (company_type = 'parent')
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método não permitido. Use GET.' });
  }
  if (!SERVICE_ROLE_KEY) {
    return res.status(500).json({ success: false, error: 'Configuração interna inválida.' });
  }

  const company_id = req.query?.company_id;

  if (!company_id) {
    return res.status(400).json({ success: false, error: 'company_id é obrigatório.' });
  }

  const auth = await validateSaaSAdmin(req, company_id);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, error: auth.error });
  }

  // ── Buscar policy ativa da empresa-pai ────────────────────────────────────
  // Sempre filtra por company_id explícito — nunca depende de "única policy global".

  const { data: policy, error: policyErr } = await supabaseAdmin
    .from('ai_system_policies')
    .select('id, content, is_active, created_at, updated_at')
    .eq('company_id', auth.callerCompanyId)
    .eq('is_active', true)
    .maybeSingle();

  if (policyErr) {
    console.error('[ai/policies] Erro ao buscar policy:', policyErr.message);
    return res.status(500).json({ success: false, error: 'Erro ao carregar diretrizes.' });
  }

  return res.status(200).json({
    success: true,
    data:    policy ?? null   // null = nenhuma diretriz definida ainda
  });
}
