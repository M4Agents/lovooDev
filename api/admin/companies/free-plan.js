// =============================================================================
// POST /api/admin/companies/free-plan
//
// Concede ou revoga o plano gratuito para uma empresa filha.
// Exclusivo de super_admin — system_admin não tem acesso.
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   Requer: super_admin de empresa do tipo 'parent' (is_active = true)
//
// BODY (JSON):
//   {
//     "company_id": "<uuid>",  (obrigatório)
//     "is_free":    boolean    (obrigatório)
//   }
//
// RESPOSTA (200):
//   {
//     "success": true,
//     "is_free": boolean
//   }
//
// ERROS:
//   400 company_id_required        — campo obrigatório ausente
//   400 is_free_required           — campo obrigatório ausente ou tipo inválido
//   401 unauthenticated            — JWT inválido ou expirado
//   403 forbidden                  — não é super_admin de empresa parent
//   404 company_not_found          — empresa não existe ou está deletada
//   422 not_a_client_company       — empresa alvo não é do tipo 'client'
//   422 subscription_not_found     — empresa não possui registro em company_subscriptions
//   422 has_stripe_subscription    — empresa possui Stripe ativo
//   500 growth_plan_not_found      — plano Growth não encontrado ou inativo
//   500                            — erro interno
//
// SEGURANÇA:
//   - JWT validado via Supabase Auth API (não apenas decodificado)
//   - Autorização de super_admin verificada no backend (camada 1) — fast-fail
//   - set_company_free_plan valida p_actor_user_id internamente (camada 2)
//   - p_actor_user_id enviado explicitamente — backend usa service_role (sem JWT propagado)
//   - system_admin é explicitamente excluído (role = 'super_admin' apenas)
// =============================================================================

import { getServiceSupabase } from '../../lib/credits/authContext.js'

// ── Mapeamento de erros RPC → HTTP ───────────────────────────────────────────
const RPC_ERROR_MAP = {
  'forbidden':               { status: 403, code: 'forbidden' },
  'company_not_found':       { status: 404, code: 'company_not_found' },
  'not_a_client_company':    { status: 422, code: 'not_a_client_company' },
  'subscription_not_found':  { status: 422, code: 'subscription_not_found' },
  'has_stripe_subscription': { status: 422, code: 'has_stripe_subscription' },
  'growth_plan_not_found':   { status: 500, code: 'growth_plan_not_found' },
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
    console.error('[admin/companies/free-plan] SUPABASE_SERVICE_ROLE_KEY não configurada')
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

  const { company_id: companyId, is_free: isFree } = body

  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'company_id_required' })
  }
  if (typeof isFree !== 'boolean') {
    return res.status(400).json({ error: 'is_free_required' })
  }

  // ── 3. Autorização — camada 1: super_admin em empresa parent ─────────────
  // Fast-fail antes de chamar a RPC. A RPC valida novamente internamente (camada 2).
  // system_admin é explicitamente excluído: role = 'super_admin' apenas.
  const { data: isSuperAdmin, error: roleError } = await svc
    .from('company_users')
    .select('id, companies!inner(company_type)')
    .eq('user_id', user.id)
    .eq('role', 'super_admin')
    .eq('is_active', true)
    .eq('companies.company_type', 'parent')
    .maybeSingle()

  if (roleError) {
    console.error('[admin/companies/free-plan] Erro ao verificar role:', roleError.message)
    return res.status(500).json({ error: 'Erro ao validar permissões' })
  }

  if (!isSuperAdmin) {
    return res.status(403).json({ error: 'forbidden' })
  }

  // ── 4. Chamar RPC set_company_free_plan ──────────────────────────────────
  // p_actor_user_id passado explicitamente — service_role não propaga JWT do usuário.
  // A RPC valida as permissões do actor internamente (segunda camada de segurança).
  try {
    const { data: rpcResult, error: rpcError } = await svc.rpc('set_company_free_plan', {
      p_actor_user_id: user.id,
      p_company_id:    companyId,
      p_is_free:       isFree,
    })

    if (rpcError) {
      console.error('[admin/companies/free-plan] Erro na RPC set_company_free_plan:', rpcError.message, {
        companyId, userId: user.id, isFree,
      })
      return res.status(500).json({ error: 'Erro ao processar operação' })
    }

    if (!rpcResult?.success) {
      const errCode = rpcResult?.error ?? 'unknown_error'
      const { status, code } = mapRpcError(errCode)

      console.warn('[admin/companies/free-plan] RPC retornou success=false:', {
        errCode, companyId, userId: user.id, isFree,
      })

      return res.status(status).json({ error: code })
    }

    console.log('[admin/companies/free-plan] Operação concluída com sucesso:', {
      companyId,
      userId: user.id,
      isFree,
    })

    return res.status(200).json({
      success: true,
      is_free: isFree,
    })

  } catch (err) {
    console.error('[admin/companies/free-plan] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao processar operação' })
  }
}
