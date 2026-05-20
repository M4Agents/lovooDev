// =====================================================
// dashboardActivationApi
// Serviço isolado para GET /api/dashboard/activation.
// Segue o mesmo padrão de auth do dashboardApi.ts:
//   supabase.auth.getSession() → Bearer token
// NÃO importar nem re-exportar nada de dashboardApi.ts.
// =====================================================

import { supabase }              from '../lib/supabase'
import type { DashboardFilters } from '../types/dashboard'
import type { ActivationResponse } from '../types/dashboard-activation'

// ---------------------------------------------------------------------------
// Mapeamento de PeriodType → period key do backend
// Espelha o PERIOD_TYPE_MAP de dashboardApi.ts sem importá-lo.
// ---------------------------------------------------------------------------

const PERIOD_TYPE_MAP: Record<string, string> = {
  today:        'today',
  yesterday:    'yesterday',
  '7days':      '7d',
  '15days':     '15d',
  '30days':     '30d',
  this_month:   'month',
  last_month:   'last_month',
  '90days':     '90d',
  this_quarter: 'quarter',
  this_year:    'year',
  custom:       'custom',
}

function toPeriodKey(type: string): string {
  return PERIOD_TYPE_MAP[type] ?? '30d'
}

// ---------------------------------------------------------------------------
// Helper interno: obtém token da sessão atual
// ---------------------------------------------------------------------------

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

// ---------------------------------------------------------------------------
// getActivation
// ---------------------------------------------------------------------------

async function getActivation(
  companyId: string,
  filters:   DashboardFilters,
  signal?:   AbortSignal,
): Promise<ActivationResponse> {
  const token = await getToken()
  if (!token) throw new Error('Sessão expirada. Faça login novamente.')

  const params = new URLSearchParams()
  params.set('company_id', companyId)

  const periodKey = toPeriodKey(filters.period.type)
  params.set('period', periodKey)

  if (periodKey === 'custom') {
    if (filters.period.startDate) params.set('start_date', filters.period.startDate)
    if (filters.period.endDate)   params.set('end_date',   filters.period.endDate)
  }

  if (filters.userId) params.set('user_id', filters.userId)

  const url = `/api/dashboard/activation?${params.toString()}`

  const res = await fetch(url, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `Erro ${res.status} ao buscar dados de ativação`)
  }

  return res.json() as Promise<ActivationResponse>
}

export const dashboardActivationApi = { getActivation }
