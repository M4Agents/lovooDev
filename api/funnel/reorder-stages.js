// =====================================================
// API ENDPOINT: Reordenar Etapas do Funil
// Data: 03/03/2026
// Objetivo: Atualizar posições das etapas (drag & drop)
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
      console.error('SOLUTION: Configure SUPABASE_SERVICE_ROLE_KEY in Vercel Environment Variables');
      return res.status(500).json({ 
        error: 'Configuração do servidor incompleta',
        message: 'SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel',
        solution: 'Configure a variável de ambiente SUPABASE_SERVICE_ROLE_KEY no dashboard do Vercel'
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

    // Atualizar posições em duas etapas para evitar conflito de unique constraint
    console.log('Starting updates for', stages.length, 'stages');
    
    // Validar dados primeiro
    for (const stage of stages) {
      if (!stage.id || stage.position === undefined) {
        console.log('ERROR: Invalid stage data', stage);
        return res.status(400).json({ 
          error: 'Cada etapa deve ter id e position',
          field: 'stages'
        });
      }
    }

    // ETAPA 1: Definir posições temporárias altas para evitar conflito
    console.log('Step 1: Setting temporary high positions');
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const tempPosition = 10000 + i; // Posição temporária alta (respeita constraint >= 0)
      
      const { error: tempError } = await supabase
        .from('funnel_stages')
        .update({ position: tempPosition })
        .eq('id', stage.id)
        .eq('funnel_id', funnel_id);

      if (tempError) {
        console.error('Temp update error:', tempError);
        throw tempError;
      }
    }

    // ETAPA 2: Atualizar para posições finais
    console.log('Step 2: Setting final positions');
    const updates = [];
    
    for (const stage of stages) {
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
    console.error('=== ERROR IN REORDER STAGES API ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error details:', error.details);
    console.error('Error hint:', error.hint);
    console.error('Error stack:', error.stack);
    console.error('Full error object:', JSON.stringify(error, null, 2));
    
    return res.status(500).json({ 
      error: 'Erro ao reordenar etapas',
      message: error.message,
      code: error.code,
      details: error.details || error.toString(),
      hint: error.hint
    });
  }
}
