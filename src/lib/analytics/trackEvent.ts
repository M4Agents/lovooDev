// =====================================================
// trackEvent — Util de rastreamento de ações do dashboard
//
// Centraliza todos os eventos de navegação e interação
// para análise futura de comportamento do usuário.
//
// Em DEV: console.log estruturado.
// Em PROD: pronto para integrar PostHog, Segment, Amplitude, etc.
//   Basta trocar a implementação de `sendToProvider`.
//
// REGRAS DE SEGURANÇA:
//   - Nunca incluir company_id, tokens ou dados pessoais nos payloads
//   - Apenas IDs de entidades e contexto de interação
// =====================================================

export type DashboardEvent =
  | 'dashboard_open_chat'
  | 'dashboard_open_opportunity'
  | 'dashboard_open_lead'
  | 'dashboard_open_drawer'
  | 'dashboard_navigate_to_chat'
  | 'dashboard_navigate_to_funnel'
  | 'dashboard_navigate_to_leads'

export interface TrackEventPayload {
  source?: 'drawer' | 'action_center' | 'kpi_card'
  entityType?: string
  entity_id?: string
  [key: string]: string | number | boolean | undefined
}

// ---------------------------------------------------------------------------
// Integração com providers externos (preencher quando necessário)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function sendToProvider(_event: string, _payload: TrackEventPayload): void {
  // TODO: integrar PostHog, Segment ou Amplitude aqui
  // Exemplo PostHog:
  //   if (typeof window !== 'undefined' && (window as any).posthog) {
  //     (window as any).posthog.capture(_event, _payload)
  //   }
}

// ---------------------------------------------------------------------------
// Função pública
// ---------------------------------------------------------------------------

export function trackEvent(
  event: DashboardEvent | string,
  payload: TrackEventPayload = {},
): void {
  const enriched: TrackEventPayload = {
    ...payload,
    timestamp: new Date().toISOString(),
  }

  if (import.meta.env.DEV) {
    console.log(`[trackEvent] ${event}`, enriched)
  }

  sendToProvider(event, enriched)
}
