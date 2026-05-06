// =============================================================================
// API: Modelos de Mensagem
// =============================================================================

import { supabase } from '../lib/supabase'
import { S3Storage } from './aws/s3Storage'
import type {
  MessageTemplateListResponse,
  MessageTemplateChatResponse,
  MessageTemplate,
  MessageTemplateCategory,
  CreateTemplateInput,
  UpdateTemplateInput,
  CreateCategoryInput,
  UpdateCategoryInput,
  MessageTemplateMediaType,
} from '../types/message-templates'

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

// ---------------------------------------------------------------------------
// Configurações — lista (templates + categorias)
// ---------------------------------------------------------------------------

export async function listSettingsTemplates(companyId: string): Promise<MessageTemplateListResponse> {
  const headers = await getAuthHeaders()
  const res  = await fetch(`/api/integrations/message-templates?company_id=${encodeURIComponent(companyId)}`, { headers })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao carregar modelos')
  return {
    categories: Array.isArray(data.categories) ? (data.categories as MessageTemplateCategory[]) : [],
    templates:  Array.isArray(data.templates)  ? (data.templates  as MessageTemplate[]) : [],
  }
}

// ---------------------------------------------------------------------------
// Configurações — criar template
// ---------------------------------------------------------------------------

export async function createTemplate(input: CreateTemplateInput): Promise<MessageTemplate> {
  const headers = await getAuthHeaders()
  const res  = await fetch('/api/integrations/message-templates', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...input, resource: 'template' }),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao criar modelo')
  return data.template as MessageTemplate
}

// ---------------------------------------------------------------------------
// Configurações — atualizar template
// ---------------------------------------------------------------------------

export async function updateTemplate(id: string, input: UpdateTemplateInput): Promise<MessageTemplate> {
  const headers = await getAuthHeaders()
  const res  = await fetch(`/api/integrations/message-templates/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...input, resource: 'template' }),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao atualizar modelo')
  return data.template as MessageTemplate
}

// ---------------------------------------------------------------------------
// Configurações — desativar template (soft delete)
// ---------------------------------------------------------------------------

export async function deleteTemplate(id: string, companyId: string): Promise<void> {
  const headers = await getAuthHeaders()
  const params  = new URLSearchParams({ company_id: companyId, resource: 'template' })
  const res  = await fetch(`/api/integrations/message-templates/${id}?${params}`, {
    method: 'DELETE',
    headers,
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao desativar modelo')
}

// ---------------------------------------------------------------------------
// Configurações — criar categoria custom
// ---------------------------------------------------------------------------

export async function createCategory(input: CreateCategoryInput): Promise<MessageTemplateCategory> {
  const headers = await getAuthHeaders()
  const res  = await fetch('/api/integrations/message-templates', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...input, resource: 'category' }),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao criar categoria')
  return data.category as MessageTemplateCategory
}

// ---------------------------------------------------------------------------
// Configurações — atualizar categoria custom
// ---------------------------------------------------------------------------

export async function updateCategory(id: string, input: UpdateCategoryInput): Promise<MessageTemplateCategory> {
  const headers = await getAuthHeaders()
  const res  = await fetch(`/api/integrations/message-templates/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...input, resource: 'category' }),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao atualizar categoria')
  return data.category as MessageTemplateCategory
}

// ---------------------------------------------------------------------------
// Configurações — desativar categoria custom (soft delete)
// ---------------------------------------------------------------------------

export async function deleteCategory(id: string, companyId: string): Promise<void> {
  const headers = await getAuthHeaders()
  const params  = new URLSearchParams({ company_id: companyId, resource: 'category' })
  const res  = await fetch(`/api/integrations/message-templates/${id}?${params}`, {
    method: 'DELETE',
    headers,
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao desativar categoria')
}

// ---------------------------------------------------------------------------
// Mídia de template — upload (retorna S3 key + preview URL temporária)
// ---------------------------------------------------------------------------

/**
 * Faz upload de mídia para S3 e retorna:
 *   - media_path: S3 key a ser salvo no banco (nunca URL assinada)
 *   - preview_url: URL assinada de curta duração apenas para preview local
 */
export async function uploadTemplateMedia(
  file: File,
  companyId: string,
  onProgress?: (percent: number) => void,
): Promise<{ media_path: string; preview_url: string; media_type: MessageTemplateMediaType }> {
  const buffer      = new Uint8Array(await file.arrayBuffer())
  const contentType = S3Storage.detectContentType(buffer as unknown as Buffer, file.name)
  const mediaType   = resolveMediaType(contentType)

  const uploadResult = await S3Storage.uploadToS3({
    companyId,
    messageId:        `template-${Date.now()}`,
    originalFileName: file.name,
    buffer:           buffer as unknown as Buffer,
    contentType,
    source:           'frontend',
    onProgress,
  })

  if (!uploadResult.success || !uploadResult.data) {
    throw new Error(uploadResult.error || 'Erro ao fazer upload de mídia')
  }

  const s3Key    = uploadResult.data.s3Key
  const urlResult = await S3Storage.generateSignedUrl(companyId, s3Key, { expiresIn: 7200 })

  if (!urlResult.success || !urlResult.data) {
    throw new Error(urlResult.error || 'Erro ao gerar URL de preview')
  }

  return { media_path: s3Key, preview_url: urlResult.data, media_type: mediaType }
}

/**
 * Gera URL assinada temporária para um media_path (S3 key) salvo no banco.
 * Retorna null em caso de falha.
 */
export async function generateTemplateMediaUrl(
  companyId: string,
  mediaPath: string,
  expiresIn = 3600,
): Promise<string | null> {
  const result = await S3Storage.generateSignedUrl(companyId, mediaPath, { expiresIn })
  return result.success && result.data ? result.data : null
}

function resolveMediaType(contentType: string): MessageTemplateMediaType {
  if (contentType.startsWith('image/'))  return 'image'
  if (contentType.startsWith('video/'))  return 'video'
  if (contentType.startsWith('audio/'))  return 'audio'
  return 'document'
}

// ---------------------------------------------------------------------------
// Chat — lista templates ativos para o picker
// ---------------------------------------------------------------------------

export async function listChatTemplates(conversationId: string): Promise<MessageTemplateChatResponse> {
  const headers = await getAuthHeaders()
  const res  = await fetch(`/api/chat/message-templates?conversation_id=${encodeURIComponent(conversationId)}`, { headers })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error((data?.error as string) || 'Erro ao carregar modelos')
  return {
    categories: Array.isArray(data.categories) ? (data.categories as MessageTemplateChatResponse['categories']) : [],
    templates:  Array.isArray(data.templates)  ? (data.templates  as MessageTemplateChatResponse['templates']) : [],
  }
}
