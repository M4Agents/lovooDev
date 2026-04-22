// =============================================================================
// POST /api/admin/trials/extend
//
// Estende o período de trial de uma empresa cliente em +14 dias (máximo 1x).
// Usa a RPC extend_company_trial que é transacional e valida todas as regras
// internamente (hierarquia, limite de extensão, estado do trial, etc.).
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   Requer: super_admin ou system_admin de empresa do tipo 'parent'
//
// BODY (JSON):
//   {
//     "company_id": "<uuid>",   (obrigatório)
//     "notes":      "..."        (opcional — registrado na auditoria)
//   }
//
// RESPOSTA (200):
//   {
//     "success":        true,
//     "trial_extended": true,
//     "trial_end":      string,    // ISO 8601 — nova data de expiração
//     "reactivated":    boolean    // true se trial havia expirado e foi reativado
//   }
//
// ERROS:
//   400 company_id_required         — campo obrigatório ausente
//   401 unauthenticated             — JWT inválido ou expirado
//   403 forbidden                   — role insuficiente ou hierarquia parent→client inválida
//   404 company_not_found           — empresa alvo não existe
//   409 trial_already_extended      — limite de 1 extensão atingido
//   409 not_internal_trial          — empresa já tem assinatura Stripe ativa
//   409 trial_not_started           — empresa não possui subscription de trial
//   409 trial_not_eligible          — empresa não está em estado de trial elegível
//   500                             — erro interno
//
// SEGURANÇA:
//   - JWT validado via Supabase Auth API (não apenas decodificado)
//   - auth_user_is_platform_admin() validado no backend (camada 1)
//   - extend_company_trial valida role + hierarquia novamente internamente (camada 2)
//   - p_requester_id enviado e validado contra auth.uid() dentro da RPC
//   - Nenhuma lógica de extensão está no frontend
// =============================================================================

import { createClient }      from '@supabase/supabase-js'
import { getServiceSupabase } from '../../lib/credits/authContext.js'

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// ── Mapeamento de erros RPC → HTTP ──────────────────────────────────────────
// Cada chave é a string exata retornada pelo campo "error" da RPC.
// Erros com startsWith são tratados separadamente em mapRpcError().
const RPC_ERROR_MAP = {
  'unauthenticated':
    { status: 401, code: 'unauthenticated' },
  'requester_id mismatch':
    { status: 401, code: 'unauthenticated' },
  'forbidden: apenas super_admin ou system_admin de empresa parent podem estender trials':
    { status: 403, code: 'forbidden' },
  'target company not found':
    { status: 404, code: 'company_not_found' },
  'target is not a client company':
    { status: 400, code: 'not_client_company' },
  'forbidden: empresa alvo não pertence à sua parent company':
    { status: 403, code: 'forbidden' },
  'empresa não possui subscription — trial não iniciado':
    { status: 409, code: 'trial_not_started' },
  'empresa já possui subscription Stripe ativa — extensão de trial não aplicável':
    { status: 409, code: 'not_internal_trial' },
  'trial já foi estendido — apenas 1 extensão permitida por empresa':
    { status: 409, code: 'trial_already_extended' },
  'plano Growth não encontrado — não é possível reativar trial':
    { status: 500, code: 'growth_plan_not_found' },
}

function mapRpcError(errMsg) {
  if (!errMsg) return { status: 400, code: 'unknown_error' }

  // Erro variável (inclui o status atual da empresa no final da string)
  if (errMsg.startsWith('empresa não está em estado de trial')) {
    return { status: 409, code: 'trial_not_eligible' }
  }

  return RPC_ERROR_MAP[errMsg] ?? { status: 400, code: errMsg }
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
    console.error('[admin/trials/extend] SUPABASE_SERVICE_ROLE_KEY não configurada')
    return res.status(500).json({ error: 'Configuração do servidor incompleta' })
  }

  // Validação real do JWT: o Supabase Auth verifica assinatura e expiração.
  // Também retorna o user.id necessário para passar como p_requester_id à RPC.
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

  const { company_id: companyId, notes } = body

  if (!companyId || typeof companyId !== 'string') {
    return res.status(400).json({ error: 'company_id_required' })
  }

  // ── 3. Cliente com JWT do usuário (auth.uid() funciona nas RPCs) ─────────
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  // ── 4. Autorização — primeira camada: role de platform admin ─────────────
  // Fast-fail antes de chamar a RPC pesada. A RPC valida novamente internamente.
  const { data: isPlatformAdmin, error: adminError } = await supabaseUser
    .rpc('auth_user_is_platform_admin')

  if (adminError) {
    console.error('[admin/trials/extend] Erro ao verificar auth_user_is_platform_admin:', adminError.message)
    return res.status(500).json({ error: 'Erro ao validar permissões' })
  }

  if (!isPlatformAdmin) {
    return res.status(403).json({ error: 'forbidden' })
  }

  // ── 5. Executar extensão via RPC ─────────────────────────────────────────
  //
  // extend_company_trial valida internamente (segunda camada):
  //   - auth.uid() corresponde a p_requester_id (previne falsificação)
  //   - caller é super_admin ou system_admin de empresa parent
  //   - empresa alvo é client filha da parent do caller
  //   - trial não foi estendido anteriormente (limite 1x)
  //   - sem assinatura Stripe ativa (trial interno apenas)
  //   - empresa está em status elegível (trialing ou canceled sem Stripe)
  //   - registra auditoria em trial_extensions
  try {
    const { data: rpcResult, error: rpcError } = await supabaseUser
      .rpc('extend_company_trial', {
        p_company_id:   companyId,
        p_requester_id: user.id,
        p_notes:        typeof notes === 'string' ? notes.trim() || null : null,
      })

    if (rpcError) {
      console.error('[admin/trials/extend] Erro na RPC extend_company_trial:', rpcError.message, {
        companyId, userId: user.id,
      })
      return res.status(500).json({ error: 'Erro ao estender trial' })
    }

    if (!rpcResult?.success) {
      const errMsg = rpcResult?.error ?? 'unknown_error'
      const { status, code } = mapRpcError(errMsg)

      console.warn('[admin/trials/extend] RPC retornou success=false:', {
        errMsg, companyId, userId: user.id,
      })

      return res.status(status).json({ error: code })
    }

    console.log('[admin/trials/extend] Trial estendido com sucesso:', {
      companyId,
      userId:      user.id,
      originalEnd: rpcResult.original_end,
      newEnd:      rpcResult.new_end,
      reactivated: rpcResult.reactivated ?? false,
    })

    return res.status(200).json({
      success:        true,
      trial_extended: true,
      trial_end:      rpcResult.new_end   ?? null,
      reactivated:    rpcResult.reactivated ?? false,
    })

  } catch (err) {
    console.error('[admin/trials/extend] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao processar extensão de trial' })
  }
}
