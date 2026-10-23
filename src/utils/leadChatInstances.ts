import {
  isConversationVisibleForUser,
  type ChatVisibilityContext,
} from './chatVisibility'

export interface LeadConversationRef {
  id: string
  instance_id: string | null
  assigned_to?: string | null
  updated_at?: string | null
}

export interface LeadChatInstance {
  id: string
  instance_name: string
  phone_number?: string | null
  profile_name?: string | null
  profile_picture_url?: string | null
  status: string
  assigned_user_id?: string | null
  available_to_all?: boolean | null
}

export interface LeadInstanceOption {
  conversationId: string
  updatedAt: number
  instance: LeadChatInstance
}

/**
 * Mesma regra do seletor do chat principal (useChatData / LeadPanel):
 * seller com visibilidade restrita vê instância atribuída a ele ou available_to_all.
 * Os demais papéis veem as instâncias recebidas.
 */
export function instancesVisibleInChat(
  instances: LeadChatInstance[],
  visibility: ChatVisibilityContext
): LeadChatInstance[] {
  if (!(visibility.flag && visibility.role === 'seller')) return instances

  return instances.filter(
    instance =>
      instance.assigned_user_id === visibility.userId ||
      instance.available_to_all === true
  )
}

function updatedAtMs(value: string | null | undefined): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

/**
 * Conversas ativas do lead que o usuário pode abrir.
 * Uma opção por instância, ficando a conversa mais recente.
 * Instância ausente da lista (outra empresa, apagada ou sem acesso) não entra.
 */
export function leadInstanceOptions(
  conversations: LeadConversationRef[],
  instances: LeadChatInstance[],
  visibility: ChatVisibilityContext
): LeadInstanceOption[] {
  const allowed = new Map(
    instancesVisibleInChat(instances, visibility).map(instance => [instance.id, instance])
  )
  const bestByInstance = new Map<string, LeadInstanceOption>()

  for (const conversation of conversations) {
    if (!conversation.instance_id) continue
    const instance = allowed.get(conversation.instance_id)
    if (!instance) continue
    if (!isConversationVisibleForUser(conversation, visibility)) continue

    const updatedAt = updatedAtMs(conversation.updated_at)
    const current = bestByInstance.get(instance.id)
    if (current && current.updatedAt >= updatedAt) continue

    bestByInstance.set(instance.id, {
      conversationId: conversation.id,
      updatedAt,
      instance,
    })
  }

  return [...bestByInstance.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}
