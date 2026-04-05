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

const selectBase =
  'rounded border border-slate-200 bg-white px-2 py-2 text-xs text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400'

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
    <div className="w-full flex flex-col gap-3 text-xs">
      {/* Tipo + catálogo em largura total do modal */}
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as 'product' | 'service')}
          className={`${selectBase} w-full shrink-0 sm:w-[9rem]`}
        >
          <option value="product">Produto</option>
          <option value="service">Serviço</option>
        </select>
        {kind === 'product' ? (
          <select
            value={pid}
            onChange={(e) => setPid(e.target.value)}
            className={`${selectBase} min-w-0 w-full flex-1`}
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
            className={`${selectBase} min-w-0 w-full flex-1`}
          >
            <option value="">Selecione…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Qtd, desconto e ação — linha completa em telas maiores */}
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="number"
          min={0.0001}
          step={0.0001}
          value={qty}
          onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
          className={`${selectBase} w-full sm:w-24`}
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
          className={`${selectBase} w-full sm:w-[7.5rem]`}
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
            className={`${selectBase} w-full tabular-nums sm:max-w-[8.5rem]`}
          />
        ) : (
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={discPercent}
            onChange={(e) => setDiscPercent(parseFloat(e.target.value) || 0)}
            className={`${selectBase} w-full sm:max-w-[6.5rem]`}
          />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="inline-flex w-full shrink-0 items-center justify-center gap-1 rounded bg-indigo-600 px-3 py-2 font-medium text-white shadow-sm disabled:opacity-50 sm:ml-auto sm:w-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar
        </button>
      </div>
    </div>
  )
}
