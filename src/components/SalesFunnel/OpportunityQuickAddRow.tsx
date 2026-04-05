/**
 * Linha de inclusão rápida de produto/serviço na composição (reutilizável).
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { CatalogProduct, CatalogService, DiscountType } from '../../types/sales-funnel'
import { parsePtBrMoneyInput } from '../../utils/ptBrMoneyInput'

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
  /** Moeda da oportunidade/empresa (desconto fixo usa máscara alinhada ao campo valor principal). */
  currency?: string
  onAdd: (p: OpportunityQuickAddPayload) => void
}

export const OpportunityQuickAddRow: React.FC<Props> = ({
  busy,
  products,
  services,
  currency = 'BRL',
  onAdd,
}) => {
  const [kind, setKind] = useState<'product' | 'service'>('product')
  const [pid, setPid] = useState('')
  const [sid, setSid] = useState('')
  const [qty, setQty] = useState(1)
  const [disc, setDisc] = useState<DiscountType>('fixed')
  const [discFixedDisplay, setDiscFixedDisplay] = useState('0,00')
  const [discPercent, setDiscPercent] = useState(0)

  const discountNumeric =
    disc === 'fixed' ? parsePtBrMoneyInput(discFixedDisplay).numeric : discPercent

  const submit = () => {
    const payloadBase = {
      quantity: qty,
      discountType: disc,
      discountValue: discountNumeric,
    }
    if (kind === 'product' && pid) {
      onAdd({ productId: pid, ...payloadBase })
      setPid('')
    } else if (kind === 'service' && sid) {
      onAdd({ serviceId: sid, ...payloadBase })
      setSid('')
    }
    setDiscFixedDisplay('0,00')
    setDiscPercent(0)
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
          onChange={(e) => {
            const v = e.target.value as DiscountType
            setDisc(v)
            if (v === 'fixed') {
              setDiscFixedDisplay('0,00')
            } else {
              setDiscPercent(0)
            }
          }}
          className="border border-slate-200 rounded px-2 py-1"
        >
          <option value="fixed">Desc. fixo</option>
          <option value="percent">Desc. %</option>
        </select>
        {disc === 'fixed' ? (
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={discFixedDisplay}
            onChange={(e) => setDiscFixedDisplay(parsePtBrMoneyInput(e.target.value).display)}
            title={currency}
            className="w-28 border border-slate-200 rounded px-2 py-1 tabular-nums"
          />
        ) : (
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={discPercent}
            onChange={(e) => setDiscPercent(parseFloat(e.target.value) || 0)}
            className="w-24 border border-slate-200 rounded px-2 py-1"
          />
        )}
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
