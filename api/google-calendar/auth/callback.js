import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, state } = req.query;

  // Verificar se houve erro na autorização
  if (error) {
    console.error('❌ Google OAuth error:', error);
    return res.redirect(`/calendar?google_error=${encodeURIComponent(error)}`);
  }

  // Verificar se recebeu o código
  if (!code) {
    return res.status(400).json({ error: 'Authorization code not provided' });
  }

  try {
    // Validar variáveis de ambiente obrigatórias
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
      console.error('❌ Missing required Google OAuth environment variables');
      return res.status(500).json({ 
        error: 'Google Calendar integration not configured. Please contact administrator.' 
      });
    }

    // Configuração OAuth2
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Trocar código por tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log('✅ Tokens obtidos do Google:', {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expiry_date
    });

    // Obter informações do usuário Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    console.log('✅ Informações do usuário Google:', {
      email: userInfo.email,
      id: userInfo.id
    });

    // Criar cliente Supabase com Service Role para admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar usuário pelo email usando Service Role
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Error listing users:', listError);
      return res.redirect('/calendar?google_error=auth_failed');
    }

    // Encontrar usuário com o email do Google
    const user = users?.find(u => u.email === userInfo.email);
    
    if (!user) {
      console.error('❌ User not found with email:', userInfo.email);
      return res.redirect('/calendar?google_error=user_not_found');
    }

    console.log('✅ Usuário Supabase encontrado:', user.id);

    // Buscar company_id do usuário usando supabaseAdmin
    const { data: companyUser, error: companyError } = await supabaseAdmin
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (companyError || !companyUser) {
      console.error('❌ Company not found:', companyError);
      return res.redirect('/calendar?google_error=company_not_found');
    }

    console.log('✅ Company encontrada:', companyUser.company_id);

    // Calcular data de expiração do token
    const tokenExpiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

    // Salvar conexão no banco usando supabaseAdmin
    const { data: connection, error: saveError } = await supabaseAdmin
      .from('google_calendar_connections')
      .upsert({
        user_id: user.id,
        company_id: companyUser.company_id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokenExpiresAt.toISOString(),
        google_email: userInfo.email,
        google_calendar_id: 'primary',
        is_active: true,
        sync_enabled: true,
        last_sync_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (saveError) {
      console.error('❌ Error saving connection:', saveError);
      return res.redirect('/calendar?google_error=save_failed');
    }

    console.log('✅ Conexão Google Calendar salva:', connection.id);

    // TODO: Iniciar webhook watch (FASE 3)
    // await setupWebhookWatch(oauth2Client, connection.id);

    // Redirecionar de volta para o calendário com sucesso
    res.redirect('/calendar?google_connected=true');

  } catch (error) {
    console.error('❌ Error in Google OAuth callback:', error);
    res.redirect(`/calendar?google_error=${encodeURIComponent(error.message)}`);
  }
}
