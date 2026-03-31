// =====================================================
// API ROUTE SERVER-SIDE - CRIAR USUÁRIO E GERAR LINK
// =====================================================
// Fluxo interno do CRM: cria conta + gera link de acesso
// 100% independente de SMTP — sem envio de email
// Admin recebe o link para compartilhar manualmente (WhatsApp, etc.)

import { createClient } from '@supabase/supabase-js';

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

  try {
    const { email, redirectTo, data } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    if (!serviceRoleKey) {
      return res.status(500).json({
        error: 'Service Role Key não configurada no servidor',
        fallback: true
      });
    }

    // PASSO 1: Criar conta do usuário (sem envio de email)
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: data || {}
    });

    if (createError) {
      console.error('invite-user: createUser error:', createError.message);
      return res.status(400).json({
        error: createError.message,
        fallback: false
      });
    }

    // PASSO 2: Gerar link de acesso (sem enviar email)
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
      // Usuário criado com sucesso, mas geração do link falhou.
      // Admin pode usar /api/auth/generate-magic-link como fallback manual.
      console.warn('invite-user: generateLink failed after createUser:', linkError.message);
      return res.status(200).json({
        success: true,
        user: userData.user,
        inviteLink: null
      });
    }

    return res.status(200).json({
      success: true,
      user: userData.user,
      inviteLink: linkData.properties.action_link
    });

  } catch (error: any) {
    console.error('invite-user: Unexpected error:', error);
    return res.status(500).json({
      error: error.message || 'Erro desconhecido',
      fallback: true
    });
  }
}
