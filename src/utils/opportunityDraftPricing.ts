/**
 * Pré-visualização local de totais de linha da composição, alinhada conceitualmente a
 * `opp_compute_line_total` (rpc_part1a.sql). O valor oficial após salvar vem do RPC.
 */

import type { CatalogProduct, CatalogService, DiscountType } from '../types/sales-funnel'

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Mesma ordem de arredondamento do SQL: subtotal = round(unit * qty, 2). */
export function computeLineTotalPreview(
  unitPrice: number,
  quantity: number,
  discountType: DiscountType,
  discountValue: number
): number {
  const safeUnit = Number.isFinite(unitPrice) ? unitPrice : 0
  const safeQty = Number.isFinite(quantity) ? quantity : 0
  const subtotal = round2(safeUnit * safeQty)

  if (discountType === 'fixed') {
    const dv = Number.isFinite(discountValue) ? discountValue : 0
    // No servidor, desconto > subtotal gera erro; no preview limitamos para não exibir negativo.
    const capped = Math.min(Math.max(0, dv), subtotal)
    return Math.max(0, round2(subtotal - capped))
  }
  if (discountType === 'percent') {
    const pct = Number.isFinite(discountValue) ? discountValue : 0
    const clampedPct = Math.min(100, Math.max(0, pct))
    const discAbs = round2(subtotal * clampedPct / 100)
    return Math.max(0, round2(subtotal - discAbs))
  }
  return Math.max(0, subtotal)
}

export function resolveUnitPrice(
  productId: string | undefined,
  serviceId: string | undefined,
  products: CatalogProduct[],
  services: CatalogService[]
): number {
  if (productId) {
    const p = products.find((x) => x.id === productId)
    const v = p?.default_price
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  if (serviceId) {
    const s = services.find((x) => x.id === serviceId)
    const v = s?.default_price
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  return 0
}

export type DraftLineLike = {
  productId?: string
  serviceId?: string
  quantity: number
  discountType: DiscountType
  discountValue: number
}

export function estimateDraftLinesTotal(
  lines: DraftLineLike[],
  products: CatalogProduct[],
  services: CatalogService[]
): number {
  let sum = 0
  for (const line of lines) {
    const unit = resolveUnitPrice(line.productId, line.serviceId, products, services)
    sum += computeLineTotalPreview(
      unit,
      line.quantity,
      line.discountType,
      line.discountValue
    )
  }
  return round2(sum)
}
