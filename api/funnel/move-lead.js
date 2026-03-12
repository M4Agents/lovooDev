// =====================================================
// API ENDPOINT: Mover Lead entre Etapas do Funil
// Data: 03/03/2026
// Objetivo: Permitir movimentação de leads via webhook externo
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Apenas POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { api_key, lead_id, funnel_slug, stage_slug, stage_external_id, notes } = req.body;

    // Validações
    if (!api_key) {
      return res.status(400).json({ 
        error: 'API Key é obrigatória',
        field: 'api_key'
      });
    }

    if (!lead_id) {
      return res.status(400).json({ 
        error: 'ID do lead é obrigatório',
        field: 'lead_id'
      });
    }

    if (!funnel_slug) {
      return res.status(400).json({ 
        error: 'Slug do funil é obrigatório',
        field: 'funnel_slug'
      });
    }

    if (!stage_slug && !stage_external_id) {
      return res.status(400).json({ 
        error: 'stage_slug ou stage_external_id é obrigatório',
        field: 'stage_slug / stage_external_id',
        message: 'Informe stage_external_id (recomendado) ou stage_slug'
      });
    }

    // Criar cliente Supabase com service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Buscar empresa pela API Key
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name')
      .eq('api_key', api_key)
      .single();

    if (companyError || !company) {
      return res.status(401).json({ 
        error: 'API Key inválida',
        message: 'Verifique sua API Key em Configurações > API'
      });
    }

    // 2. Verificar se lead existe e pertence à empresa
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, name, company_id')
      .eq('id', lead_id)
      .eq('company_id', company.id)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ 
        error: 'Lead não encontrado',
        message: `Lead ${lead_id} não existe ou não pertence à sua empresa`
      });
    }

    // 3. Buscar funil pelo slug
    const { data: funnel, error: funnelError } = await supabase
      .from('sales_funnels')
      .select('id, name, slug')
      .eq('company_id', company.id)
      .eq('slug', funnel_slug)
      .eq('is_active', true)
      .single();

    if (funnelError || !funnel) {
      return res.status(404).json({ 
        error: 'Funil não encontrado',
        message: `Funil com slug "${funnel_slug}" não existe ou não está ativo`
      });
    }

    // 4. Buscar etapa pelo external_id (prioridade) ou slug (fallback)
    let stageQuery = supabase
      .from('funnel_stages')
      .select('id, name, slug, external_id, position, stage_type')
      .eq('funnel_id', funnel.id);

    // Priorizar external_id (mais estável, nunca muda)
    if (stage_external_id) {
      stageQuery = stageQuery.eq('external_id', stage_external_id);
    } else {
      // Fallback para slug (pode quebrar se usuário renomear etapa)
      stageQuery = stageQuery.eq('slug', stage_slug);
    }

    const { data: stage, error: stageError } = await stageQuery.single();

    if (stageError || !stage) {
      const identifier = stage_external_id || stage_slug;
      const identifierType = stage_external_id ? 'external_id' : 'slug';
      return res.status(404).json({ 
        error: 'Etapa não encontrada',
        message: `Etapa com ${identifierType} "${identifier}" não existe no funil "${funnel.name}"`,
        tip: 'Use o endpoint /api/funnel/mapping para obter external_ids atualizados'
      });
    }

    // 5. Buscar posição atual do lead (se existir)
    const { data: currentPosition } = await supabase
      .from('lead_funnel_positions')
      .select('id, stage_id, funnel_id')
      .eq('lead_id', lead_id)
      .eq('funnel_id', funnel.id)
      .single();

    let result;

    if (currentPosition) {
      // Lead já está no funil - atualizar posição
      const { data: updated, error: updateError } = await supabase
        .from('lead_funnel_positions')
        .update({
          stage_id: stage.id,
          entered_stage_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', currentPosition.id)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating position:', updateError);
        return res.status(500).json({ 
          error: 'Erro ao atualizar posição do lead',
          message: updateError.message 
        });
      }

      result = updated;

      // Registrar no histórico
      await supabase
        .from('lead_stage_history')
        .insert({
          lead_id: lead_id,
          funnel_id: funnel.id,
          from_stage_id: currentPosition.stage_id,
          to_stage_id: stage.id,
          moved_by: null, // Movido via API
          notes: notes || 'Movido via API externa'
        });

    } else {
      // Lead não está no funil - criar nova posição
      const { data: created, error: createError } = await supabase
        .from('lead_funnel_positions')
        .insert({
          lead_id: lead_id,
          funnel_id: funnel.id,
          stage_id: stage.id,
          position_in_stage: 0,
          entered_stage_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating position:', createError);
        return res.status(500).json({ 
          error: 'Erro ao criar posição do lead',
          message: createError.message 
        });
      }

      result = created;

      // Registrar no histórico (primeira entrada no funil)
      await supabase
        .from('lead_stage_history')
        .insert({
          lead_id: lead_id,
          funnel_id: funnel.id,
          from_stage_id: null,
          to_stage_id: stage.id,
          moved_by: null,
          notes: notes || 'Adicionado ao funil via API externa'
        });
    }

    // Retornar sucesso
    return res.status(200).json({
      success: true,
      message: 'Lead movido com sucesso',
      data: {
        lead_id: lead.id,
        lead_name: lead.name,
        funnel_id: funnel.id,
        funnel_name: funnel.name,
        funnel_slug: funnel.slug,
        stage_id: stage.id,
        stage_name: stage.name,
        stage_slug: stage.slug,
        stage_external_id: stage.external_id,
        stage_position: stage.position,
        stage_type: stage.stage_type,
        moved_at: new Date().toISOString(),
        was_in_funnel: !!currentPosition
      }
    });

  } catch (error) {
    console.error('Error in move-lead API:', error);
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message 
    });
  }
}
