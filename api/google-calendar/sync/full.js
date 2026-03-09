import { createClient } from '@supabase/supabase-js';

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

    // Buscar atividades pendentes de sincronização
    // (atividades com sync_to_google = true mas sem google_event_id)
    const { data: pendingActivities, error: activitiesError } = await supabase
      .from('lead_activities')
      .select('id, title, scheduled_date')
      .eq('company_id', companyId)
      .eq('sync_to_google', true)
      .is('google_event_id', null)
      .order('scheduled_date', { ascending: true });

    if (activitiesError) {
      throw activitiesError;
    }

    // Por enquanto, apenas retornar sucesso
    // A sincronização real será implementada quando integrar com as APIs individuais
    return res.json({
      success: true,
      message: 'Sincronização iniciada',
      pending_count: pendingActivities?.length || 0,
      synced_count: 0,
      note: 'Sincronização manual via APIs individuais ainda não implementada. Use toggle no modal de atividades.'
    });

  } catch (error) {
    console.error('Error in full sync:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
