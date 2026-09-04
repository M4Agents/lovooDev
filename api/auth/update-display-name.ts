// =====================================================
// POST /api/auth/update-display-name
//
// Atualiza user_metadata.display_name de um usuário alvo.
// Requer: caller autenticado, role admin+ na empresa, target na mesma empresa.
// =====================================================

import { createClient } from '@supabase/supabase-js';
import { assertMembership, getUserFromToken, extractToken } from '../lib/dashboard/auth.js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ADMIN_ROLES = ['super_admin', 'system_admin', 'admin'];

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

    // ── Autenticação do caller ────────────────────────────────────────────────
    const token = extractToken(req.headers?.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Autenticação necessária' });
    }

    const { user: caller, error: authErr } = await getUserFromToken(token);
    if (authErr || !caller) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada' });
    }

    // ── Autorização: Trilha 1 (membership direto) ou Trilha 2 (parent admin) ─
    const membership = await assertMembership(supabaseAdmin, caller.id, companyId);
    if (!membership) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (!ADMIN_ROLES.includes(membership.role)) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }

    // ── Validação do usuário alvo (anti cross-tenant) ─────────────────────────
    const { data: targetMembership } = await supabaseAdmin
      .from('company_users')
      .select('user_id')
      .eq('user_id', targetUserId)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .maybeSingle();

    if (!targetMembership) {
      return res.status(403).json({ error: 'Usuário alvo não pertence a esta empresa ou está inativo' });
    }

    // ── Atualização de display_name via Admin API ─────────────────────────────
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
