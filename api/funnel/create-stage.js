// =====================================================
// API ENDPOINT: Criar Nova Etapa do Funil
// Data: 03/03/2026
// Objetivo: Permitir criação de novas etapas no funil
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { funnel_id, name, color, stage_type, position } = req.body;

    // Validações
    if (!funnel_id) {
      return res.status(400).json({ 
        error: 'ID do funil é obrigatório',
        field: 'funnel_id'
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

    // Verificar se funil existe
    const { data: funnel, error: funnelError } = await supabase
      .from('sales_funnels')
      .select('id, name')
      .eq('id', funnel_id)
      .single();

    if (funnelError || !funnel) {
      return res.status(404).json({ 
        error: 'Funil não encontrado'
      });
    }

    // Verificar se nome duplicado no mesmo funil
    const { data: duplicateStage } = await supabase
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', funnel_id)
      .eq('name', name.trim())
      .single();

    if (duplicateStage) {
      return res.status(400).json({ 
        error: 'Já existe uma etapa com este nome neste funil',
        field: 'name'
      });
    }

    // Determinar posição (final da lista se não informada)
    let finalPosition = position;
    if (finalPosition === undefined || finalPosition === null) {
      const { data: stages } = await supabase
        .from('funnel_stages')
        .select('position')
        .eq('funnel_id', funnel_id)
        .order('position', { ascending: false })
        .limit(1);

      finalPosition = stages && stages.length > 0 ? stages[0].position + 1 : 0;
    }

    // Criar nova etapa
    const newStage = {
      funnel_id,
      name: name.trim(),
      color: color || '#93C5FD',
      stage_type: stage_type || 'active',
      position: finalPosition,
      is_system_stage: false
    };

    const { data: createdStage, error: createError } = await supabase
      .from('funnel_stages')
      .insert(newStage)
      .select()
      .single();

    if (createError) {
      throw createError;
    }

    return res.status(201).json({
      success: true,
      message: 'Etapa criada com sucesso',
      data: createdStage
    });

  } catch (error) {
    console.error('Error in create stage API:', error);
    return res.status(500).json({ 
      error: 'Erro ao criar etapa',
      message: error.message
    });
  }
}
