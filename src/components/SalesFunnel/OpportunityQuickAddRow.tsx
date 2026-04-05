/**
 * Linha de inclusão rápida de produto/serviço na composição (reutilizável).
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { CatalogProduct, CatalogService, DiscountType } from '../../types/sales-funnel'

export type OpportunityQuickAddPayload = {
  productId?: string
  serviceId?: string
  quantity: number
  discountType: DiscountType
  discountValue: number
}

type Props = {
  busy: boolean
  products: CatalogProduct[]
  services: CatalogService[]
  onAdd: (p: OpportunityQuickAddPayload) => void
}

export const OpportunityQuickAddRow: React.FC<Props> = ({
  busy,
  products,
  services,
  onAdd,
}) => {
  const [kind, setKind] = useState<'product' | 'service'>('product')
  const [pid, setPid] = useState('')
  const [sid, setSid] = useState('')
  const [qty, setQty] = useState(1)
  const [disc, setDisc] = useState<DiscountType>('fixed')
  const [discV, setDiscV] = useState(0)

  const submit = () => {
    if (kind === 'product' && pid) {
      onAdd({ productId: pid, quantity: qty, discountType: disc, discountValue: discV })
      setPid('')
    } else if (kind === 'service' && sid) {
      onAdd({ serviceId: sid, quantity: qty, discountType: disc, discountValue: discV })
      setSid('')
    }
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as 'product' | 'service')}
          className="border border-slate-200 rounded px-2 py-1"
        >
          <option value="product">Produto</option>
          <option value="service">Serviço</option>
        </select>
        {kind === 'product' ? (
          <select
            value={pid}
            onChange={(e) => setPid(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1 min-w-[140px]"
          >
            <option value="">Selecione…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={sid}
            onChange={(e) => setSid(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1 min-w-[140px]"
          >
            <option value="">Selecione…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="number"
          min={0.0001}
          step={0.0001}
          value={qty}
          onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
          className="w-20 border border-slate-200 rounded px-2 py-1"
        />
        <select
          value={disc}
          onChange={(e) => setDisc(e.target.value as DiscountType)}
          className="border border-slate-200 rounded px-2 py-1"
        >
          <option value="fixed">Desc. fixo</option>
          <option value="percent">Desc. %</option>
        </select>
        <input
          type="number"
          min={0}
          step={0.01}
          value={discV}
          onChange={(e) => setDiscV(parseFloat(e.target.value) || 0)}
          className="w-24 border border-slate-200 rounded px-2 py-1"
        />
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar
        </button>
      </div>
    </div>
  )
}
