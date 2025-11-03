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

    console.log(`Iniciando mesclagem: ${sourceId} -> ${targetId} (${strategy})`);

    // 1. Buscar dados dos leads
    const { data: sourceLead, error: sourceError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', sourceId)
      .single();

    if (sourceError || !sourceLead) {
      return res.status(404).json({ error: 'Lead origem não encontrado' });
    }

    const { data: targetLead, error: targetError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', targetId)
      .single();

    if (targetError || !targetLead) {
      return res.status(404).json({ error: 'Lead destino não encontrado' });
    }

    let mergedData = {};
    let resultLeadId = targetId;

    // 2. Aplicar estratégia de mesclagem
    switch (strategy) {
      case 'keep_existing':
        // Manter lead existente, apenas marcar o novo como merged
        mergedData = targetLead;
        resultLeadId = targetId;
        break;

      case 'keep_new':
        // Manter lead novo, arquivar o existente
        mergedData = sourceLead;
        resultLeadId = sourceId;
        
        // Marcar lead existente como merged
        await supabase
          .from('leads')
          .update({ 
            deleted_at: new Date().toISOString(),
            duplicate_status: 'merged'
          })
          .eq('id', targetId);
        break;

      case 'merge_fields':
        // Combinar campos (estratégia inteligente)
        mergedData = {
          ...targetLead,
          // Usar dados mais completos
          name: sourceLead.name?.length > targetLead.name?.length ? sourceLead.name : targetLead.name,
          email: sourceLead.email || targetLead.email,
          phone: sourceLead.phone || targetLead.phone,
          interest: sourceLead.interest || targetLead.interest,
          company_name: sourceLead.company_name || targetLead.company_name,
          company_cnpj: sourceLead.company_cnpj || targetLead.company_cnpj,
          company_email: sourceLead.company_email || targetLead.company_email,
          // Manter visitor_id de ambos (preferir o mais antigo)
          visitor_id: targetLead.visitor_id || sourceLead.visitor_id,
          // Atualizar timestamp
          updated_at: new Date().toISOString()
        };
        resultLeadId = targetId;
        break;

      default:
        return res.status(400).json({ error: 'Estratégia inválida' });
    }

    // 3. Atualizar lead resultado
    if (strategy !== 'keep_existing') {
      const { error: updateError } = await supabase
        .from('leads')
        .update(mergedData)
        .eq('id', resultLeadId);

      if (updateError) {
        console.error('Erro ao atualizar lead:', updateError);
        return res.status(500).json({ error: 'Erro ao atualizar lead' });
      }
    }

    // 4. Marcar lead fonte como merged (se não for keep_new)
    if (strategy !== 'keep_new') {
      await supabase
        .from('leads')
        .update({ 
          deleted_at: new Date().toISOString(),
          duplicate_status: 'merged'
        })
        .eq('id', sourceId);
    }

    // 5. Criar registro de histórico de mesclagem
    const { error: historyError } = await supabase
      .from('lead_merge_history')
      .insert({
        source_lead_id: sourceId,
        target_lead_id: targetId,
        merged_by_user_id: userId || null,
        merge_strategy: strategy,
        merged_data: {
          source: sourceLead,
          target: targetLead,
          result: mergedData
        }
      });

    if (historyError) {
      console.error('Erro ao salvar histórico:', historyError);
      // Não falhar por causa do histórico
    }

    // 6. Marcar notificação como processada
    if (notificationId) {
      await supabase
        .from('duplicate_notifications')
        .update({
          status: 'merged',
          reviewed_at: new Date().toISOString(),
          reviewed_by_user_id: userId || null
        })
        .eq('id', notificationId);
    }

    console.log(`Mesclagem concluída: Lead ${resultLeadId} é o resultado`);

    return res.status(200).json({
      success: true,
      message: 'Leads mesclados com sucesso',
      resultLeadId,
      strategy,
      mergedData: {
        name: mergedData.name,
        email: mergedData.email,
        phone: mergedData.phone
      }
    });

  } catch (error) {
    console.error('Erro na mesclagem de leads:', error);
    return res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
}
