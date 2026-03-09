import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Configuração OAuth2
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'https://lovoo-dev.vercel.app/api/google-calendar/auth/callback'
    );

    // Scopes necessários para Google Calendar
    const scopes = [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    // Gerar URL de autorização
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Necessário para refresh token
      scope: scopes,
      prompt: 'consent', // Força exibição do consent screen para obter refresh token
      state: JSON.stringify({
        timestamp: Date.now(),
        // Pode adicionar user_id ou company_id aqui se necessário
      })
    });

    // Redirecionar para Google OAuth
    res.redirect(authUrl);
  } catch (error) {
    console.error('❌ Error generating Google auth URL:', error);
    res.status(500).json({ 
      error: 'Failed to generate authorization URL',
      details: error.message 
    });
  }
}
