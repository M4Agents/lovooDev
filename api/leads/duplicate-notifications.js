import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
// Usar service key para contornar RLS ao buscar leads
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0ODE5MjMwMywiZXhwIjoyMDYzNzY4MzAzfQ.nTh_suYXOLlBkVmJqOFvQWJlEfJxrJqGjNOKhBGvdBs';

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Usar service key para contornar RLS ao buscar dados dos leads
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Extrair company_id do header ou query
    const companyId = req.headers['x-company-id'] || req.query.company_id;
    
    console.log('Headers recebidos:', req.headers);
    console.log('Query params:', req.query);
    console.log('Company ID extraído:', companyId);
    
    if (!companyId) {
      console.error('Company ID não fornecido');
      return res.status(400).json({ 
        error: 'company_id é obrigatório' 
      });
    }

    if (req.method === 'GET') {
      console.log('Buscando notificações de duplicatas para empresa:', companyId);
      
      // Usar query simples e buscar leads separadamente (mais confiável)
      console.log('Buscando notificações para company_id:', companyId);
      
      const { data: notifications, error } = await supabase
        .from('duplicate_notifications')
        .select('id, lead_id, duplicate_of_lead_id, reason, created_at')
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
        
      console.log('Resultado query notificações:', { notifications, error, count: notifications?.length });
      
      // Buscar dados dos leads em uma query separada
      let enrichedNotifications = [];
      if (notifications && notifications.length > 0) {
        console.log(`Processando ${notifications.length} notificações...`);
        
        // Coletar todos os IDs únicos dos leads
        const leadIds = new Set();
        notifications.forEach(notif => {
          leadIds.add(notif.lead_id);
          leadIds.add(notif.duplicate_of_lead_id);
        });
        
        console.log('IDs dos leads para buscar:', Array.from(leadIds));
        
        // Buscar todos os leads de uma vez
        const { data: leads, error: leadsError } = await supabase
          .from('leads')
          .select('id, name, email, phone')
          .in('id', Array.from(leadIds));
          
        console.log('Leads encontrados:', { leads, leadsError, count: leads?.length });
        
        // Criar mapa de leads por ID para acesso rápido
        const leadsMap = new Map();
        if (leads) {
          leads.forEach(lead => leadsMap.set(lead.id, lead));
        }
        
        // Processar notificações com dados dos leads
        enrichedNotifications = notifications.map(notif => {
          const leadNew = leadsMap.get(notif.lead_id);
          const leadExisting = leadsMap.get(notif.duplicate_of_lead_id);
          
          // Determinar qual campo está duplicado e seu valor
          let duplicateFieldValue = '';
          let reasonLabel = '';
          
          if (notif.reason === 'phone') {
            duplicateFieldValue = leadNew?.phone || leadExisting?.phone || '';
            reasonLabel = 'Telefone';
          } else if (notif.reason === 'email') {
            duplicateFieldValue = leadNew?.email || leadExisting?.email || '';
            reasonLabel = 'Email';
          }
          
          return {
            notification_id: notif.id,
            lead_id: notif.lead_id,
            lead_name: leadNew?.name || 'Lead não encontrado',
            lead_email: leadNew?.email || '',
            lead_phone: leadNew?.phone || '',
            duplicate_of_lead_id: notif.duplicate_of_lead_id,
            duplicate_name: leadExisting?.name || 'Lead não encontrado',
            duplicate_email: leadExisting?.email || '',
            duplicate_phone: leadExisting?.phone || '',
            reason: notif.reason,
            reason_label: reasonLabel,
            duplicate_field_value: duplicateFieldValue,
            created_at: notif.created_at
          };
        });
        
        console.log(`Notificações processadas: ${enrichedNotifications.length}`);
        console.log('Primeira notificação:', enrichedNotifications[0]);
      }

      if (error) {
        console.error('Erro ao buscar notificações:', error);
        return res.status(500).json({ 
          error: 'Erro ao buscar notificações',
          details: error.message 
        });
      }

      console.log(`Encontradas ${enrichedNotifications?.length || 0} notificações pendentes`);
      
      return res.status(200).json({
        success: true,
        notifications: enrichedNotifications || [],
        count: enrichedNotifications?.length || 0
      });
    }

    if (req.method === 'PUT') {
      // Atualizar status de notificação (revisar, ignorar, etc.)
      const { notification_id, status, user_id } = req.body;
      
      if (!notification_id || !status) {
        return res.status(400).json({
          error: 'notification_id e status são obrigatórios'
        });
      }

      console.log(`Atualizando notificação ${notification_id} para status: ${status}`);

      const { data, error } = await supabase
        .from('duplicate_notifications')
        .update({
          status: status,
          reviewed_at: new Date().toISOString(),
          reviewed_by_user_id: user_id || null
        })
        .eq('id', notification_id)
        .eq('company_id', companyId);

      if (error) {
        console.error('Erro ao atualizar notificação:', error);
        return res.status(500).json({
          error: 'Erro ao atualizar notificação',
          details: error.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Notificação atualizada com sucesso'
      });
    }

    return res.status(405).json({ 
      error: 'Método não permitido' 
    });

  } catch (error) {
    console.error('Erro na API de notificações:', error);
    return res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
}
