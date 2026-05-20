// =====================================================
// src/types/dashboard-activation.ts
// Tipos isolados da aba "Ativação Comercial".
// NÃO misturar com src/types/dashboard.ts.
// Stack separada de get_dashboard_trends.
// =====================================================

// ---------------------------------------------------------------------------
// Ponto de dado diário (prospecção e resgate compartilham a mesma forma)
// ---------------------------------------------------------------------------

export interface ActivationDay {
  date:      string   // "YYYY-MM-DD"
  initiated: number
  responded: number
}

// ---------------------------------------------------------------------------
// Totais do período (summary retornado pelo backend)
// ---------------------------------------------------------------------------

export interface ActivationSummary {
  total_prospection_initiated: number
  total_prospection_responded: number
  total_rescue_initiated:      number
  total_rescue_responded:      number
}

// ---------------------------------------------------------------------------
// Payload completo retornado pela API
// ---------------------------------------------------------------------------

export interface ActivationData {
  prospection_by_day: ActivationDay[]
  rescue_by_day:      ActivationDay[]
  summary:            ActivationSummary
}

// ---------------------------------------------------------------------------
// Meta retornada pelo endpoint /api/dashboard/activation
// ---------------------------------------------------------------------------

export interface ActivationMeta {
  period:   string
  start:    string
  end:      string
  user_id:  string | null
  settings: {
    rescue_inactivity_days:          number
    rescue_response_window_days:     number
    prospection_response_window_days: number
  }
}

// ---------------------------------------------------------------------------
// Resposta completa do endpoint
// ---------------------------------------------------------------------------

export interface ActivationResponse {
  ok:   boolean
  data: ActivationData
  meta: ActivationMeta
}
