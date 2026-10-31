import { conversationMatchesSelection } from './instagramChatSelection'

export interface InstagramQueryContext {
  generation: number
  companyId: string
  owner: string
  filterType: string
  search: string
}

export interface InstagramListEvent {
  company_id?: string
  connection_id?: string | null
  byo_account_id?: string | null
  status?: string
  unread_count?: number
  assigned_to?: string | null
  participant_name?: string | null
  participant_username?: string | null
  last_message_preview?: string | null
}

export interface InstagramMessageContext {
  generation: number
  companyId: string
  conversationId: string
}

type InstagramQueryIdentity = Pick<InstagramQueryContext, 'companyId' | 'owner' | 'filterType' | 'search'>

export function sameInstagramQueryContext(
  captured: InstagramQueryContext,
  current: InstagramQueryContext,
): boolean {
  return captured.generation === current.generation
    && captured.companyId === current.companyId
    && captured.owner === current.owner
    && captured.filterType === current.filterType
    && captured.search === current.search
}

export function nextInstagramQueryContext(
  current: InstagramQueryContext,
  next: InstagramQueryIdentity,
): InstagramQueryContext {
  if (
    current.companyId === next.companyId
    && current.owner === next.owner
    && current.filterType === next.filterType
    && current.search === next.search
  ) {
    return current
  }
  return {
    generation: current.generation + 1,
    companyId: next.companyId,
    owner: next.owner,
    filterType: next.filterType,
    search: next.search,
  }
}

export function sameInstagramMessageContext(
  captured: InstagramMessageContext,
  current: InstagramMessageContext,
): boolean {
  return captured.generation === current.generation
    && captured.companyId === current.companyId
    && captured.conversationId === current.conversationId
}

export function instagramSubscriptionEventApplies(
  subscribed: InstagramQueryContext,
  current: InstagramQueryContext,
  event: InstagramListEvent,
): boolean {
  if (!sameInstagramQueryContext(subscribed, current)) return false
  if (event.company_id !== current.companyId) return false
  if (!conversationMatchesSelection(event, current.owner)) return false
  if (current.filterType === 'comments' || current.filterType === 'pending') return false
  if (current.filterType === 'unread' && !(Number(event.unread_count) > 0)) return false
  if (current.filterType === 'assigned' && !event.assigned_to) return false
  if (current.filterType === 'unassigned' && event.assigned_to) return false
  if (current.search) {
    const needle = current.search.toLowerCase()
    const haystack = `${event.participant_name ?? ''} ${event.participant_username ?? ''} ${event.last_message_preview ?? ''}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

export function instagramMessageEventApplies(
  subscribed: InstagramMessageContext,
  current: InstagramMessageContext,
  event: { company_id?: string; conversation_id?: string },
): boolean {
  if (!sameInstagramMessageContext(subscribed, current)) return false
  if (event.company_id !== subscribed.companyId) return false
  if (event.conversation_id !== subscribed.conversationId) return false
  return true
}

export function instagramPageMayAutoLoad(input: {
  pageError: boolean
  hasMore: boolean
  loading: boolean
  intersecting: boolean
}): boolean {
  return !input.pageError && input.hasMore && !input.loading && input.intersecting
}
