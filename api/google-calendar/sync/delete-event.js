import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { google_event_id, owner_user_id } = req.body;
    
    if (!google_event_id) {
      return res.status(400).json({ error: 'google_event_id required' });
    }
    
    if (!owner_user_id) {
      return res.status(400).json({ error: 'owner_user_id required' });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar conexão do Google Calendar do usuário
    const { data: connection } = await supabaseAdmin
      .from('google_calendar_connections')
      .select('*')
      .eq('user_id', owner_user_id)
      .eq('is_active', true)
      .single();

    if (!connection) {
      return res.status(400).json({ error: 'Google Calendar not connected' });
    }

    // Configurar OAuth2
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: connection.access_token,
      refresh_token: connection.refresh_token
    });

    // Deletar evento do Google Calendar
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: google_event_id
    });

    return res.json({ 
      success: true, 
      message: 'Event deleted from Google Calendar' 
    });
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({ 
      error: error.message,
      details: 'Failed to delete event from Google Calendar'
    });
  }
}
