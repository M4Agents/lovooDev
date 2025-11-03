import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

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
    console.log('=== INÍCIO DEBUG DETALHADO ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Method:', req.method);
    console.log('URL completa:', req.url);
    console.log('Headers completos:', JSON.stringify(req.headers, null, 2));
    console.log('Query params completos:', JSON.stringify(req.query, null, 2));

    console.log('=== CONEXÃO SUPABASE ===');
    console.log('Supabase URL:', supabaseUrl);
    console.log('Supabase Key (primeiros 20 chars):', supabaseKey.substring(0, 20) + '...');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Client Supabase criado com sucesso');
    
    // Extrair company_id do header ou query
    const companyId = req.headers['x-company-id'] || req.query.company_id;
    
    console.log('Company ID extraído:', companyId);
    console.log('Tipo do Company ID:', typeof companyId);
    
    if (!companyId) {
      console.error('Company ID não fornecido');
      return res.status(400).json({ 
        error: 'company_id é obrigatório' 
      });
    }

    if (req.method === 'GET') {
      console.log('Buscando notificações de duplicatas para empresa:', companyId);
      
      console.log('=== IMPLEMENTANDO FALLBACK COM QUERY DIRETA ===');
      console.log('Substituindo RPC por query SQL direta que sabemos funcionar');
      console.log('Company ID para busca:', companyId);
      
      const startTime = Date.now();
      
      // Query direta que replica a lógica da RPC
      const { data: notifications, error } = await supabase
        .from('duplicate_notifications')
        .select(`
          id,
          lead_id,
          duplicate_of_lead_id,
          reason,
          created_at,
          leads!duplicate_notifications_lead_id_fkey(id, name, email, phone),
          leads!duplicate_notifications_duplicate_of_lead_id_fkey(id, name, email, phone)
        `)
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
        
      const endTime = Date.now();
      console.log('Tempo de execução Query Direta:', endTime - startTime, 'ms');
      
      console.log('=== RESULTADO QUERY DIRETA ===');
      console.log('Error object:', error);
      console.log('Error message:', error?.message);
      console.log('Data type:', typeof notifications);
      console.log('Data is array:', Array.isArray(notifications));
      console.log('Data length:', notifications?.length);
      console.log('Data (primeiros 200 chars):', JSON.stringify(notifications)?.substring(0, 200));
      
      console.log('=== PROCESSAMENTO ===');
      console.log('Iniciando processamento de', notifications?.length || 0, 'notificações');
      
      // Processar dados da query direta
      let enrichedNotifications = [];
      if (notifications && notifications.length > 0) {
        console.log(`Processando ${notifications.length} notificações da query direta...`);
        
        // Log das primeiras notificações para debug
        notifications.slice(0, 3).forEach((notif, index) => {
          const leadNew = Array.isArray(notif.leads) ? notif.leads[0] : notif.leads;
          console.log(`Notificação ${index}:`, {
            id: notif.id,
            lead_id: notif.lead_id,
            lead_data: leadNew,
            reason: notif.reason
          });
        });
        
        enrichedNotifications = notifications.map(notif => {
          // Extrair dados dos leads (podem vir como array ou objeto)
          const leadNew = Array.isArray(notif.leads) ? notif.leads[0] : notif.leads;
          const leadExisting = Array.isArray(notif.leads) ? notif.leads[1] : null;
          
          // Se não temos o lead existente separado, vamos buscar pelos IDs
          // Por enquanto, vamos usar os dados que temos
          
          // Determinar qual campo está duplicado e seu valor
          let duplicateFieldValue = '';
          let reasonLabel = '';
          
          if (notif.reason === 'phone') {
            duplicateFieldValue = leadNew?.phone || '';
            reasonLabel = 'Telefone';
          } else if (notif.reason === 'email') {
            duplicateFieldValue = leadNew?.email || '';
            reasonLabel = 'Email';
          }
          
          return {
            notification_id: notif.id,
            lead_id: notif.lead_id,
            lead_name: leadNew?.name || 'Lead não encontrado',
            lead_email: leadNew?.email || '',
            lead_phone: leadNew?.phone || '',
            duplicate_of_lead_id: notif.duplicate_of_lead_id,
            duplicate_name: leadExisting?.name || 'Carregando...',
            duplicate_email: leadExisting?.email || '',
            duplicate_phone: leadExisting?.phone || '',
            reason: notif.reason,
            reason_label: reasonLabel,
            duplicate_field_value: duplicateFieldValue,
            created_at: notif.created_at
          };
        });
        
        console.log(`Notificações enriquecidas: ${enrichedNotifications.length}`);
        console.log('Primeira notificação enriquecida:', enrichedNotifications[0]);
      }

      console.log('=== VERIFICAÇÃO DE ERROS ===');
      if (error) {
        console.error('ERRO DETECTADO na RPC:', error);
        console.error('Tipo do erro:', typeof error);
        console.error('Erro completo:', JSON.stringify(error, null, 2));
        return res.status(500).json({ 
          error: 'Erro ao buscar notificações',
          details: error.message 
        });
      }

      console.log('=== RESPOSTA FINAL ===');
      console.log('Notificações enriquecidas:', enrichedNotifications?.length || 0);
      console.log('Primeira notificação final:', enrichedNotifications?.[0]);
      
      const finalResponse = {
        success: true,
        notifications: enrichedNotifications || [],
        count: enrichedNotifications?.length || 0
      };
      
      console.log('Resposta que será enviada:', {
        success: finalResponse.success,
        count: finalResponse.count,
        has_data: finalResponse.notifications.length > 0
      });
      console.log('=== FIM DEBUG DETALHADO ===');
      
      return res.status(200).json(finalResponse);
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
