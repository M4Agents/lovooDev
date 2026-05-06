// =============================================================================
// API: Modelos de Mensagem
// =============================================================================

import { supabase } from '../lib/supabase'
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
// Mídia de template — upload via backend (sem importar s3Storage no browser)
// ---------------------------------------------------------------------------

/**
 * Faz upload de mídia de template via presigned PUT URL gerada pelo backend.
 * O arquivo é enviado diretamente ao S3 (sem passar pelo backend), mas as
 * credenciais AWS são resolvidas exclusivamente no servidor.
 *
 * Retorna:
 *   - media_path: S3 key a ser salvo no banco (nunca URL assinada)
 *   - preview_url: URL pública direta para preview local
 *   - media_type: tipo de mídia (image | video | audio | document)
 */
export async function uploadTemplateMedia(
  file: File,
  companyId: string,
  onProgress?: (percent: number) => void,
): Promise<{ media_path: string; preview_url: string; media_type: MessageTemplateMediaType }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')

  onProgress?.(0)

  const contentType = file.type || 'application/octet-stream'

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'56e383'},body:JSON.stringify({sessionId:'56e383',location:'messageTemplatesApi.ts:uploadTemplateMedia',message:'upload-start',data:{filename:file.name,contentType,companyId,hasSession:!!session?.access_token},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  // Passo 1: backend gera presigned PUT URL + S3 key
  const prepRes = await fetch('/api/integrations/message-templates/upload-media', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ filename: file.name, contentType, companyId }),
  })

  const prepData = await prepRes.json().catch(() => ({})) as Record<string, unknown>
  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'56e383'},body:JSON.stringify({sessionId:'56e383',location:'messageTemplatesApi.ts:uploadTemplateMedia',message:'prep-response',data:{status:prepRes.status,ok:prepRes.ok,hasPresignedUrl:!!prepData.presignedUrl,error:prepData.error},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!prepRes.ok) {
    throw new Error((prepData?.error as string) || 'Erro ao preparar upload de mídia')
  }

  const { presignedUrl, s3Key, mediaType, directUrl } = prepData as {
    presignedUrl: string
    s3Key:        string
    mediaType:    MessageTemplateMediaType
    directUrl:    string
  }

  onProgress?.(20)

  // Passo 2: upload direto ao S3 via presigned PUT URL (sem backend proxy)
  const uploadRes = await fetch(presignedUrl, {
    method:  'PUT',
    body:    file,
    headers: { 'Content-Type': contentType },
  })

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'56e383'},body:JSON.stringify({sessionId:'56e383',location:'messageTemplatesApi.ts:uploadTemplateMedia',message:'s3-put-response',data:{status:uploadRes.status,ok:uploadRes.ok,s3Key},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!uploadRes.ok) {
    throw new Error(`Erro ao fazer upload para S3: HTTP ${uploadRes.status}`)
  }

  onProgress?.(100)

  return {
    media_path:  s3Key,
    preview_url: directUrl,
    media_type:  mediaType,
  }
}

/**
 * Retorna a URL pública de um media_path (S3 key) salvo no banco.
 * Consulta o backend para obter bucket/região — nenhuma credencial AWS exposta.
 * Retorna null em caso de falha.
 */
export async function generateTemplateMediaUrl(
  companyId: string,
  mediaPath: string,
  _expiresIn = 3600,
): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null

  const params = new URLSearchParams({ media_path: mediaPath, company_id: companyId })
  const res = await fetch(`/api/integrations/message-templates/media-url?${params}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })

  if (!res.ok) return null

  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  return (data?.url as string) || null
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
