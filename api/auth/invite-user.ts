// =====================================================
// API ROUTE SERVER-SIDE - CONVIDAR USUÁRIO
// =====================================================
// Esta API route usa Service Role Key de forma SEGURA (server-side only)
// Não expõe a key ao navegador

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
  // Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, redirectTo, data } = req.body;

    console.log('[DEBUG invite-user] body recebido:', {
      email,
      hasRedirectTo: !!redirectTo,
      hasData: !!data,
      dataKeys: data ? Object.keys(data) : []
    });

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    // Verificar se Service Role Key está configurada
    if (!serviceRoleKey) {
      return res.status(500).json({ 
        error: 'Service Role Key não configurada no servidor',
        fallback: true 
      });
    }

    // Convidar usuário via Admin API
    const { data: userData, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: redirectTo || 'https://app.lovoocrm.com/accept-invite',
        data: data || {}
      }
    );

    if (error) {
      console.error('[DEBUG invite-user] Supabase error bruto:', {
        message: error.message,
        status: error.status,
        name: error.name,
        code: (error as any).code,
        details: (error as any).__isAuthError ? 'AuthApiError' : typeof error
      });
      const errorMessage = error.message || `${error.name} (status: ${error.status})` || 'Erro desconhecido ao convidar usuário';
      return res.status(400).json({ 
        error: errorMessage,
        fallback: errorMessage.includes('403') || errorMessage.includes('Unauthorized')
      });
    }

    return res.status(200).json({ 
      success: true, 
      user: userData.user 
    });

  } catch (error: any) {
    console.error('API Route: Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Erro desconhecido',
      fallback: true 
    });
  }
}
