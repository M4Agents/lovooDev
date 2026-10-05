import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildTitleOrLeadFilter,
  decideLeadIds,
  escapeIlikeLiteral,
  handlerTimedOut,
  quotePostgrestValue,
  searchTimedOut,
  urlExceedsLimit,
  TASK_SEARCH_LIMITS,
} from '../../../src/utils/taskBoardContract.js'

export class SearchTooBroadError extends Error {
  readonly code = 'search_too_broad'

  constructor() {
    super('A busca encontrou leads demais ou a URL ficou grande demais. Refine a busca.')
  }
}

export class QueryTimeoutError extends Error {
  readonly code = 'query_timeout'

  constructor() {
    super('A consulta excedeu o tempo. Refine os filtros ou tente de novo.')
  }
}

function assertSendable(query: { url: URL }, signal: AbortSignal, handlerStarted: number, searchStarted: number) {
  if (signal.aborted || handlerTimedOut(handlerStarted, Date.now())) throw new QueryTimeoutError()
  if (searchTimedOut(searchStarted, Date.now())) throw new SearchTooBroadError()
  if (urlExceedsLimit(query.url.toString())) throw new SearchTooBroadError()
}

function numericIds(rows: { id: number }[] | null): number[] {
  return (rows ?? [])
    .map(row => row.id)
    .filter(id => Number.isInteger(id) && id > 0)
}

export async function resolveTitleOrLeadFilter(
  supabase: SupabaseClient,
  companyId: string,
  term: string,
  searchStarted: number,
  handlerStarted: number,
  signal: AbortSignal,
): Promise<string> {
  const pattern = quotePostgrestValue(`%${escapeIlikeLiteral(term)}%`)
  const nameFilter = `name.ilike.${pattern}`
  const firstQuery = supabase
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .or(nameFilter)
    .order('id', { ascending: true })
    .range(0, TASK_SEARCH_LIMITS.pageSize - 1)
    .abortSignal(signal)
  assertSendable(firstQuery, signal, handlerStarted, searchStarted)
  const first = await firstQuery

  if (signal.aborted) throw new QueryTimeoutError()
  if (first.error) throw new Error(first.error.message)
  if (searchTimedOut(searchStarted, Date.now())) throw new SearchTooBroadError()

  const firstIds = numericIds(first.data)
  let decision = decideLeadIds(firstIds, null)

  if (decision.action === 'probe') {
    const probeQuery = supabase
      .from('leads')
      .select('id')
      .eq('company_id', companyId)
      .or(nameFilter)
      .order('id', { ascending: true })
      .range(TASK_SEARCH_LIMITS.pageSize, TASK_SEARCH_LIMITS.pageSize)
      .abortSignal(signal)
    assertSendable(probeQuery, signal, handlerStarted, searchStarted)
    const probe = await probeQuery

    if (signal.aborted) throw new QueryTimeoutError()
    if (probe.error) throw new Error(probe.error.message)
    if (searchTimedOut(searchStarted, Date.now())) throw new SearchTooBroadError()
    decision = decideLeadIds(firstIds, numericIds(probe.data))
  }

  if (decision.action !== 'use') throw new SearchTooBroadError()

  const built = buildTitleOrLeadFilter(term, decision.ids)
  if ('error' in built) throw new SearchTooBroadError()
  return built.filter
}
