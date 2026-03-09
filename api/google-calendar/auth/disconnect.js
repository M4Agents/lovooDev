import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Obter user_id do header de autenticação
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Buscar conexão existente
    const { data: connection, error: fetchError } = await supabase
      .from('google_calendar_connections')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (fetchError || !connection) {
      return res.status(404).json({ error: 'Google Calendar connection not found' });
    }

    // Parar webhook se existir
    if (connection.channel_id && connection.channel_resource_id) {
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );

        oauth2Client.setCredentials({
          access_token: connection.access_token,
          refresh_token: connection.refresh_token
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        await calendar.channels.stop({
          requestBody: {
            id: connection.channel_id,
            resourceId: connection.channel_resource_id
          }
        });

        console.log('✅ Webhook channel stopped:', connection.channel_id);
      } catch (error) {
        console.error('⚠️ Error stopping webhook (continuing anyway):', error.message);
      }
    }

    // Revogar token do Google
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      await oauth2Client.revokeToken(connection.access_token);
      console.log('✅ Google token revoked');
    } catch (error) {
      console.error('⚠️ Error revoking token (continuing anyway):', error.message);
    }

    // Deletar conexão do banco
    const { error: deleteError } = await supabase
      .from('google_calendar_connections')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('❌ Error deleting connection:', deleteError);
      return res.status(500).json({ error: 'Failed to delete connection' });
    }

    console.log('✅ Google Calendar disconnected for user:', user.id);

    res.status(200).json({ 
      success: true,
      message: 'Google Calendar disconnected successfully'
    });

  } catch (error) {
    console.error('❌ Error disconnecting Google Calendar:', error);
    res.status(500).json({ 
      error: 'Failed to disconnect Google Calendar',
      details: error.message 
    });
  }
}
