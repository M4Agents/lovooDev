import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface PlanCard {
  id: string
  name: string
  slug: string
  sort_order: number
  is_popular: boolean
  max_leads: number | null
  max_users: number | null
  max_funnels: number | null
  max_funnel_stages: number | null
  max_automation_flows: number | null
  max_automation_executions_monthly: number | null
  max_products: number | null
  max_whatsapp_instances: number | null
  storage_mb: number | null
  features: Record<string, boolean>
  is_current: boolean
  direction: 'current' | 'upgrade' | 'downgrade' | 'same'
  is_accessible: boolean
  blocked_by: string[]
  is_stripe_purchasable: boolean
}

export interface UsageSnapshot {
  leads: number
  users: number
  funnels: number
  auto_flows: number
  storage_mb: number
}

export interface PendingRequest {
  id: string
  to_plan_id: string
  to_plan_name: string | null
  to_plan_slug: string | null
  status: string
  created_at: string
}

export interface PlanAvailableData {
  current_plan_id: string | null
  usage: UsageSnapshot
  plans: PlanCard[]
  pending_request: PendingRequest | null
}

export function usePlanAvailable(companyId: string | null | undefined) {
  const [data, setData]       = useState<PlanAvailableData | null>(null)
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

      const resp = await fetch('/api/plans/available', {
        headers: { Authorization: `Bearer ${token}` },
      })

      const json = await resp.json()

      if (!resp.ok) {
        setError(json.error ?? 'Erro ao carregar planos')
        return
      }

      setData(json)
    } catch {
      setError('Erro de conexão ao carregar planos')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    fetch_()
  }, [fetch_])

  return { data, loading, error, refetch: fetch_ }
}
