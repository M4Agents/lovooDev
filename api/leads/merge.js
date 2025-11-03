import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { sourceId, targetId, strategy, notificationId, userId } = req.body;

    if (!sourceId || !targetId || !strategy) {
      return res.status(400).json({
        error: 'sourceId, targetId e strategy são obrigatórios'
      });
    }

    console.log(`Iniciando mesclagem via RPC: ${sourceId} -> ${targetId} (${strategy})`);

    // Usar RPC para contornar RLS (mesmo padrão do webhook-lead que funciona 100%)
    const { data: result, error: rpcError } = await supabase
      .rpc('merge_leads_webhook', {
        p_source_id: sourceId,
        p_target_id: targetId,
        p_strategy: strategy,
        p_notification_id: notificationId || null,
        p_user_id: userId || null
      });

    console.log('Resultado da RPC de mesclagem:', result);

    if (rpcError) {
      console.error('Erro na RPC de mesclagem:', rpcError);
      return res.status(500).json({ 
        error: 'Erro ao executar mesclagem',
        details: rpcError.message 
      });
    }

    if (!result || !result.success) {
      console.error('RPC de mesclagem falhou:', result);
      return res.status(400).json({ 
        error: result?.error || 'Falha na mesclagem de leads' 
      });
    }

    console.log(`Mesclagem concluída via RPC: Lead ${result.result_lead_id} é o resultado`);

    return res.status(200).json({
      success: true,
      message: result.message,
      resultLeadId: result.result_lead_id,
      strategy: result.strategy,
      mergedData: result.merged_data
    });

  } catch (error) {
    console.error('Erro na mesclagem de leads:', error);
    return res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
}
