// =============================================================================
// POST /api/cron/expire-trials
//
// Cron de expiração automática de trials vencidos.
//
// SEGURANÇA:
//   Authorization: Bearer <CRON_SECRET>
//   Rejeita qualquer requisição sem token válido.
//   Sem JWT de usuário — service_role exclusivo.
//
// EXECUÇÃO:
//   Chama a RPC expire_overdue_trials() que:
//     1. Busca empresas com status='trialing' AND trial_end < NOW()
//        AND stripe_subscription_id IS NULL
//     2. Para cada: company_subscriptions.status → 'canceled'
//                   companies.plan_id → suspended (via apply_operational_plan_change)
//   A RPC é transacional e idempotente: re-executar não causa duplicações.
//
// AGENDAMENTO:
//   "0 3 * * *" — 03:00 UTC diariamente (configurado em vercel.json)
//
// VARIÁVEIS DE AMBIENTE OBRIGATÓRIAS:
//   CRON_SECRET             — segredo compartilhado para autenticar o cron
//   SUPABASE_SERVICE_ROLE_KEY — chave service_role do Supabase
//   VITE_SUPABASE_URL        — URL do projeto Supabase
// =============================================================================

import { createClient } from '@supabase/supabase-js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getServiceSupabase() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url.trim() || !key.trim()) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validateCronAuth(req) {
  const cronSecret = process.env.CRON_SECRET ?? ''
  // Rejeita se CRON_SECRET não estiver configurado
  if (!cronSecret) return false
  const auth = req.headers.authorization ?? ''
  return auth === `Bearer ${cronSecret}`
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' })
  }

  // ── 1. Validar autenticação do cron ────────────────────────────────────────
  if (!validateCronAuth(req)) {
    console.warn('[cron/expire-trials] Tentativa de acesso sem CRON_SECRET válido')
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[cron/expire-trials] SUPABASE_SERVICE_ROLE_KEY não configurado')
    return res.status(500).json({ ok: false, error: 'Supabase service_role não configurado' })
  }

  const executedAt = new Date().toISOString()
  console.log('[cron/expire-trials] Iniciando expiração de trials | timestamp:', executedAt)

  // ── 2. Executar RPC expire_overdue_trials() ────────────────────────────────
  // A RPC busca e expira todos os trials vencidos numa única transação.
  // Retorna: { success, expired, errors, executed_at }
  const { data, error } = await svc.rpc('expire_overdue_trials')

  if (error) {
    console.error('[cron/expire-trials] Erro ao chamar expire_overdue_trials:', error.message)
    return res.status(500).json({
      ok:    false,
      error: 'Erro ao executar expiração de trials',
    })
  }

  const result = data?.[0] ?? data ?? {}

  console.log(
    '[cron/expire-trials] Concluído |',
    'expired:', result.expired ?? 0, '|',
    'errors:',  result.errors  ?? 0, '|',
    'rpc_executed_at:', result.executed_at ?? executedAt
  )

  return res.status(200).json({
    ok:          true,
    expired:     result.expired     ?? 0,
    errors:      result.errors      ?? 0,
    executed_at: result.executed_at ?? executedAt,
  })
}
