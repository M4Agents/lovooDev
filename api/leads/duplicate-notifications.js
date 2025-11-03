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
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Extrair company_id do header ou query
    const companyId = req.headers['x-company-id'] || req.query.company_id;
    
    if (!companyId) {
      return res.status(400).json({ 
        error: 'company_id é obrigatório' 
      });
    }

    if (req.method === 'GET') {
      console.log('Buscando notificações de duplicatas para empresa:', companyId);
      
      // Buscar notificações pendentes
      const { data: notifications, error } = await supabase
        .rpc('get_pending_duplicate_notifications', { 
          p_company_id: companyId 
        });

      if (error) {
        console.error('Erro ao buscar notificações:', error);
        return res.status(500).json({ 
          error: 'Erro ao buscar notificações',
          details: error.message 
        });
      }

      console.log(`Encontradas ${notifications?.length || 0} notificações pendentes`);
      
      return res.status(200).json({
        success: true,
        notifications: notifications || [],
        count: notifications?.length || 0
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
