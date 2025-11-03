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
      
      console.log('=== PREPARANDO CHAMADA RPC ===');
      console.log('Nome da função RPC:', 'get_pending_duplicate_notifications');
      console.log('Parâmetros da RPC:', { p_company_id: companyId });
      console.log('Tipo do parâmetro company_id:', typeof companyId);
      console.log('Iniciando chamada RPC...');
      
      console.log('=== EXECUTANDO RPC ===');
      const startTime = Date.now();
      
      const { data: notifications, error } = await supabase
        .rpc('get_pending_duplicate_notifications', { 
          p_company_id: companyId 
        });
        
      const endTime = Date.now();
      console.log('Tempo de execução RPC:', endTime - startTime, 'ms');
      
      console.log('=== RESULTADO RPC ===');
      console.log('Error object:', error);
      console.log('Error message:', error?.message);
      console.log('Error details:', error?.details);
      console.log('Error hint:', error?.hint);
      console.log('Error code:', error?.code);
      console.log('Data type:', typeof notifications);
      console.log('Data is array:', Array.isArray(notifications));
      console.log('Data length:', notifications?.length);
      console.log('Data (primeiros 200 chars):', JSON.stringify(notifications)?.substring(0, 200));
      
      console.log('=== PROCESSAMENTO ===');
      console.log('Iniciando processamento de', notifications?.length || 0, 'notificações');
      
      // Processar dados da RPC para adicionar informações extras
      let enrichedNotifications = [];
      if (notifications && notifications.length > 0) {
        console.log(`Processando ${notifications.length} notificações da RPC...`);
        
        // Log das primeiras notificações para debug
        notifications.slice(0, 3).forEach((notif, index) => {
          console.log(`Notificação ${index}:`, {
            id: notif.notification_id,
            lead_name: notif.lead_name,
            duplicate_name: notif.duplicate_name,
            reason: notif.reason
          });
        });
        
        enrichedNotifications = notifications.map(notif => {
          // Determinar qual campo está duplicado e seu valor
          let duplicateFieldValue = '';
          let reasonLabel = '';
          
          if (notif.reason === 'phone') {
            duplicateFieldValue = notif.lead_phone || notif.duplicate_phone || '';
            reasonLabel = 'Telefone';
          } else if (notif.reason === 'email') {
            duplicateFieldValue = notif.lead_email || notif.duplicate_email || '';
            reasonLabel = 'Email';
          }
          
          return {
            notification_id: notif.notification_id,
            lead_id: notif.lead_id,
            lead_name: notif.lead_name || 'Lead não encontrado',
            lead_email: notif.lead_email || '',
            lead_phone: notif.lead_phone || '',
            duplicate_of_lead_id: notif.duplicate_of_lead_id,
            duplicate_name: notif.duplicate_name || 'Lead não encontrado',
            duplicate_email: notif.duplicate_email || '',
            duplicate_phone: notif.duplicate_phone || '',
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
