// =====================================================
// API ENDPOINT: Atualizar Etapa do Funil
// Data: 03/03/2026
// Objetivo: Permitir edição de nome, cor, tipo e visibilidade da etapa
// Atualizado: 06/03/2026 - Suporte para is_hidden
// Atualizado: 2026-05-12 - Suporte para playbook_text e video_link
//   com validação explícita de JWT + role para campos de playbook
// Atualizado: 2026-07-08 - Suporte para track_contact_attempts (admin+)
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey    = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PLAYBOOK_ALLOWED_ROLES = ['admin', 'super_admin', 'system_admin'];

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { stage_id, name, color, stage_type, is_hidden, playbook_text, video_link, track_contact_attempts } = req.body;

    // Validações básicas
    if (!stage_id) {
      return res.status(400).json({ 
        error: 'ID da etapa é obrigatório',
        field: 'stage_id'
      });
    }

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

    // ─── Validação de permissão para campos de playbook e rastreamento ────────
    // Campos playbook_text, video_link e track_contact_attempts exigem autenticação
    // JWT + role explícito em company_users. NÃO confiar apenas no RLS — validação
    // dupla obrigatória.
    const isEditingPlaybook = playbook_text !== undefined
      || video_link !== undefined
      || track_contact_attempts !== undefined;

    if (isEditingPlaybook) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();

      if (!token) {
        return res.status(401).json({ error: 'Token de autenticação ausente' });
      }

      // Validar JWT via anon key (padrão do sistema)
      const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token);

      if (authError || !user) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
      }

      // Buscar company_id do funil (fonte de verdade para multi-tenant)
      const { data: funnel, error: funnelError } = await supabase
        .from('sales_funnels')
        .select('company_id')
        .eq('id', currentStage.funnel_id)
        .single();

      if (funnelError || !funnel) {
        return res.status(404).json({ error: 'Funil não encontrado' });
      }

      // Verificar role em company_users — fonte de verdade de RBAC
      const { data: membership } = await supabase
        .from('company_users')
        .select('role')
        .eq('user_id', user.id)
        .eq('company_id', funnel.company_id)
        .eq('is_active', true)
        .maybeSingle();

      if (!membership || !PLAYBOOK_ALLOWED_ROLES.includes(membership.role)) {
        return res.status(403).json({ error: 'Sem permissão para editar o playbook desta etapa' });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Verificar nome duplicado no mesmo funil
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

    if (name         !== undefined) updateData.name         = name.trim();
    if (color        !== undefined) updateData.color        = color;
    if (stage_type   !== undefined) updateData.stage_type   = stage_type;
    if (is_hidden    !== undefined) updateData.is_hidden    = is_hidden;
    if (playbook_text !== undefined) updateData.playbook_text = playbook_text;
    if (video_link   !== undefined) updateData.video_link   = video_link;
    if (track_contact_attempts !== undefined) {
      if (typeof track_contact_attempts !== 'boolean') {
        return res.status(400).json({
          error: 'track_contact_attempts deve ser um booleano (true ou false)',
          field: 'track_contact_attempts',
        });
      }
      updateData.track_contact_attempts = track_contact_attempts;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ 
        error: 'Nenhum campo para atualizar foi fornecido'
      });
    }

    const { data: updatedStage, error: updateError } = await supabase
      .from('funnel_stages')
      .update(updateData)
      .eq('id', stage_id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating stage:', updateError);
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
