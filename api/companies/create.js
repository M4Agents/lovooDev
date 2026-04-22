// =============================================================================
// POST /api/companies/create
//
// Ponto oficial de criação de empresa cliente (filha).
// Executa de forma transacional via RPC SECURITY DEFINER:
//   1. Cria empresa na tabela companies (plan_id = Growth)
//   2. Associa super_admin da empresa pai via company_users
//   3. Cria company_subscriptions com status='trialing' e trial_end = NOW()+14d
//   4. Auto-assignment em partner_company_assignments (se caller for partner)
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   Requer: super_admin ou system_admin de empresa do tipo 'parent'
//
// BODY (JSON):
//   {
//     "name":            string (obrigatório)
//     "parentCompanyId": string (obrigatório, UUID da empresa pai)
//     "domain":          string (opcional)
//   }
//
// RESPOSTA (201):
//   {
//     "company_id":    "<uuid>",
//     "trial_started": boolean,
//     "trial_end":     string | null,   // ISO 8601
//     "auto_assigned": boolean
//   }
//
// ERROS:
//   400 — dados inválidos ou regra de negócio violada
//   401 — sem autenticação
//   403 — sem permissão (role insuficiente)
//   500 — erro interno
//
// SEGURANÇA:
//   - JWT validado via auth_user_is_platform_admin() (camada 1 do backend)
//   - create_client_company_safe valida novamente via auth.uid() (camada 2 — RPC)
//   - parentCompanyId nunca é confiado sem validação — a RPC verifica o vínculo
//   - service_role usado apenas após dupla validação
//   - Nenhum dado sensível retornado ao frontend (stripe_*, plan_id interno, etc.)
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Mapa de erros RPC → HTTP status + mensagem legível
const RPC_ERROR_MAP = {
  'unauthenticated':                                                           { status: 401, msg: 'Não autenticado' },
  'parent company not found':                                                  { status: 400, msg: 'Empresa pai não encontrada' },
  'target is not a parent company':                                            { status: 400, msg: 'Empresa informada não é do tipo parent' },
  'forbidden: only super_admin, system_admin or partner can create client companies': { status: 403, msg: 'Apenas super_admin, system_admin ou partner podem criar empresas cliente' },
  'no active super_admin found in parent company':                             { status: 500, msg: 'Empresa pai não possui super_admin ativo' },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  // ── 1. Autenticação ─────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação necessário' })
  }
  const userToken = authHeader.slice(7)

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[companies/create] Variáveis de ambiente Supabase não configuradas')
    return res.status(500).json({ error: 'Configuração do servidor incompleta' })
  }

  // ── 2. Parse do body ────────────────────────────────────────────────────────
  let body = {}
  try {
    body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')
  } catch {
    return res.status(400).json({ error: 'Body inválido' })
  }

  const { name, parentCompanyId, domain } = body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name é obrigatório' })
  }
  if (!parentCompanyId || typeof parentCompanyId !== 'string') {
    return res.status(400).json({ error: 'parentCompanyId é obrigatório' })
  }

  // ── 3. Cliente com JWT do usuário (auth.uid() funciona em RPCs) ─────────────
  // Usa service_role key para acesso ao banco, mas propaga o JWT do usuário no
  // header Authorization para que as RPCs (SECURITY DEFINER) possam validar
  // auth.uid() internamente.
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  // ── 4. Validar permissão: apenas platform_admin pode criar empresas cliente ─
  // Primeira camada de autorização (backend). A segunda está dentro da RPC.
  const { data: isPlatformAdmin, error: adminCheckError } = await supabaseUser
    .rpc('auth_user_is_platform_admin')

  if (adminCheckError) {
    console.error('[companies/create] Erro ao verificar auth_user_is_platform_admin:', adminCheckError.message)
    return res.status(500).json({ error: 'Erro ao validar permissões do usuário' })
  }

  if (!isPlatformAdmin) {
    return res.status(403).json({
      error: 'Apenas super_admin ou system_admin podem criar empresas cliente',
    })
  }

  // ── 5. Criar empresa via RPC — transacional ─────────────────────────────────
  //
  // create_client_company_safe executa numa única transação:
  //   - Cria companies (plan_id = Growth, company_type = 'client')
  //   - Cria company_users para o super_admin da parent
  //   - Cria company_subscriptions (status='trialing', trial_end = NOW()+14d)
  //   - Auto-assignment de partner (se caller for partner)
  //
  // A RPC valida internamente a autorização via auth.uid() (segunda camada).
  // Se o caller não for super_admin/system_admin/partner da parent, retorna error.
  try {
    const { data: rpcResult, error: rpcError } = await supabaseUser
      .rpc('create_client_company_safe', {
        p_parent_company_id: parentCompanyId,
        p_name:              name.trim(),
        p_domain:            domain?.trim() ?? null,
      })

    if (rpcError) {
      console.error('[companies/create] Erro na RPC:', rpcError.message, {
        name, parentCompanyId,
      })
      return res.status(500).json({ error: 'Erro ao criar empresa' })
    }

    if (!rpcResult?.success) {
      const errCode = rpcResult?.error ?? 'unknown_error'
      const mapped  = RPC_ERROR_MAP[errCode]

      console.warn('[companies/create] RPC retornou success=false:', {
        errCode, name, parentCompanyId,
      })

      return res.status(mapped?.status ?? 400).json({
        error: mapped?.msg ?? errCode,
      })
    }

    const companyId = rpcResult.company_id

    console.log('[companies/create] Empresa cliente criada com sucesso:', {
      companyId,
      parentCompanyId,
      trial_started: rpcResult.trial_started,
      trial_end:     rpcResult.trial_end,
      auto_assigned: rpcResult.auto_assigned,
    })

    return res.status(201).json({
      company_id:    companyId,
      trial_started: rpcResult.trial_started ?? false,
      trial_end:     rpcResult.trial_end     ?? null,
      auto_assigned: rpcResult.auto_assigned ?? false,
    })

  } catch (err) {
    console.error('[companies/create] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao criar empresa' })
  }
}
