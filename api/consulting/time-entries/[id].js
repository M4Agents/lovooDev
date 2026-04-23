// =============================================================================
// DELETE /api/consulting/time-entries/[id]
//
// Soft delete de um lançamento de horas (platform_admin apenas).
// Restaura os minutos no saldo via RPC delete_consulting_time_entry.
//
// QUERY:
//   ?company_id=<uuid>  — obrigatório para admin da empresa pai
//
// SEGURANÇA:
//   - Apenas platform_admin pode excluir lançamentos
//   - RPC executa soft delete + restauração de saldo atomicamente
// =============================================================================

import { resolveCreditsContext } from '../../lib/credits/authContext.js'

async function isPlatformAdmin(svc, userId) {
  const { data } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('role', ['super_admin', 'system_admin'])
    .limit(1)
    .maybeSingle()

  return !!data
}

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  const rawUrl         = req.url ?? ''
  const qs             = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const queryCompanyId = new URLSearchParams(qs).get('company_id') ?? null

  // Extrair ID da URL: /api/consulting/time-entries/<id>
  const entryId = req.query?.id ?? rawUrl.split('/').filter(Boolean).pop()?.split('?')[0]

  if (!entryId) {
    return res.status(400).json({ ok: false, error: 'ID do lançamento é obrigatório' })
  }

  const ctx = await resolveCreditsContext(req, queryCompanyId)
  if (!ctx.ok) {
    return res.status(ctx.status).json({ ok: false, error: ctx.error })
  }

  const { svc, userId } = ctx

  const isAdmin = await isPlatformAdmin(svc, userId)
  if (!isAdmin) {
    return res.status(403).json({ ok: false, error: 'Apenas administradores da plataforma podem excluir lançamentos' })
  }

  const { data: result, error: rpcError } = await svc.rpc('delete_consulting_time_entry', {
    p_entry_id:   entryId,
    p_deleted_by: userId,
  })

  if (rpcError) {
    console.error('[DELETE /api/consulting/time-entries/:id] Erro RPC:', rpcError.message)
    return res.status(500).json({ ok: false, error: 'Erro ao excluir lançamento' })
  }

  if (!result?.success) {
    const status = result?.error === 'entry_not_found_or_already_deleted' ? 404 : 500
    return res.status(status).json({ ok: false, error: result?.error ?? 'Erro desconhecido' })
  }

  return res.status(200).json({ ok: true, minutes_restored: result.minutes_restored })
}
