// =============================================================================
// POST /api/admin/companies/set-plan
//
// Atribui um plano diretamente a uma empresa filha, sem fluxo Stripe.
// Exclusivo de super_admin — para gerenciamento direto de empresas is_free.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   Requer: super_admin de empresa do tipo 'parent' (is_active = true)
//
// BODY (JSON):
//   {
//     "company_id": "<uuid>",  (obrigatório)
//     "plan_id":    "<uuid>"   (obrigatório)
//   }
//
// RESPOSTA (200):
//   {
//     "success":   true,
//     "plan_id":   "<uuid>",
//     "plan_name": "<string>"
//   }
//
// ERROS:
//   400 company_id_required        — campo obrigatório ausente
//   400 plan_id_required           — campo obrigatório ausente
//   401 unauthenticated            — JWT inválido ou expirado
//   403 forbidden                  — não é super_admin de empresa parent
//   404 company_not_found          — empresa não existe ou está deletada
//   422 not_a_client_company       — empresa alvo não é do tipo 'client'
//   422 subscription_not_found     — empresa não possui registro em company_subscriptions
//   422 has_stripe_subscription    — empresa possui Stripe ativo (gerenciar pelo Stripe)
//   422 plan_not_found             — plano não existe ou está inativo
//   500                            — erro interno
//
// SEGURANÇA:
//   - JWT validado via Supabase Auth API (não apenas decodificado)
//   - Autorização de super_admin verificada no backend (camada 1) — fast-fail
//   - admin_set_company_plan valida p_actor_user_id internamente (camada 2)
//   - p_actor_user_id enviado explicitamente — backend usa service_role (sem JWT propagado)
//   - system_admin é explicitamente excluído (role = 'super_admin' apenas)
// =============================================================================

import { getServiceSupabase } from '../../lib/credits/authContext.js'

const RPC_ERROR_MAP = {
  'forbidden':               { status: 403, code: 'forbidden' },
  'company_not_found':       { status: 404, code: 'company_not_found' },
  'not_a_client_company':    { status: 422, code: 'not_a_client_company' },
  'subscription_not_found':  { status: 422, code: 'subscription_not_found' },
  'has_stripe_subscription': { status: 422, code: 'has_stripe_subscription' },
  'plan_not_found':          { status: 422, code: 'plan_not_found' },
}

function mapRpcError(errCode) {
  return RPC_ERROR_MAP[errCode] ?? { status: 400, code: errCode ?? 'unknown_error' }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Autenticação — validar JWT via Supabase Auth ──────────────────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' })
  }
  const token = authHeader.slice(7)

  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[admin/companies/set-plan] SUPABASE_SERVICE_ROLE_KEY não configurada')
    return res.status(500).json({ error: 'Configuração do servidor incompleta' })
  }

  const { data: { user }, error: authError } = await svc.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  // ── 2. Parse do body ─────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ error: 'Body inválido' })
  }

  const { company_id: companyId, plan_id: planId } = body

  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'company_id_required' })
  }
  if (!planId || typeof planId !== 'string') {
    return res.status(400).json({ error: 'plan_id_required' })
  }

  // ── 3. Autorização — camada 1: super_admin em empresa parent ─────────────
  // Fast-fail antes de chamar a RPC. A RPC valida novamente internamente (camada 2).
  const { data: isSuperAdmin, error: roleError } = await svc
    .from('company_users')
    .select('id, companies!inner(company_type)')
    .eq('user_id', user.id)
    .eq('role', 'super_admin')
    .eq('is_active', true)
    .eq('companies.company_type', 'parent')
    .maybeSingle()

  if (roleError) {
    console.error('[admin/companies/set-plan] Erro ao verificar role:', roleError.message)
    return res.status(500).json({ error: 'Erro ao validar permissões' })
  }

  if (!isSuperAdmin) {
    return res.status(403).json({ error: 'forbidden' })
  }

  // ── 4. Chamar RPC admin_set_company_plan ─────────────────────────────────
  try {
    const { data: rpcResult, error: rpcError } = await svc.rpc('admin_set_company_plan', {
      p_actor_user_id: user.id,
      p_company_id:    companyId,
      p_plan_id:       planId,
    })

    if (rpcError) {
      console.error('[admin/companies/set-plan] Erro na RPC admin_set_company_plan:', rpcError.message, {
        companyId, planId, userId: user.id,
      })
      return res.status(500).json({ error: 'Erro ao processar operação' })
    }

    if (!rpcResult?.success) {
      const errCode = rpcResult?.error ?? 'unknown_error'
      const { status, code } = mapRpcError(errCode)

      console.warn('[admin/companies/set-plan] RPC retornou success=false:', {
        errCode, companyId, planId, userId: user.id,
      })

      return res.status(status).json({ error: code })
    }

    console.log('[admin/companies/set-plan] Plano atribuído com sucesso:', {
      companyId,
      planId,
      planName: rpcResult.plan_name,
      userId: user.id,
    })

    return res.status(200).json({
      success:   true,
      plan_id:   rpcResult.plan_id,
      plan_name: rpcResult.plan_name,
    })

  } catch (err) {
    console.error('[admin/companies/set-plan] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao processar operação' })
  }
}
