import type { Company } from '../../lib/supabase'

export interface TrialInfo {
  company_id:        string
  is_internal_trial: boolean
  trial_start:       string | null
  trial_end:         string | null
  trial_extended:    boolean
  can_extend:        boolean
  days_remaining:    number | null
}

export interface CreateResult {
  company_id:    string
  trial_started: boolean
  trial_end:     string | null
  admin_created: boolean
  admin_email:   string | null
  invite_link:   string | null
}

export type ClientCompany = Company & { plans?: { name: string; slug: string } | null }

export interface Plan {
  id:   string
  name: string
  slug: string
}

export type ViewMode      = 'grid' | 'list'
export type StatusFilter  = 'all' | 'active' | 'suspended' | 'cancelled'
export type TypeFilter    = 'all' | 'free' | 'trial' | 'trial_expired'

export interface CompanyFilters {
  search:   string
  status:   StatusFilter
  planSlug: string
  type:     TypeFilter
}

export const DEFAULT_FILTERS: CompanyFilters = {
  search:   '',
  status:   'all',
  planSlug: '',
  type:     'all',
}
