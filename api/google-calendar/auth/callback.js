import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    // Configuração OAuth2
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'https://lovoo-dev.vercel.app/api/google-calendar/auth/callback'
    );

    // Trocar código por tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log('✅ Tokens obtidos do Google:', {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expiry_date
    });

    // Obter informações do usuário
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    console.log('✅ Informações do usuário:', {
      email: userInfo.email,
      id: userInfo.id
    });

    // Obter user_id e company_id do header de autenticação
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('❌ Auth error:', authError);
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Buscar company_id do usuário
    const { data: companyUser, error: companyError } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (companyError || !companyUser) {
      console.error('❌ Company not found:', companyError);
      return res.status(404).json({ error: 'Company not found' });
    }

    // Calcular data de expiração do token
    const tokenExpiresAt = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

    // Salvar conexão no banco
    const { data: connection, error: saveError } = await supabase
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
      return res.status(500).json({ error: 'Failed to save connection' });
    }

    console.log('✅ Conexão Google Calendar salva:', connection.id);

    // TODO: Iniciar webhook watch (FASE 3)
    // await setupWebhookWatch(oauth2Client, connection.id);

    // Redirecionar de volta para o calendário com sucesso
    res.redirect('/calendar?google_connected=true');

  } catch (error) {
    console.error('❌ Error in Google OAuth callback:', error);
    res.status(500).json({ 
      error: 'Failed to complete authorization',
      details: error.message 
    });
  }
}
