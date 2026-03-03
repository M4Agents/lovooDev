// =====================================================
// API ENDPOINT: Deletar Etapa do Funil
// Data: 03/03/2026
// Objetivo: Deletar etapa e mover leads para outra etapa
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { stage_id, move_to_stage_id } = req.body;

    // Validações
    if (!stage_id) {
      return res.status(400).json({ 
        error: 'ID da etapa é obrigatório',
        field: 'stage_id'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar etapa
    const { data: stage, error: stageError } = await supabase
      .from('funnel_stages')
      .select('id, funnel_id, name, position, is_system_stage')
      .eq('id', stage_id)
      .single();

    if (stageError || !stage) {
      return res.status(404).json({ 
        error: 'Etapa não encontrada'
      });
    }

    // Não permitir deletar etapa de sistema
    if (stage.is_system_stage) {
      return res.status(400).json({ 
        error: 'Não é possível deletar etapas do sistema',
        message: 'A etapa "Lead Novo" é obrigatória e não pode ser removida'
      });
    }

    // Verificar quantos leads estão nesta etapa
    const { data: leadsInStage, error: leadsError } = await supabase
      .from('lead_funnel_positions')
      .select('id, lead_id')
      .eq('stage_id', stage_id);

    if (leadsError) {
      throw leadsError;
    }

    const leadCount = leadsInStage?.length || 0;

    // Se houver leads, precisa informar para onde mover
    if (leadCount > 0 && !move_to_stage_id) {
      return res.status(400).json({ 
        error: 'Esta etapa possui leads',
        message: `Existem ${leadCount} lead(s) nesta etapa. Informe para qual etapa deseja movê-los.`,
        field: 'move_to_stage_id',
        lead_count: leadCount
      });
    }

    // Se informou etapa destino, validar
    if (move_to_stage_id) {
      const { data: targetStage, error: targetError } = await supabase
        .from('funnel_stages')
        .select('id, name')
        .eq('id', move_to_stage_id)
        .eq('funnel_id', stage.funnel_id)
        .single();

      if (targetError || !targetStage) {
        return res.status(404).json({ 
          error: 'Etapa de destino não encontrada',
          message: 'A etapa para onde deseja mover os leads não existe neste funil'
        });
      }

      // Mover leads para nova etapa
      if (leadCount > 0) {
        const { error: moveError } = await supabase
          .from('lead_funnel_positions')
          .update({ 
            stage_id: move_to_stage_id,
            updated_at: new Date().toISOString()
          })
          .eq('stage_id', stage_id);

        if (moveError) {
          throw moveError;
        }

        // Registrar movimentação no histórico
        const historyRecords = leadsInStage.map(pos => ({
          lead_id: pos.lead_id,
          funnel_id: stage.funnel_id,
          from_stage_id: stage_id,
          to_stage_id: move_to_stage_id,
          moved_by: 'system',
          notes: `Etapa "${stage.name}" foi deletada`
        }));

        await supabase
          .from('lead_stage_history')
          .insert(historyRecords);
      }
    }

    // Deletar etapa
    const { error: deleteError } = await supabase
      .from('funnel_stages')
      .delete()
      .eq('id', stage_id);

    if (deleteError) {
      throw deleteError;
    }

    // Reordenar posições das etapas restantes
    const { data: remainingStages } = await supabase
      .from('funnel_stages')
      .select('id, position')
      .eq('funnel_id', stage.funnel_id)
      .gt('position', stage.position)
      .order('position', { ascending: true });

    if (remainingStages && remainingStages.length > 0) {
      for (const s of remainingStages) {
        await supabase
          .from('funnel_stages')
          .update({ position: s.position - 1 })
          .eq('id', s.id);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Etapa deletada com sucesso',
      leads_moved: leadCount,
      moved_to_stage_id: move_to_stage_id || null
    });

  } catch (error) {
    console.error('Error in delete stage API:', error);
    return res.status(500).json({ 
      error: 'Erro ao deletar etapa',
      message: error.message
    });
  }
}
