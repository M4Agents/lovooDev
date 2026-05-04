// =====================================================
// API ROUTE SERVER-SIDE - CRIAR USUÁRIO E GERAR LINK
// =====================================================
// Fluxo interno do CRM: cria conta + gera link de acesso
// 100% independente de SMTP — sem envio de email
// Admin recebe o link para compartilhar manualmente (WhatsApp, etc.)

import { createClient } from '@supabase/supabase-js';
import { getPlanLimits, assertLimitFromLoaded, PlanEnforcementError } from '../lib/plans/limitChecker.js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';

// ✅ SEGURO: Service Role Key acessada via process.env (server-side only)
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── AUTENTICAÇÃO ──────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  // ── AUTORIZAÇÃO: exige admin-level ativo em qualquer empresa ─
  const { data: membership } = await supabaseAdmin
    .from('company_users')
    .select('role')
    .eq('user_id', caller.id)
    .eq('is_active', true)
    .in('role', ['admin', 'super_admin', 'system_admin'])
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return res.status(403).json({ error: 'Sem permissão' });
  }
  // ─────────────────────────────────────────────────────────

  try {
    const { email, redirectTo, data, company_id } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    // ── ENFORCEMENT: max_users ────────────────────────────────────────────────
    // Verifica o limite de usuários ANTES de criar o auth user.
    // company_id é opcional para compatibilidade retroativa — se não fornecido,
    // o check é delegado ao RPC create_company_user_safe (gate definitivo no DB).
    if (company_id) {
      try {
        const limits = await getPlanLimits(supabaseAdmin, company_id)
        const { count: activeUsers, error: countErr } = await supabaseAdmin
          .from('company_users')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', company_id)
          .eq('is_active', true)
          .eq('is_platform_member', false)

        if (!countErr) {
          assertLimitFromLoaded(limits, 'max_users', activeUsers ?? 0)
        } else {
          console.warn('invite-user: falha ao contar usuários para check de limite:', countErr.message)
        }
      } catch (err: any) {
        if (err instanceof PlanEnforcementError) {
          return res.status(err.httpStatus).json(err.data)
        }
        // Erro inesperado no check de limite não deve bloquear o fluxo inteiro
        console.error('invite-user: erro inesperado no check de limite max_users:', err?.message)
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (!serviceRoleKey) {
      return res.status(500).json({
        error: 'Service Role Key não configurada no servidor',
        fallback: true
      });
    }

    // PASSO 1: Criar conta do usuário (sem envio de email)
    // Se o usuário já existir, seguir para geração do link mesmo assim
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: data || {}
    });

    const userAlreadyExists = createError?.message?.toLowerCase().includes('already registered') ||
                              createError?.message?.toLowerCase().includes('already been registered') ||
                              createError?.message?.toLowerCase().includes('user already exists');

    if (createError && !userAlreadyExists) {
      console.error('invite-user: createUser error:', createError.message);
      return res.status(400).json({
        error: createError.message,
        fallback: false
      });
    }

    // Variável para guardar o usuário resolvido (novo ou existente)
    let resolvedUser = userData?.user ?? null;

    if (userAlreadyExists) {
      console.warn('invite-user: User already exists, confirming email before generating magic link');

      // Buscar o usuário existente para confirmar email e retornar seus dados
      const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find((u: any) => u.email === email);

      if (existingUser && !listError) {
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
          email_confirm: true
        });
        if (updateError) {
          console.warn('invite-user: Could not confirm email for existing user:', updateError.message);
        } else {
          console.log('invite-user: Email confirmed for existing user:', existingUser.id);
        }
        // Salvar o usuário existente para retornar na resposta
        // Isso garante que userApi.ts não receba user: null e perca o inviteLink
        resolvedUser = existingUser;
      } else {
        console.warn('invite-user: Could not find existing user to confirm email:', listError?.message);
      }
    }

    // PASSO 2: Gerar link de acesso (sem enviar email)
    // Funciona tanto para usuários novos quanto para existentes (com email confirmado)
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: redirectTo || 'https://app.lovoocrm.com/accept-invite'
      }
    });

    // TODO [FASE FUTURA]: envio de email opcional
    // Se SMTP estiver configurado, enviar email com o inviteLink aqui.
    // O fluxo principal NÃO deve depender deste passo.
    // Implementar apenas após estabilizar o fluxo atual e configurar provedor (ex: Resend).

    if (linkError) {
      console.warn('invite-user: generateLink failed:', linkError.message);
      return res.status(200).json({
        success: true,
        user: resolvedUser,
        inviteLink: null,
        warning: 'Usuário criado mas não foi possível gerar o link de acesso.'
      });
    }

    return res.status(200).json({
      success: true,
      user: resolvedUser,
      inviteLink: linkData.properties.action_link,
      isExistingUser: userAlreadyExists
    });

  } catch (error: any) {
    console.error('invite-user: Unexpected error:', error);
    return res.status(500).json({
      error: error.message || 'Erro desconhecido',
      fallback: true
    });
  }
}
