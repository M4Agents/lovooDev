// =====================================================
// POST /api/auth/change-password
//
// Altera a senha de um usuário alvo via Admin API.
// Suporta senha temporária com flag must_change_password.
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

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: String(authHeader) } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: { user: caller }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !caller) {
    return { ok: false, status: 401, message: 'Sessão inválida ou expirada' };
  }

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

  const { data: targetMembership } = await supabaseAdmin
    .from('company_users')
    .select('user_id')
    .eq('user_id', targetUserId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (!targetMembership) {
    return { ok: false, status: 403, message: 'Usuário alvo não pertence a esta empresa ou está inativo' };
  }

  return { ok: true, callerId: caller.id };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { targetUserId, newPassword, companyId, forcePasswordChange } = req.body;

    if (!targetUserId || !newPassword || !companyId) {
      return res.status(400).json({ error: 'targetUserId, newPassword e companyId são obrigatórios' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    if (!serviceRoleKey) {
      return res.status(500).json({ error: 'Service Role Key não configurada no servidor' });
    }

    const auth = await assertCompanyAdmin(req, companyId, targetUserId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.message });
    }

    const now = new Date().toISOString();
    const metadata = {
      password_changed_at: now,
      password_changed_by: auth.callerId,
      password_type: forcePasswordChange ? 'temporary' : 'permanent',
      must_change_password: !!forcePasswordChange,
      password_expires_at: forcePasswordChange
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null
    };

    const { error } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: newPassword,
      app_metadata: metadata
    });

    if (error) {
      console.error('change-password: updateUserById error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('change-password: Unexpected error:', error);
    return res.status(500).json({ error: error.message || 'Erro desconhecido' });
  }
}
