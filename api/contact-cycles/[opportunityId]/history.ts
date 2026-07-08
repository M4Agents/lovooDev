// =====================================================
// GET /api/contact-cycles/[opportunityId]/history
//
// Retorna o histórico de ciclos de contato de uma oportunidade,
// com contagem de tentativas por ciclo.
//
// Chama a RPC get_contact_cycle_history, que já valida internamente
// o vínculo opportunity_id <-> company_id.
//
// Campos retornados por ciclo:
//   cycle_id      uuid
//   status        text  ('open' | 'closed')
//   close_reason  text | null
//   opened_at     timestamptz
//   closed_at     timestamptz | null
//   attempt_count bigint
//
// RBAC: seller+ (qualquer membro ativo)
// Somente leitura — nenhum dado é alterado.
// =====================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method !== 'GET') {
    jsonError(res, 405, 'Método não permitido')
    return
  }

  try {
    // ------------------------------------------------------------------
    // 1. Auth
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // ------------------------------------------------------------------
    // 2. company_id + membership (seller+ tem acesso)
    // ------------------------------------------------------------------
    const companyId =
      typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. opportunityId da rota dinâmica
    // ------------------------------------------------------------------
    const opportunityId =
      typeof req.query.opportunityId === 'string' ? req.query.opportunityId.trim() : ''
    if (!opportunityId) { jsonError(res, 400, 'opportunityId é obrigatório'); return }

    // ------------------------------------------------------------------
    // 4. Anti-IDOR — confirmar que opportunity pertence à empresa
    //    (a RPC também valida, mas a checagem aqui garante 404 antes
    //    de propagar a exception da RPC ao cliente)
    // ------------------------------------------------------------------
    const { data: opportunity, error: oppError } = await svc
      .from('opportunities')
      .select('id')
      .eq('id', opportunityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (oppError) {
      console.error('[contact-cycles/history] opportunity lookup error:', oppError)
      jsonError(res, 500, 'Erro ao verificar oportunidade')
      return
    }

    if (!opportunity) {
      jsonError(res, 404, 'Oportunidade não encontrada')
      return
    }

    // ------------------------------------------------------------------
    // 5. Chamar RPC get_contact_cycle_history
    //    Retorno vazio é tratado como lista vazia — não é erro.
    //    cycle_id nunca aceito do frontend — a RPC filtra por opportunity_id.
    // ------------------------------------------------------------------
    const { data: cycles, error: rpcError } = await svc.rpc('get_contact_cycle_history', {
      p_opportunity_id: opportunityId,
      p_company_id:     companyId,
    })

    if (rpcError) {
      console.error('[contact-cycles/history] get_contact_cycle_history error:', rpcError)

      const msg = rpcError.message ?? ''
      if (msg.includes('UNAUTHORIZED')) {
        jsonError(res, 403, 'Acesso negado pela validação de banco')
        return
      }

      jsonError(res, 500, 'Erro ao buscar histórico de ciclos')
      return
    }

    res.status(200).json({ ok: true, data: { cycles: cycles ?? [] } })

  } catch (err) {
    console.error('[contact-cycles/history] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
