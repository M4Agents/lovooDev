// ============================================================
// Chamadas autenticadas às rotas de notificações admin
//   GET  /api/integrations/notifications/settings
//   PUT  /api/integrations/notifications/settings
//   GET  /api/notifications/templates
//   PUT  /api/notifications/templates/:id
// ============================================================

import { supabase } from '../lib/supabase'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'whatsapp'

export type NotificationInstance = {
  id: string
  name: string
  status: string
}

export type NotificationsSettingsDTO = {
  enabled: boolean
  enabled_channels: NotificationChannel[]
  whatsapp_instance_id: string | null
  available_instances: NotificationInstance[]
}

export type NotificationTemplateDTO = {
  id: string
  event_type: string
  event_subtype: string | null
  channel: NotificationChannel
  name: string
  subject: string | null
  body: string
  is_active: boolean
}

export type UpdateTemplateInput = {
  name: string
  subject: string | null
  body: string
  is_active: boolean
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function fetchNotificationsSettings(): Promise<NotificationsSettingsDTO> {
  const headers = await getAuthHeaders()
  const res  = await fetch('/api/integrations/notifications/settings', { headers })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao carregar configurações de notificações')
  return {
    enabled:              Boolean(data.enabled),
    enabled_channels:     Array.isArray(data.enabled_channels) ? (data.enabled_channels as NotificationChannel[]) : [],
    whatsapp_instance_id: typeof data.whatsapp_instance_id === 'string' ? data.whatsapp_instance_id : null,
    available_instances:  Array.isArray(data.available_instances) ? (data.available_instances as NotificationInstance[]) : [],
  }
}

export async function saveNotificationsSettings(body: {
  enabled: boolean
  enabled_channels: NotificationChannel[]
  whatsapp_instance_id: string | null
}): Promise<void> {
  const headers = await getAuthHeaders()
  const res  = await fetch('/api/integrations/notifications/settings', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao salvar configurações')
}

export async function fetchNotificationTemplates(): Promise<NotificationTemplateDTO[]> {
  const headers = await getAuthHeaders()
  const res  = await fetch('/api/notifications/templates', { headers })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao carregar templates')
  return Array.isArray(data.templates) ? (data.templates as NotificationTemplateDTO[]) : []
}

export async function updateNotificationTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<NotificationTemplateDTO> {
  const headers = await getAuthHeaders()
  const res  = await fetch(`/api/notifications/templates/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao salvar template')
  return data.template as NotificationTemplateDTO
}
