// =====================================================
// API ENDPOINT: Criar Nova Etapa do Funil
// Data: 03/03/2026
// =====================================================

import { createClient } from '@supabase/supabase-js';
import {
  getPlanLimits,
  assertLimitFromLoaded,
  PlanEnforcementError,
} from '../lib/plans/limitChecker.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Detecta se o erro vem do trigger de limite de etapas (P0001 do PostgreSQL).
 * O trigger raise_exception usa a mensagem como código de erro.
 */
function isPlanStageLimitError(error) {
  const msg = error?.message || '';
  return (
    msg === 'plan_funnel_stages_limit_exceeded' ||
    msg.includes('plan_funnel_stages_limit_exceeded')
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { funnel_id, name, color, stage_type, position } = req.body;

    if (!funnel_id) {
      return res.status(400).json({ error: 'ID do funil é obrigatório', field: 'funnel_id' });
    }

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Nome da etapa é obrigatório', field: 'name' });
    }

    if (name.length > 50) {
      return res.status(400).json({
        error: 'Nome da etapa deve ter no máximo 50 caracteres',
        field: 'name',
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verificar se funil existe + ler company_id e is_over_plan
    const { data: funnel, error: funnelError } = await supabase
      .from('sales_funnels')
      .select('id, name, company_id, is_over_plan')
      .eq('id', funnel_id)
      .single();

    if (funnelError || !funnel) {
      return res.status(404).json({ error: 'Funil não encontrado' });
    }

    // BLOQUEIO EXPLÍCITO: funil excedente não pode receber novas etapas
    if (funnel.is_over_plan) {
      return res.status(422).json({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: 'Este funil está acima do limite do plano. Faça upgrade ou remova outros funis para liberar.',
        details: { funnel_id: funnel.id },
      });
    }

    // VERIFICAÇÃO ANTECIPADA DE LIMITE: evita chegar no trigger do banco
    const limits = await getPlanLimits(supabase, funnel.company_id);

    if (limits.max_funnel_stages !== null) {
      const { count } = await supabase
        .from('funnel_stages')
        .select('*', { count: 'exact', head: true })
        .eq('funnel_id', funnel_id)
        .eq('is_system_stage', false);

      try {
        assertLimitFromLoaded(limits, 'max_funnel_stages', count || 0);
      } catch (err) {
        if (err instanceof PlanEnforcementError) {
          return res.status(422).json({
            code: 'PLAN_LIMIT_EXCEEDED',
            message: 'Limite de etapas do plano atingido. Faça upgrade ou remova etapas existentes.',
            details: { current: err.data.current, limit: err.data.max_allowed },
          });
        }
        throw err;
      }
    }

    // Verificar nome duplicado no mesmo funil
    const { data: duplicateStage } = await supabase
      .from('funnel_stages')
      .select('id')
      .eq('funnel_id', funnel_id)
      .eq('name', name.trim())
      .single();

    if (duplicateStage) {
      return res.status(400).json({
        error: 'Já existe uma etapa com este nome neste funil',
        field: 'name',
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

    const newStage = {
      funnel_id,
      name: name.trim(),
      color: color || '#93C5FD',
      stage_type: stage_type || 'active',
      position: finalPosition,
      is_system_stage: false,
    };

    const { data: createdStage, error: createError } = await supabase
      .from('funnel_stages')
      .insert(newStage)
      .select()
      .single();

    if (createError) {
      // Última barreira: traduzir erro do trigger caso passe pela verificação antecipada
      if (isPlanStageLimitError(createError)) {
        return res.status(422).json({
          code: 'PLAN_LIMIT_EXCEEDED',
          message: 'Limite de etapas do plano atingido. Faça upgrade ou remova etapas existentes.',
          details: {},
        });
      }
      throw createError;
    }

    return res.status(201).json({
      success: true,
      message: 'Etapa criada com sucesso',
      data: createdStage,
    });
  } catch (error) {
    // Nunca retornar 500 para erros de limite de plano
    if (isPlanStageLimitError(error)) {
      return res.status(422).json({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: 'Limite de etapas do plano atingido. Faça upgrade ou remova etapas existentes.',
        details: {},
      });
    }

    console.error('Error in create stage API:', error);
    return res.status(500).json({
      error: 'Erro ao criar etapa',
      message: error.message,
    });
  }
}
