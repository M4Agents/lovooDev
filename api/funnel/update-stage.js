// =====================================================
// API ENDPOINT: Atualizar Etapa do Funil
// Data: 03/03/2026
// Objetivo: Permitir edição de nome, cor e tipo da etapa
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { stage_id, name, color, stage_type } = req.body;

    // Validações
    if (!stage_id) {
      return res.status(400).json({ 
        error: 'ID da etapa é obrigatório',
        field: 'stage_id'
      });
    }

    if (!name || name.trim() === '') {
      return res.status(400).json({ 
        error: 'Nome da etapa é obrigatório',
        field: 'name'
      });
    }

    if (name.length > 50) {
      return res.status(400).json({ 
        error: 'Nome da etapa deve ter no máximo 50 caracteres',
        field: 'name'
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Buscar etapa atual
    const { data: currentStage, error: fetchError } = await supabase
      .from('funnel_stages')
      .select('id, funnel_id, name, is_system_stage')
      .eq('id', stage_id)
      .single();

    if (fetchError || !currentStage) {
      return res.status(404).json({ 
        error: 'Etapa não encontrada'
      });
    }

    // Verificar se nome duplicado no mesmo funil
    const { data: duplicateStage } = await supabase
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', currentStage.funnel_id)
      .eq('name', name.trim())
      .neq('id', stage_id)
      .single();

    if (duplicateStage) {
      return res.status(400).json({ 
        error: 'Já existe uma etapa com este nome neste funil',
        field: 'name'
      });
    }

    // Preparar dados para atualização
    const updateData = {
      name: name.trim()
    };

    if (color) {
      updateData.color = color;
    }

    if (stage_type) {
      updateData.stage_type = stage_type;
    }

    // Atualizar etapa
    const { data: updatedStage, error: updateError } = await supabase
      .from('funnel_stages')
      .update(updateData)
      .eq('id', stage_id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return res.status(200).json({
      success: true,
      message: 'Etapa atualizada com sucesso',
      data: updatedStage
    });

  } catch (error) {
    console.error('Error in update stage API:', error);
    return res.status(500).json({ 
      error: 'Erro ao atualizar etapa',
      message: error.message
    });
  }
}
