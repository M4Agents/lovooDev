// =====================================================
// API ROUTE SERVER-SIDE - CONFIRMAR USUÁRIO MANUALMENTE
// =====================================================
// Fallback para quando email do Supabase não chegar
// Admin pode confirmar usuário manualmente

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
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
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    if (!serviceRoleKey) {
      return res.status(500).json({ 
        error: 'Service Role Key não configurada no servidor'
      });
    }

    // Buscar usuário por email
    const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('API Route: Error listing users:', listError);
      return res.status(500).json({ error: listError.message });
    }

    const user = users.users.find(u => u.email === email);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Confirmar usuário via Admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      { email_confirm: true }
    );

    if (updateError) {
      console.error('API Route: Error confirming user:', updateError);
      return res.status(400).json({ error: updateError.message });
    }

    return res.status(200).json({ 
      success: true,
      message: 'Usuário confirmado com sucesso. Ele pode usar "Esqueci minha senha" para definir senha.'
    });

  } catch (error: any) {
    console.error('API Route: Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Erro desconhecido'
    });
  }
}
