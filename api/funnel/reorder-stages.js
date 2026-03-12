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
    const { funnel_id, stages } = req.body;

    // Validações
    if (!funnel_id) {
      return res.status(400).json({ 
        error: 'ID do funil é obrigatório',
        field: 'funnel_id'
      });
    }

    if (!stages || !Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ 
        error: 'Lista de etapas é obrigatória',
        field: 'stages'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    const updates = [];
    for (const stage of stages) {
      if (!stage.id || stage.position === undefined) {
        return res.status(400).json({ 
          error: 'Cada etapa deve ter id e position',
          field: 'stages'
        });
      }

      const { error: updateError } = await supabase
        .from('funnel_stages')
        .update({ position: stage.position })
        .eq('id', stage.id)
        .eq('funnel_id', funnel_id);

      if (updateError) {
        throw updateError;
      }

      updates.push({ id: stage.id, position: stage.position });
    }

    return res.status(200).json({
      success: true,
      message: 'Etapas reordenadas com sucesso',
      updated_count: updates.length
    });

  } catch (error) {
    console.error('Error in reorder stages API:', error);
    return res.status(500).json({ 
      error: 'Erro ao reordenar etapas',
      message: error.message
    });
  }
}
