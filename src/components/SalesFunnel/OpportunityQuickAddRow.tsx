/**
 * Linha de inclusão rápida de produto/serviço na composição (reutilizável).
 */

import { useState, useEffect, useRef } from 'react'
import { Plus } from 'lucide-react'
import type { CatalogProduct, CatalogService, DiscountType } from '../../types/sales-funnel'
import { parsePtBrMoneyInput } from '../../utils/ptBrMoneyInput'
import { formatMoney } from '../../lib/formatMoney'

export type OpportunityQuickAddPayload = {
  productId?: string
  serviceId?: string
  quantity: number
  discountType: DiscountType
  discountValue: number
  /**
   * Preço unitário customizado (override do usuário).
   * Quando presente, sobrescreve o default_price do catálogo em opportunity_items.unit_price.
   * Quando ausente (undefined), o backend usa o default_price do catálogo.
   *
   * NOTA: Se o sistema evoluir para multi-locale de entrada monetária,
   * o ponto central de refactor deverá ser parsePtBrMoneyInput.
   */
  unitPrice?: number
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

  // --- Preço unitário customizado ---
  const [unitPriceDisplay, setUnitPriceDisplay] = useState('')
  const [unitPriceNumeric, setUnitPriceNumeric] = useState<number | undefined>()
  const [unitPriceTouched, setUnitPriceTouched] = useState(false)

  // Refs para ler catálogo atual sem adicionar arrays nas deps do useEffect de auto-fill.
  // Isso garante que a troca de item (pid/sid) seja o único gatilho do auto-fill,
  // sem sobrescrever edição manual quando o catálogo recarregar.
  const productsRef = useRef(products)
  productsRef.current = products
  const servicesRef = useRef(services)
  servicesRef.current = services

  const hasSelectedItem = (kind === 'product' && !!pid) || (kind === 'service' && !!sid)

  // Auto-preenchimento: dispara APENAS quando o item selecionado muda (via IDs ou kind).
  // NÃO dispara em re-renders por mudança no catálogo.
  useEffect(() => {
    setUnitPriceTouched(false)

    const product = kind === 'product' ? productsRef.current.find((p) => p.id === pid) : undefined
    const service = kind === 'service' ? servicesRef.current.find((s) => s.id === sid) : undefined
    const price = product?.default_price ?? service?.default_price

    if (price == null) {
      setUnitPriceDisplay('')
      setUnitPriceNumeric(undefined)
      return
    }

    // Padrão do sistema: entrada monetária via parsePtBrMoneyInput (dígitos como centavos).
    const cents = String(Math.round(price * 100))
    const { display } = parsePtBrMoneyInput(cents)
    setUnitPriceDisplay(display)
    setUnitPriceNumeric(price)
  }, [pid, sid, kind]) // deps: APENAS os IDs e tipo — evita sobrescrever edição manual

  const handleUnitPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setUnitPriceTouched(true)
    const hasDigits = /\d/.test(raw)
    if (!hasDigits) {
      // Campo foi esvaziado manualmente — manter display vazio, não converter para 0
      setUnitPriceDisplay('')
      setUnitPriceNumeric(undefined)
      return
    }
    const { numeric, display } = parsePtBrMoneyInput(raw)
    setUnitPriceDisplay(display)
    setUnitPriceNumeric(numeric)
  }

  // Preço inválido: campo tocado + sem valor ou valor negativo
  const unitPriceInvalid =
    hasSelectedItem &&
    unitPriceTouched &&
    (unitPriceNumeric === undefined || !Number.isFinite(unitPriceNumeric) || unitPriceNumeric < 0)

  const discountNumeric =
    disc === 'fixed' ? parsePtBrMoneyInput(discFixedDisplay).numeric : discPercent

  const submit = () => {
    if (unitPriceInvalid) return

    const resolvedUnitPrice =
      unitPriceNumeric != null &&
      Number.isFinite(unitPriceNumeric) &&
      unitPriceNumeric >= 0
        ? unitPriceNumeric
        : undefined

    const payloadBase = {
      quantity: qty,
      discountType: disc,
      discountValue: discountNumeric,
      unitPrice: resolvedUnitPrice,
    }

    if (kind === 'product' && pid) {
      onAdd({ productId: pid, ...payloadBase })
      setPid('') // dispara useEffect → reseta price states automaticamente
    } else if (kind === 'service' && sid) {
      onAdd({ serviceId: sid, ...payloadBase })
      setSid('') // idem
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

      {/* Preço unitário — exibido apenas quando há item selecionado */}
      {hasSelectedItem && (
        <div className="w-full">
          <label className="block text-slate-500 mb-1">
            Preço unitário ({currency})
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={unitPriceDisplay}
            onChange={handleUnitPriceChange}
            placeholder={formatMoney(0, currency)}
            title={`Preço unitário em ${currency}. Edite para sobrescrever o preço padrão do catálogo.`}
            className={`${selectBase} w-full tabular-nums ${
              unitPriceInvalid ? 'border-red-400 ring-1 ring-red-400' : ''
            }`}
          />
          {unitPriceInvalid && (
            <p className="text-red-600 mt-0.5">Informe um preço válido (≥ 0).</p>
          )}
        </div>
      )}

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
          disabled={busy || unitPriceInvalid}
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
