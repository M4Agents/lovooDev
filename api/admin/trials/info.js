// =============================================================================
// GET /api/admin/trials/info?company_id=<uuid>
//
// Retorna informações de trial de uma empresa cliente para a UI admin.
// Usado para exibir badge de trial, dias restantes e botão "Estender Trial".
//
// AUTENTICAÇÃO:
//   Authorization: Bearer <JWT>
//   Requer: super_admin ou system_admin de empresa do tipo 'parent'
//
// PARÂMETROS:
//   ?company_id=<uuid>   (obrigatório) — empresa cliente alvo
//
// AUTORIZAÇÃO:
//   1. auth_user_is_platform_admin()  — verifica role no banco
//   2. auth_user_is_parent_admin(company_id) — valida hierarquia parent→client
//   Ambas as verificações acontecem no backend. Frontend não é confiado.
//
// RESPOSTA (200):
//   {
//     "company_id":        "<uuid>",
//     "is_internal_trial": boolean,
//     "trial_start":       string | null,   // ISO 8601
//     "trial_end":         string | null,   // ISO 8601
//     "trial_extended":    boolean,
//     "can_extend":        boolean,
//     "days_remaining":    number | null    // null quando não está em trial ativo
//   }
//
// REGRAS:
//   is_internal_trial = status='trialing' AND stripe_subscription_id IS NULL
//   can_extend        = (trial ativo OU expirado elegível)
//                       AND trial_extended = false
//                       AND stripe_subscription_id IS NULL
//   days_remaining    = calculado apenas quando is_internal_trial = true
//
// SEGURANÇA:
//   - JWT validado via Supabase Auth API (não apenas decodificado)
//   - Hierarquia parent→client validada no banco
//   - stripe_subscription_id NUNCA retornado ao frontend
// =============================================================================

import { createClient }      from '@supabase/supabase-js'
import { getServiceSupabase } from '../../lib/credits/authContext.js'

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export default async function handler(req, res) {
  if (req.method !== 'GET') {
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
    console.error('[admin/trials/info] SUPABASE_SERVICE_ROLE_KEY não configurada')
    return res.status(500).json({ error: 'Configuração do servidor incompleta' })
  }

  // Validação real do JWT (não apenas decodificação): o Supabase Auth verifica
  // assinatura e expiração antes de retornar o user.
  const { data: { user }, error: authError } = await svc.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  // ── 2. Parâmetro obrigatório ──────────────────────────────────────────────
  const rawUrl    = req.url ?? ''
  const qs        = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : ''
  const companyId = new URLSearchParams(qs).get('company_id') ?? null

  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' })
  }

  // ── 3. Cliente com JWT do usuário (auth.uid() funciona nas RPCs) ─────────
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  // ── 4. Autorização — primeira camada: role de platform admin ─────────────
  const { data: isPlatformAdmin, error: adminError } = await supabaseUser
    .rpc('auth_user_is_platform_admin')

  if (adminError) {
    console.error('[admin/trials/info] Erro ao verificar auth_user_is_platform_admin:', adminError.message)
    return res.status(500).json({ error: 'Erro ao validar permissões' })
  }

  if (!isPlatformAdmin) {
    return res.status(403).json({ error: 'Apenas super_admin ou system_admin podem consultar trials' })
  }

  // ── 5. Autorização — segunda camada: hierarquia parent → client ──────────
  // auth_user_is_parent_admin(company_id) retorna true apenas se a empresa
  // informada é filha direta da empresa parent do usuário autenticado.
  // Impede acesso a empresas de outras parent companies.
  const { data: isParentAdmin, error: hierarchyError } = await supabaseUser
    .rpc('auth_user_is_parent_admin', { p_company_id: companyId })

  if (hierarchyError) {
    console.error('[admin/trials/info] Erro ao verificar auth_user_is_parent_admin:', hierarchyError.message)
    return res.status(500).json({ error: 'Erro ao validar hierarquia de acesso' })
  }

  if (!isParentAdmin) {
    return res.status(403).json({ error: 'Empresa não encontrada ou sem acesso' })
  }

  // ── 6. Buscar dados de trial ──────────────────────────────────────────────
  try {
    const { data: sub, error: subError } = await svc
      .from('company_subscriptions')
      .select('status, trial_start, trial_end, trial_extended, stripe_subscription_id')
      .eq('company_id', companyId)
      .maybeSingle()

    if (subError) {
      console.error('[admin/trials/info] Erro ao buscar subscription:', subError.message)
      return res.status(500).json({ error: 'Erro ao buscar dados do trial' })
    }

    // Empresa sem subscription (não criada via fluxo de trial)
    if (!sub) {
      return res.status(200).json({
        company_id:        companyId,
        is_internal_trial: false,
        trial_start:       null,
        trial_end:         null,
        trial_extended:    false,
        can_extend:        false,
        days_remaining:    null,
      })
    }

    // Trial interno: trialing sem assinatura Stripe vinculada
    const isInternalTrial = sub.status === 'trialing' && !sub.stripe_subscription_id

    // Trial expirado elegível: cancelado (pelo cron), sem Stripe, com trial_end registrado
    // Ainda pode ser estendido se trial_extended = false
    const isExpiredTrial  = sub.status === 'canceled'
      && !sub.stripe_subscription_id
      && !!sub.trial_end

    // Empresa elegível para extensão:
    //   - trial ativo OU trial expirado elegível
    //   - ainda não foi estendido
    //   - sem assinatura Stripe (não converteu para plano pago)
    const canExtend = (isInternalTrial || isExpiredTrial)
      && !sub.trial_extended
      && !sub.stripe_subscription_id

    // Dias restantes: calculado apenas quando trial está ativo
    let daysRemaining = null
    if (isInternalTrial && sub.trial_end) {
      const now  = Date.now()
      const end  = new Date(sub.trial_end).getTime()
      const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24))
      daysRemaining = Math.max(0, diff)
    }

    return res.status(200).json({
      company_id:        companyId,
      is_internal_trial: isInternalTrial,
      trial_start:       sub.trial_start    ?? null,
      trial_end:         sub.trial_end      ?? null,
      trial_extended:    sub.trial_extended ?? false,
      can_extend:        canExtend,
      days_remaining:    daysRemaining,
    })

  } catch (err) {
    console.error('[admin/trials/info] Erro interno:', err)
    return res.status(500).json({ error: 'Erro interno ao consultar trial' })
  }
}
