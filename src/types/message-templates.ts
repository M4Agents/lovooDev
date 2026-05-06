// =============================================================================
// Tipos: Modelos de Mensagem
// =============================================================================

export type MessageTemplateChannel = 'whatsapp_life' | 'whatsapp_official_api'

export interface MessageTemplateCategory {
  id: string
  company_id: string | null
  name: string
  is_system: boolean
  sort_order: number
  is_active: boolean
}

export interface MessageTemplate {
  id: string
  company_id: string
  category_id: string | null
  name: string
  content: string
  channel: MessageTemplateChannel
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// Usado no chat (picker) — dados mínimos para performance
export interface MessageTemplateChatItem {
  id: string
  category_id: string | null
  name: string
  content: string
  channel: MessageTemplateChannel
}

export interface MessageTemplateListResponse {
  categories: MessageTemplateCategory[]
  templates: MessageTemplate[]
}

export interface MessageTemplateChatResponse {
  categories: Pick<MessageTemplateCategory, 'id' | 'company_id' | 'name' | 'is_system' | 'sort_order'>[]
  templates: MessageTemplateChatItem[]
}

export type CreateTemplateInput = {
  company_id: string
  name: string
  content: string
  channel: 'whatsapp_life'
  category_id?: string | null
}

export type UpdateTemplateInput = Partial<Omit<CreateTemplateInput, 'company_id'>> & {
  company_id: string
  is_active?: boolean
}

export type CreateCategoryInput = {
  company_id: string
  name: string
  sort_order?: number
}

export type UpdateCategoryInput = {
  company_id: string
  name?: string
  sort_order?: number
  is_active?: boolean
}
