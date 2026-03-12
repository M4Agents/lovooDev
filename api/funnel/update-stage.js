// =====================================================
// API ENDPOINT: Atualizar Etapa do Funil
// Data: 03/03/2026
// Objetivo: Permitir edição de nome, cor, tipo e visibilidade da etapa
// Atualizado: 06/03/2026 - Suporte para is_hidden
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { stage_id, name, color, stage_type, is_hidden } = req.body;

    // Validações
    if (!stage_id) {
      return res.status(400).json({ 
        error: 'ID da etapa é obrigatório',
        field: 'stage_id'
      });
    }

    // Name é obrigatório apenas se não estiver alterando apenas visibilidade
    if (name !== undefined) {
      if (name.trim() === '') {
        return res.status(400).json({ 
          error: 'Nome da etapa não pode ser vazio',
          field: 'name'
        });
      }

      if (name.length > 50) {
        return res.status(400).json({ 
          error: 'Nome da etapa deve ter no máximo 50 caracteres',
          field: 'name'
        });
      }
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

    // Verificar se nome duplicado no mesmo funil (apenas se name foi fornecido)
    if (name !== undefined) {
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
    }

    // Preparar dados para atualização
    const updateData = {};

    if (name !== undefined) {
      updateData.name = name.trim();
    }

    if (color !== undefined) {
      updateData.color = color;
    }

    if (stage_type !== undefined) {
      updateData.stage_type = stage_type;
    }

    if (is_hidden !== undefined) {
      updateData.is_hidden = is_hidden;
    }

    // Log para debug
    console.log('🔧 Update stage request:', { stage_id, updateData });
    console.log('🔧 Current stage before update:', currentStage);

    // Verificar se há dados para atualizar
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ 
        error: 'Nenhum campo para atualizar foi fornecido',
        received: { name, color, stage_type, is_hidden }
      });
    }

    // Atualizar etapa
    const { data: updatedStage, error: updateError } = await supabase
      .from('funnel_stages')
      .update(updateData)
      .eq('id', stage_id)
      .select()
      .single();

    console.log('🔧 Update result:', { updatedStage, updateError });

    if (updateError) {
      console.error('🔧 Update error:', updateError);
      throw updateError;
    }

    console.log('✅ Stage updated successfully:', updatedStage);

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
