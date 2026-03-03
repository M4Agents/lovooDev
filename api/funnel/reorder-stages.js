// =====================================================
// API ENDPOINT: Reordenar Etapas do Funil
// Data: 03/03/2026
// Objetivo: Atualizar posições das etapas (drag & drop)
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('=== REORDER STAGES API ===');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { funnel_id, stages } = req.body;

    // Validações
    if (!funnel_id) {
      console.log('ERROR: Missing funnel_id');
      return res.status(400).json({ 
        error: 'ID do funil é obrigatório',
        field: 'funnel_id'
      });
    }

    if (!stages || !Array.isArray(stages) || stages.length === 0) {
      console.log('ERROR: Invalid stages array');
      return res.status(400).json({ 
        error: 'Lista de etapas é obrigatória',
        field: 'stages'
      });
    }

    if (!supabaseServiceKey) {
      console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not configured');
      return res.status(500).json({ 
        error: 'Configuração do servidor incompleta'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log('Supabase client created');

    // Verificar se funil existe
    const { data: funnel, error: funnelError } = await supabase
      .from('sales_funnels')
      .select('id')
      .eq('id', funnel_id)
      .single();

    if (funnelError || !funnel) {
      return res.status(404).json({ 
        error: 'Funil não encontrado'
      });
    }

    // Atualizar posições em lote
    console.log('Starting updates for', stages.length, 'stages');
    const updates = [];
    
    for (const stage of stages) {
      console.log('Processing stage:', stage);
      
      if (!stage.id || stage.position === undefined) {
        console.log('ERROR: Invalid stage data', stage);
        return res.status(400).json({ 
          error: 'Cada etapa deve ter id e position',
          field: 'stages'
        });
      }

      console.log(`Updating stage ${stage.id} to position ${stage.position}`);
      
      const { data, error: updateError } = await supabase
        .from('funnel_stages')
        .update({ position: stage.position })
        .eq('id', stage.id)
        .eq('funnel_id', funnel_id)
        .select();

      if (updateError) {
        console.error('Update error:', updateError);
        throw updateError;
      }

      console.log('Update result:', data);
      updates.push({ id: stage.id, position: stage.position });
    }

    console.log('All updates completed successfully');
    return res.status(200).json({
      success: true,
      message: 'Etapas reordenadas com sucesso',
      updated_count: updates.length
    });

  } catch (error) {
    console.error('Error in reorder stages API:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ 
      error: 'Erro ao reordenar etapas',
      message: error.message,
      details: error.toString()
    });
  }
}
