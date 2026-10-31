import type { InstagramByoChatAccount, InstagramChatSelection, InstagramConnection } from '../../types/instagram-chat'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function instagramChatStorageKey(userId: string, companyId: string) {
  return `ig_chat_connection_${userId}_${companyId}`
}

export function legacyInstagramChatStorageKey(userId: string) {
  return `ig_chat_connection_${userId}`
}

function sameAccount(connection: Pick<InstagramConnection, 'instagram_user_id' | 'ig_webhook_id'>, accountId: string) {
  return connection.instagram_user_id === accountId || connection.ig_webhook_id === accountId
}

export function resolveInstagramChatSelection(
  stored: string | null | undefined,
  connections: InstagramConnection[],
  byoAccounts: InstagramByoChatAccount[],
): InstagramChatSelection {
  const raw = (stored ?? '').trim()
  if (raw === '' || raw === 'all') return 'all'

  if (raw.startsWith('byo:')) {
    const id = raw.slice(4)
    return byoAccounts.some((account) => account.id === id) ? `byo:${id}` : 'all'
  }

  const officialId = raw.startsWith('official:') ? raw.slice('official:'.length) : raw
  if (!UUID_RE.test(officialId)) return 'all'
  const connection = connections.find((item) => item.id === officialId)
  if (!connection) return 'all'
  if (connection.status === 'active') return `official:${connection.id}`

  const matches = byoAccounts.filter((account) => sameAccount(connection, account.instagram_account_id))
  const uniqueIds = [...new Set(matches.map((account) => account.id))]
  if (uniqueIds.length === 1) return `byo:${uniqueIds[0]}`
  return 'all'
}

export function officialConnectionIdFromSelection(selection: string) {
  if (!selection.startsWith('official:')) return undefined
  const id = selection.slice('official:'.length)
  return UUID_RE.test(id) ? id : undefined
}

export function conversationMatchesSelection(
  conversation: { connection_id?: string | null; byo_account_id?: string | null; status?: string },
  selection: string,
) {
  if (conversation.status && conversation.status !== 'active') return false
  if (selection === 'all') return true
  if (selection.startsWith('official:')) return conversation.connection_id === selection.slice('official:'.length)
  if (selection.startsWith('byo:')) {
    return conversation.byo_account_id === selection.slice(4) && conversation.connection_id == null
  }
  return false
}
