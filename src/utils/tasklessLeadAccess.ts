export const TASKLESS_PAGE_SIZE = 50
export const TASKLESS_MAX_OFFSET = 100_000
export const TASKLESS_STAGE_LIMIT = 200

export function tasklessPage(offset: number, count: number, total: number) {
  const from = total > 0 && count > 0 ? offset + 1 : 0
  const to = offset + count
  return {
    from,
    to,
    hasPrev: offset > 0,
    hasNext: offset + count < total,
  }
}
