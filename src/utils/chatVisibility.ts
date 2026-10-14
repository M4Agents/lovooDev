import type { ChatConversation } from '../types/whatsapp-chat'

/**
 * Contexto de visibilidade passado pelo caller (useChatData, ChatLayout).
 * Todos os campos são primitivos para evitar re-renders desnecessários.
 */
export interface ChatVisibilityContext {
  /** Valor atual de companies.chat_visibility_by_assigned_to */
  flag: boolean
  /** Role do usuário autenticado na empresa ativa (ex: 'seller', 'admin', null) */
  role: string | null
  /** ID do usuário autenticado (auth.uid()) */
  userId: string
}

type AssignedToValue = ChatConversation['assigned_to'] | string | null | undefined

/**
 * O RPC entrega assigned_to como { id, email }.
 * O realtime da tabela entrega o UUID cru. Os dois formatos identificam o mesmo responsável.
 */
export function resolveAssignedUserId(assigned: AssignedToValue): string | null {
  if (!assigned) return null
  if (typeof assigned === 'string') {
    const id = assigned.trim()
    return id.length > 0 ? id : null
  }
  return assigned.id ?? null
}

/**
 * Converte o assigned_to do realtime para o formato da lista.
 * Mantém o e-mail já carregado quando o responsável não mudou.
 */
export function normalizeRealtimeAssignedTo(
  incoming: unknown,
  previous?: ChatConversation['assigned_to']
): ChatConversation['assigned_to'] | undefined {
  if (incoming === undefined) return previous
  const id = resolveAssignedUserId(incoming as AssignedToValue)
  if (!id) return undefined
  if (previous?.id === id) return previous
  if (
    typeof incoming === 'object' &&
    incoming !== null &&
    'email' in incoming &&
    typeof (incoming as { email?: unknown }).email === 'string'
  ) {
    return { id, email: (incoming as { email: string }).email }
  }
  return { id, email: '' }
}

/**
 * Determina se uma conversa deve ser visível para o usuário no cliente.
 *
 * Regras (espelho client-side do helper SQL auth_chat_visibility_restricted):
 *   - flag = false       → sempre visível (comportamento atual preservado)
 *   - role != seller     → sempre visível (admin, manager, system_admin, super_admin, partner)
 *   - assigned_to === userId → visível (própria conversa)
 *   - assigned_to === null   → invisível para seller (conversa sem responsável)
 *   - caso contrário         → invisível (conversa de outro seller)
 *
 * Regra de negócio: seller com flag ativa vê SOMENTE conversas atribuídas a ele.
 * Conversas sem assigned_to (IS NULL) são visíveis apenas para admin/manager e superiores.
 *
 * Esta função é EXCLUSIVAMENTE para UX (evitar itens fantasma no estado local).
 * A segurança real é garantida pelo banco (RLS + guards nas RPCs).
 */
export function isConversationVisibleForUser(
  conversation: { assigned_to?: AssignedToValue },
  { flag, role, userId }: ChatVisibilityContext
): boolean {
  if (!flag) return true
  if (role !== 'seller') return true

  const assignedId = resolveAssignedUserId(conversation.assigned_to)
  if (assignedId === userId) return true

  // assigned_to IS NULL ou assigned_to de outro seller → invisível para seller restrito
  return false
}
