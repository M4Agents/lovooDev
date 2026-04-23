import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'incomplete'
  | 'canceled'
  | null

export interface PlanSubscription {
  has_subscription:     boolean
  status:               SubscriptionStatus
  // true quando status='trialing' e stripe_subscription_id IS NULL (trial interno, não Stripe)
  is_internal_trial:    boolean
  // calculado no backend: dias até current_period_end (ceil, mín 0); null se não for trial interno
  days_remaining:       number | null
  plan_name:            string | null
  billing_cycle:        'monthly' | 'yearly' | null
  current_period_end:   string | null
  cancel_at_period_end: boolean
  scheduled_plan_name:  string | null
  last_invoice_url:     string | null
}

const DEFAULT_EMPTY: PlanSubscription = {
  has_subscription:     false,
  status:               null,
  is_internal_trial:    false,
  days_remaining:       null,
  plan_name:            null,
  billing_cycle:        null,
  current_period_end:   null,
  cancel_at_period_end: false,
  scheduled_plan_name:  null,
  last_invoice_url:     null,
}

export function usePlanSubscription(companyId: string | null | undefined) {
  const [data, setData]       = useState<PlanSubscription | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    if (!companyId) return

    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setError('Sessão inválida')
        return
      }

      const url = `/api/plans/subscription?company_id=${encodeURIComponent(companyId)}`
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })

      const json = await resp.json()

      if (!resp.ok) {
        // 404 ou empresa sem assinatura — trata como sem assinatura (não erro)
        setData(DEFAULT_EMPTY)
        return
      }

      setData(json)
    } catch {
      setError('Erro de conexão ao carregar assinatura')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    fetch_()
  }, [fetch_])

  return { data, loading, error, refetch: fetch_ }
}
