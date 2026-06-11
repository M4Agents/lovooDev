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
  conversation: Pick<ChatConversation, 'assigned_to'>,
  { flag, role, userId }: ChatVisibilityContext
): boolean {
  if (!flag) return true
  if (role !== 'seller') return true

  const assignedId = conversation.assigned_to?.id ?? null
  if (assignedId === userId) return true

  // assigned_to IS NULL ou assigned_to de outro seller → invisível para seller restrito
  return false
}
