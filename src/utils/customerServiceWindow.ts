import type { CustomerServiceWindow } from '../types/meta-whatsapp'

export const UNKNOWN_CUSTOMER_SERVICE_WINDOW: CustomerServiceWindow = {
  state: 'unknown',
  expiresAt: null,
}

export function readCustomerServiceWindow(value: unknown): CustomerServiceWindow {
  if (!value || typeof value !== 'object') return UNKNOWN_CUSTOMER_SERVICE_WINDOW
  const record = value as { state?: unknown, expiresAt?: unknown }
  if (record.state === 'closed' || record.state === 'unknown') {
    return { state: record.state, expiresAt: null }
  }
  if (
    record.state === 'open'
    && typeof record.expiresAt === 'string'
    && Number.isFinite(Date.parse(record.expiresAt))
  ) {
    return { state: 'open', expiresAt: record.expiresAt }
  }
  return UNKNOWN_CUSTOMER_SERVICE_WINDOW
}

export function displayedCustomerServiceWindow(
  windowState: CustomerServiceWindow | null | undefined,
  nowMs: number,
): CustomerServiceWindow {
  if (!windowState || windowState.state === 'unknown') return UNKNOWN_CUSTOMER_SERVICE_WINDOW
  if (windowState.state === 'closed') return { state: 'closed', expiresAt: null }
  const expiresAtMs = typeof windowState.expiresAt === 'string'
    ? Date.parse(windowState.expiresAt)
    : Number.NaN
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return { state: 'closed', expiresAt: null }
  }
  return { state: 'open', expiresAt: windowState.expiresAt }
}
