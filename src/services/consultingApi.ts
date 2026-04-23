// =============================================================================
// src/services/consultingApi.ts
//
// Funções de acesso aos endpoints do módulo de Pacotes de Consultoria.
//
// SEGURANÇA:
//   - company_id NUNCA enviado no body — sempre via query param (resolvido no backend)
//   - Bearer token sempre obrigatório
//   - Nenhum valor financeiro é construído no frontend
// =============================================================================

import { supabase } from '../lib/supabase'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface BonusCreditPackage {
  id:      string
  name:    string
  credits: number
}

export interface ConsultingPackage {
  id:                     string
  name:                   string
  description:            string | null
  package_type:           'implementation' | 'training' | 'consulting'
  hours:                  number
  price:                  number
  is_active:              boolean
  is_available_for_sale:  boolean
  bonus_credit_package_id: string | null
  bonus_credit:           BonusCreditPackage | null
  created_at?:            string
  updated_at?:            string
}

export interface ConsultingOrder {
  id:                               string
  company_id:                       string
  consulting_package_id:            string
  hours_snapshot:                   number
  price_snapshot:                   number
  package_name_snapshot:            string
  package_type_snapshot:            string
  bonus_credits_snapshot:           number | null
  bonus_credit_name_snapshot:       string | null
  stripe_session_id:                string | null
  status:                           'pending_payment' | 'checkout_created' | 'paid' | 'failed' | 'cancelled' | 'expired'
  paid_at:                          string | null
  created_at:                       string
}

export interface ConsultingBalance {
  total_credited_minutes: number
  used_minutes:           number
  available_minutes:      number
  total_credited_hours:   number
  used_hours:             number
  available_hours:        number
  updated_at:             string | null
}

export interface ConsultingTimeEntry {
  id:                   string
  company_id:           string
  entry_date:           string
  start_time:           string
  end_time:             string
  duration_minutes:     number
  description:          string
  entry_type:           'implementation' | 'training' | 'consulting'
  performed_by_user_id: string | null
  created_by:           string
  deleted_at:           string | null
  created_at:           string
}

export interface NewTimeEntryPayload {
  entry_date:            string
  start_time:            string
  end_time:              string
  description:           string
  entry_type:            'implementation' | 'training' | 'consulting'
  performed_by_user_id?: string | null
}

export interface ConsultingPackagePayload {
  name:                   string
  description?:           string | null
  package_type:           'implementation' | 'training' | 'consulting'
  hours:                  number
  price:                  number
  is_active?:             boolean
  is_available_for_sale?: boolean
  bonus_credit_package_id?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')
  return {
    Authorization:  `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

function buildUrl(path: string, companyId: string): string {
  return `${path}?company_id=${encodeURIComponent(companyId)}`
}

async function handleResponse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || !json.ok) {
    throw new Error((json.error as string) || `Erro ${res.status}`)
  }
  return json as T
}

// ── Pacotes (catálogo público) ─────────────────────────────────────────────

export async function fetchConsultingPackages(companyId: string): Promise<ConsultingPackage[]> {
  const headers = await getAuthHeaders()
  const res = await fetch(buildUrl('/api/consulting/packages', companyId), { headers })
  const data = await handleResponse<{ ok: boolean; packages: ConsultingPackage[] }>(res)
  return data.packages
}

// ── Saldo consultivo ──────────────────────────────────────────────────────────

export async function fetchConsultingBalance(companyId: string): Promise<ConsultingBalance> {
  const headers = await getAuthHeaders()
  const res = await fetch(buildUrl('/api/consulting/balance', companyId), { headers })
  const data = await handleResponse<{ ok: boolean; balance: ConsultingBalance }>(res)
  return data.balance
}

// ── Pedidos ───────────────────────────────────────────────────────────────────

export async function fetchConsultingOrders(
  companyId: string,
  page = 1,
  limit = 20
): Promise<{ orders: ConsultingOrder[]; total: number }> {
  const headers = await getAuthHeaders()
  const res = await fetch(
    `${buildUrl('/api/consulting-orders', companyId)}&page=${page}&limit=${limit}`,
    { headers }
  )
  const data = await handleResponse<{ ok: boolean; orders: ConsultingOrder[]; total: number }>(res)
  return { orders: data.orders, total: data.total }
}

// ── Checkout (iniciar compra via Stripe) ──────────────────────────────────────

export async function startConsultingCheckout(
  companyId: string,
  packageId: string
): Promise<string> {
  const headers = await getAuthHeaders()
  const res = await fetch(buildUrl('/api/consulting-orders/checkout', companyId), {
    method:  'POST',
    headers,
    body:    JSON.stringify({ package_id: packageId }),
  })
  const data = await handleResponse<{ ok: boolean; checkout_url: string }>(res)
  return data.checkout_url
}

// ── Lançamentos de horas ──────────────────────────────────────────────────────

export async function fetchTimeEntries(
  companyId: string,
  page = 1,
  limit = 20
): Promise<{ entries: ConsultingTimeEntry[]; total: number }> {
  const headers = await getAuthHeaders()
  const res = await fetch(
    `${buildUrl('/api/consulting/time-entries', companyId)}&page=${page}&limit=${limit}`,
    { headers }
  )
  const data = await handleResponse<{ ok: boolean; entries: ConsultingTimeEntry[]; total: number }>(res)
  return { entries: data.entries, total: data.total }
}

export async function createTimeEntry(
  companyId: string,
  payload: NewTimeEntryPayload
): Promise<{ entry_id: string; duration_minutes: number }> {
  const headers = await getAuthHeaders()
  const res = await fetch(buildUrl('/api/consulting/time-entries', companyId), {
    method:  'POST',
    headers,
    body:    JSON.stringify(payload),
  })
  const data = await handleResponse<{ ok: boolean; entry_id: string; duration_minutes: number }>(res)
  return { entry_id: data.entry_id, duration_minutes: data.duration_minutes }
}

export async function deleteTimeEntry(
  companyId: string,
  entryId: string
): Promise<number> {
  const headers = await getAuthHeaders()
  const res = await fetch(
    buildUrl(`/api/consulting/time-entries/${entryId}`, companyId),
    { method: 'DELETE', headers }
  )
  const data = await handleResponse<{ ok: boolean; minutes_restored: number }>(res)
  return data.minutes_restored
}

// ── Catálogo admin ────────────────────────────────────────────────────────────

export async function fetchAdminConsultingPackages(): Promise<ConsultingPackage[]> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/admin/consulting-packages', { headers })
  const data = await handleResponse<{ ok: boolean; packages: ConsultingPackage[] }>(res)
  return data.packages
}

export async function createAdminConsultingPackage(
  payload: ConsultingPackagePayload
): Promise<ConsultingPackage> {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/admin/consulting-packages', {
    method:  'POST',
    headers,
    body:    JSON.stringify(payload),
  })
  const data = await handleResponse<{ ok: boolean; package: ConsultingPackage }>(res)
  return data.package
}

export async function updateAdminConsultingPackage(
  id: string,
  payload: Partial<ConsultingPackagePayload>
): Promise<ConsultingPackage> {
  const headers = await getAuthHeaders()
  const res = await fetch(`/api/admin/consulting-packages/${id}`, {
    method:  'PUT',
    headers,
    body:    JSON.stringify(payload),
  })
  const data = await handleResponse<{ ok: boolean; package: ConsultingPackage }>(res)
  return data.package
}
