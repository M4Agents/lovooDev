import { supabase } from '../lib/supabase'

// Avisa o backend para disparar o Webhook Avançado.
// Falha aqui não impede criar ou editar o lead.
export function scheduleLeadWebhookDispatch(params: {
  leadId: number
  reason: 'created' | 'updated'
  previousStatus?: string | null
}) {
  if (!params.leadId) return

  supabase.auth.getSession().then(({ data }) => {
    const token = data.session?.access_token
    if (!token) return

    fetch('/api/webhooks/dispatch-lead-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lead_id: params.leadId,
        reason: params.reason,
        previous_status: params.previousStatus ?? null,
      }),
    }).catch((error) => {
      console.error('[lead-webhook] falha ao disparar:', error)
    })
  }).catch(() => {})
}
