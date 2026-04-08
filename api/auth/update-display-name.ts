// =====================================================
// POST /api/auth/update-display-name
//
// Atualiza user_metadata.display_name de um usuário alvo.
// Requer: caller autenticado, role admin+ na empresa, target na mesma empresa.
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ADMIN_ROLES = ['super_admin', 'system_admin', 'admin'];

async function assertCompanyAdmin(
  req: any,
  companyId: string,
  targetUserId: string
): Promise<
  | { ok: true; callerId: string }
  | { ok: false; status: 401 | 403; message: string }
> {
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    '';

  const authHeader = req.headers?.authorization;
  if (!authHeader || !String(authHeader).startsWith('Bearer ') || !anonKey) {
    return { ok: false, status: 401, message: 'Autenticação necessária' };
  }

  // Valida JWT via cliente com anon key + token do usuário
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: String(authHeader) } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: { user: caller }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !caller) {
    return { ok: false, status: 401, message: 'Sessão inválida ou expirada' };
  }

  // Verifica se o caller tem role admin+ nesta empresa
  const { data: callerMembership } = await callerClient
    .from('company_users')
    .select('role')
    .eq('user_id', caller.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!callerMembership) {
    return { ok: false, status: 403, message: 'Acesso negado' };
  }

  if (!ADMIN_ROLES.includes(callerMembership.role)) {
    return { ok: false, status: 403, message: 'Permissão insuficiente' };
  }

  // Verifica que o target pertence à mesma empresa (anti cross-tenant)
  const { data: targetMembership } = await supabaseAdmin
    .from('company_users')
    .select('user_id')
    .eq('user_id', targetUserId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (!targetMembership) {
    return { ok: false, status: 403, message: 'Usuário alvo não pertence a esta empresa' };
  }

  return { ok: true, callerId: caller.id };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { targetUserId, displayName, companyId } = req.body;

    if (!targetUserId || !displayName?.trim() || !companyId) {
      return res.status(400).json({ error: 'targetUserId, displayName e companyId são obrigatórios' });
    }

    if (!serviceRoleKey) {
      return res.status(500).json({ error: 'Service Role Key não configurada no servidor' });
    }

    const auth = await assertCompanyAdmin(req, companyId, targetUserId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.message });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      user_metadata: {
        display_name: displayName.trim(),
        name: displayName.trim()
      }
    });

    if (error) {
      console.error('update-display-name: updateUserById error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('update-display-name: Unexpected error:', error);
    return res.status(500).json({ error: error.message || 'Erro desconhecido' });
  }
}
