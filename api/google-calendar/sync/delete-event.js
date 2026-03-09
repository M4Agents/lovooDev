import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { activity_id } = req.body;
    if (!activity_id) return res.status(400).json({ error: 'activity_id required' });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: activity } = await supabaseAdmin
      .from('lead_activities')
      .select('*')
      .eq('id', activity_id)
      .single();

    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (!activity.google_event_id) {
      return res.json({ success: true, message: 'Not synced to Google' });
    }

    const { data: connection } = await supabaseAdmin
      .from('google_calendar_connections')
      .select('*')
      .eq('user_id', activity.owner_user_id)
      .eq('is_active', true)
      .single();

    if (!connection) return res.status(400).json({ error: 'Not connected' });

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
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: activity.google_event_id
    });

    await supabaseAdmin
      .from('lead_activities')
      .update({ 
        google_event_id: null,
        sync_to_google: false,
        last_synced_at: null
      })
      .eq('id', activity_id);

    return res.json({ success: true, message: 'Event deleted from Google' });
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({ error: error.message });
  }
}
