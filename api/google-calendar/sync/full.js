import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { activityToGoogleEvent } from '../helpers/event-converter.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * API para sincronização completa de atividades com Google Calendar
 * Sincroniza todas as atividades pendentes do usuário
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extrair token de autenticação
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verificar usuário autenticado
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Buscar company_id do usuário
    const { data: companyUsers } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!companyUsers || companyUsers.length === 0) {
      return res.status(404).json({ error: 'Company not found for user' });
    }

    const companyId = companyUsers[0].company_id;

    // Verificar se usuário tem Google Calendar conectado
    const { data: connection } = await supabase
      .from('google_calendar_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (!connection) {
      return res.status(404).json({ 
        error: 'Google Calendar not connected',
        message: 'Conecte sua conta do Google Calendar primeiro'
      });
    }

    // Configurar OAuth2 Client
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

    // Buscar atividades pendentes de sincronização
    // (atividades com sync_to_google = true mas sem google_event_id)
    const { data: pendingActivities, error: activitiesError } = await supabase
      .from('lead_activities')
      .select('*, lead:leads(*)')
      .eq('company_id', companyId)
      .eq('owner_user_id', user.id)
      .eq('sync_to_google', true)
      .is('google_event_id', null)
      .order('scheduled_date', { ascending: true })
      .limit(50); // Limitar a 50 atividades por vez

    if (activitiesError) {
      throw activitiesError;
    }

    // Processar cada atividade pendente
    let syncedCount = 0;
    let failedCount = 0;
    const errors = [];

    for (const activity of pendingActivities || []) {
      try {
        // Criar evento no Google Calendar
        const { data: event } = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: activityToGoogleEvent(activity)
        });

        // Atualizar atividade com google_event_id
        await supabase
          .from('lead_activities')
          .update({ 
            google_event_id: event.id, 
            last_synced_at: new Date().toISOString() 
          })
          .eq('id', activity.id);

        syncedCount++;
      } catch (error) {
        failedCount++;
        errors.push({
          activity_id: activity.id,
          title: activity.title,
          error: error.message
        });
        console.error(`Failed to sync activity ${activity.id}:`, error);
      }
    }

    return res.json({
      success: true,
      message: 'Sincronização concluída',
      pending_count: pendingActivities?.length || 0,
      synced_count: syncedCount,
      failed_count: failedCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error in full sync:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
