// =====================================================
// API ROUTE SERVER-SIDE - GERAR MAGIC LINK MANUAL
// =====================================================
// Fallback para quando email do Supabase não chegar
// Admin pode gerar link manualmente e enviar via WhatsApp/Telegram

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

    // Gerar magic link via Admin API
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: 'https://app.lovoocrm.com/accept-invite'
      }
    });

    if (error) {
      console.error('API Route: Error generating magic link:', error);
      return res.status(400).json({ error: error.message });
    }

    // Retornar link seguro do Supabase
    return res.status(200).json({ 
      success: true, 
      magicLink: data.properties.action_link,
      expiresIn: 3600 // 1 hora em segundos
    });

  } catch (error: any) {
    console.error('API Route: Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Erro desconhecido'
    });
  }
}
