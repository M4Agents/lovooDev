// =====================================================
// API ENDPOINT: Deletar Etapa do Funil
// Objetivo: Remover etapa sem oportunidades atuais.
// Histórico e perguntas não podem bloquear a exclusão.
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, assertMembership, jsonError } from '../lib/dashboard/auth.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'DELETE') return jsonError(res, 405, 'Método não permitido')

  try {
    const token = extractToken(req.headers['authorization'])
    if (!token) return jsonError(res, 401, 'Token de autenticação obrigatório')

    const { user, error: authError } = await getUserFromToken(token)
    if (!user || authError) return jsonError(res, 401, 'Não autenticado')

    const { stage_id, move_to_stage_id } = req.body ?? {}
    if (!stage_id) {
      return res.status(400).json({ error: 'ID da etapa é obrigatório', field: 'stage_id' })
    }

    const svc = getSupabaseAdmin()

    const { data: stage, error: stageError } = await svc
      .from('funnel_stages')
      .select('id, funnel_id, name, position, is_system_stage, stage_type, sales_funnels!inner(company_id)')
      .eq('id', stage_id)
      .maybeSingle()

    if (stageError || !stage) {
      return res.status(404).json({ error: 'Etapa não encontrada' })
    }

    const companyId = stage.sales_funnels?.company_id
    if (!companyId) {
      return jsonError(res, 404, 'Funil da etapa não encontrado')
    }

    const member = await assertMembership(svc, user.id, companyId)
    if (!member) return jsonError(res, 403, 'Acesso negado')

    if (stage.is_system_stage) {
      return res.status(400).json({
        error: 'Não é possível deletar etapas do sistema',
        message: 'A etapa de entrada é obrigatória e não pode ser removida',
      })
    }

    if (stage.stage_type === 'won' || stage.stage_type === 'lost') {
      return res.status(400).json({
        error: 'Não é possível deletar etapas de fechamento',
        message: 'As etapas "Venda Ganha" e "Venda Perdida" são obrigatórias',
      })
    }

    const { data: positionsInStage, error: positionsError } = await svc
      .from('opportunity_funnel_positions')
      .select('id, opportunity_id')
      .eq('stage_id', stage_id)
      .eq('funnel_id', stage.funnel_id)

    if (positionsError) throw positionsError

    const positionCount = positionsInStage?.length || 0

    if (positionCount > 0 && !move_to_stage_id) {
      return res.status(400).json({
        error: 'Esta etapa possui leads',
        message: `Existem ${positionCount} lead(s) nesta etapa. Informe para qual etapa deseja movê-los.`,
        field: 'move_to_stage_id',
        lead_count: positionCount,
      })
    }

    if (move_to_stage_id) {
      if (move_to_stage_id === stage_id) {
        return res.status(400).json({
          error: 'Etapa de destino inválida',
          message: 'A etapa de destino deve ser diferente da etapa que será removida',
        })
      }

      const { data: targetStage, error: targetError } = await svc
        .from('funnel_stages')
        .select('id, name')
        .eq('id', move_to_stage_id)
        .eq('funnel_id', stage.funnel_id)
        .maybeSingle()

      if (targetError || !targetStage) {
        return res.status(404).json({
          error: 'Etapa de destino não encontrada',
          message: 'A etapa para onde deseja mover os leads não existe neste funil',
        })
      }

      if (positionCount > 0) {
        const { error: moveError } = await svc
          .from('opportunity_funnel_positions')
          .update({
            stage_id: move_to_stage_id,
            entered_stage_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stage_id', stage_id)
          .eq('funnel_id', stage.funnel_id)

        if (moveError) throw moveError
      }
    }

    // Histórico e perguntas referenciam a etapa com RESTRICT / sem ON DELETE.
    // Sem oportunidades atuais, a exclusão deve seguir — o histórico desta
    // coluna não pode impedir a remoção.
    const { error: oshFromError } = await svc
      .from('opportunity_stage_history')
      .update({ from_stage_id: null })
      .eq('company_id', companyId)
      .eq('from_stage_id', stage_id)
    if (oshFromError) throw oshFromError

    const { error: oshToError } = await svc
      .from('opportunity_stage_history')
      .delete()
      .eq('company_id', companyId)
      .eq('to_stage_id', stage_id)
    if (oshToError) throw oshToError

    const { error: lshFromError } = await svc
      .from('lead_stage_history')
      .update({ from_stage_id: null })
      .eq('funnel_id', stage.funnel_id)
      .eq('from_stage_id', stage_id)
    if (lshFromError) throw lshFromError

    const { error: lshToError } = await svc
      .from('lead_stage_history')
      .delete()
      .eq('funnel_id', stage.funnel_id)
      .eq('to_stage_id', stage_id)
    if (lshToError) throw lshToError

    const { error: questionsError } = await svc
      .from('stage_transition_questions')
      .delete()
      .eq('company_id', companyId)
      .eq('funnel_stage_id', stage_id)
    if (questionsError) throw questionsError

    const { error: deleteError } = await svc
      .from('funnel_stages')
      .delete()
      .eq('id', stage_id)
      .eq('funnel_id', stage.funnel_id)

    if (deleteError) throw deleteError

    const { data: remainingStages } = await svc
      .from('funnel_stages')
      .select('id, position')
      .eq('funnel_id', stage.funnel_id)
      .gt('position', stage.position)
      .order('position', { ascending: true })

    if (remainingStages?.length) {
      for (const s of remainingStages) {
        const { error: reorderError } = await svc
          .from('funnel_stages')
          .update({ position: s.position - 1 })
          .eq('id', s.id)
          .eq('funnel_id', stage.funnel_id)
        if (reorderError) throw reorderError
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Etapa deletada com sucesso',
      leads_moved: positionCount,
      moved_to_stage_id: move_to_stage_id || null,
    })
  } catch (error) {
    console.error('[delete-stage] error:', error?.message)
    return res.status(500).json({
      error: 'Erro ao deletar etapa',
      message: error?.message,
    })
  }
}
