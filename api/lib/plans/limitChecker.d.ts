// Type declarations for limitChecker.js
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PlanLimits {
  plan_id:                           string | null
  plan_name:                         string | null
  plan_slug:                         string | null
  ai_plan_id:                        string | null
  ai_plan_name:                      string | null
  ai_plan_monthly_credits:           number | null
  max_whatsapp_instances:            number | null
  max_leads:                         number | null
  max_users:                         number | null
  max_funnels:                       number | null
  max_funnel_stages:                 number | null
  max_automation_flows:              number | null
  max_automation_executions_monthly: number | null
  max_products:                      number | null
  storage_mb:                        number | null
  features:                          Record<string, unknown>
  has_plan:                          boolean
}

export declare class PlanEnforcementError extends Error {
  isPlanError: boolean
  httpStatus:  number
  data:        Record<string, unknown>
  constructor(data: Record<string, unknown>): void
}

export declare function getPlanLimits(
  svc: SupabaseClient,
  companyId: string
): Promise<PlanLimits>

export declare function assertLimitFromLoaded(
  limits: PlanLimits,
  limitKey: string,
  currentCount: number
): void

export declare function assertFeatureFromLoaded(
  limits: PlanLimits,
  featureKey: string
): void

export declare function assertPlanLimit(
  svc: SupabaseClient,
  companyId: string,
  limitKey: string,
  getCurrentCount: () => Promise<number>
): Promise<void>

export declare function assertPlanFeature(
  svc: SupabaseClient,
  companyId: string,
  featureKey: string
): Promise<void>

export declare function assertStorageLimit(
  svc: SupabaseClient,
  companyId: string,
  fileSizeBytes: number
): Promise<void>
