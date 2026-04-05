/**
 * Composição de valor por itens (feature) — detalhe da oportunidade.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Trash2 } from 'lucide-react'
import { OpportunityQuickAddRow } from './OpportunityQuickAddRow'
import { funnelApi } from '../../services/funnelApi'
import { catalogApi } from '../../services/catalogApi'
import { resolveOpportunityCompositionErrorMessage } from '../../utils/opportunityCompositionErrors'
import { formatCurrency } from '../../types/sales-funnel'
import type {
  Opportunity,
  OpportunityItemRow,
  CatalogProduct,
  CatalogService,
  DiscountType,
} from '../../types/sales-funnel'

type Props = {
  companyId: string
  opportunity: Opportunity
  canEdit: boolean
  onOpportunityUpdated: (o: Opportunity) => void
}

export const OpportunityItemsSection: React.FC<Props> = ({
  companyId,
  opportunity,
  canEdit,
  onOpportunityUpdated,
}) => {
  const { t } = useTranslation('funnel')
  const onUpdRef = useRef(onOpportunityUpdated)
  onUpdRef.current = onOpportunityUpdated

  const [entitled, setEntitled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<OpportunityItemRow[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [services, setServices] = useState<CatalogService[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const mode = opportunity.value_mode ?? 'manual'
  const itemsSub = opportunity.items_subtotal
  const gdt = opportunity.discount_type
  const gdv = opportunity.discount_value

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const e = await catalogApi.getOpportunityItemsEntitlement(companyId)
      setEntitled(e.allowed)
      if (e.allowed) {
        const [list, p, s, full] = await Promise.all([
          funnelApi.listOpportunityItems(companyId, opportunity.id),
          catalogApi.getProducts(companyId),
          catalogApi.getServices(companyId),
          funnelApi.getOpportunityById(opportunity.id),
        ])
        setItems(list)
        setProducts(p.filter((x) => x.is_active && ['available', 'on_demand'].includes(x.availability_status)))
        setServices(s.filter((x) => x.is_active && ['available', 'on_demand'].includes(x.availability_status)))
        if (full) onUpdRef.current(full)
      }
    } catch (err) {
      setError(resolveOpportunityCompositionErrorMessage(err, t, 'opportunityComposition.errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [companyId, opportunity.id, t])

  useEffect(() => {
    reload()
  }, [reload])

  if (!entitled) {
    return null
  }

  if (loading) {
    return <p className="text-xs text-slate-500 py-2">Carregando itens…</p>
  }

  const showComposition = canEdit || items.length > 0 || mode === 'items'

  if (!showComposition) {
    return null
  }

  const setMode = async (m: 'manual' | 'items') => {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      await funnelApi.opportunitySetValueMode(companyId, opportunity.id, m)
      const full = await funnelApi.getOpportunityById(opportunity.id)
      if (full) onOpportunityUpdated(full)
      await reload()
    } catch (err) {
      setError(resolveOpportunityCompositionErrorMessage(err, t, 'opportunityComposition.errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  const addLine = async (payload: {
    productId?: string
    serviceId?: string
    quantity: number
    discountType: DiscountType
    discountValue: number
  }) => {
    setBusy(true)
    setError(null)
    try {
      await funnelApi.opportunityAddItem({
        companyId,
        opportunityId: opportunity.id,
        productId: payload.productId,
        serviceId: payload.serviceId,
        quantity: payload.quantity,
        discountType: payload.discountType,
        discountValue: payload.discountValue,
      })
      await reload()
    } catch (err) {
      setError(resolveOpportunityCompositionErrorMessage(err, t, 'opportunityComposition.errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  const removeLine = async (itemId: string) => {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      await funnelApi.opportunityRemoveItem(companyId, itemId)
      await reload()
    } catch (err) {
      setError(resolveOpportunityCompositionErrorMessage(err, t, 'opportunityComposition.errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  const applyGlobalDiscount = async (dt: DiscountType, dv: number) => {
    if (!canEdit || mode !== 'items') return
    setBusy(true)
    setError(null)
    try {
      await funnelApi.opportunitySetGlobalDiscount(companyId, opportunity.id, dt, dv)
      await reload()
    } catch (err) {
      setError(resolveOpportunityCompositionErrorMessage(err, t, 'opportunityComposition.errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/80">
      <div className="flex items-center gap-2 text-slate-800">
        <Layers className="w-4 h-4 text-indigo-600" />
        <span className="text-sm font-semibold">Composição de valor</span>
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1.5">{error}</div>
      )}

      <div className="flex flex-wrap gap-2 items-center text-sm">
        <span className="text-slate-600">Modo:</span>
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => setMode('manual')}
          className={`px-2 py-1 rounded ${mode === 'manual' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200'}`}
        >
          Manual
        </button>
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => setMode('items')}
          className={`px-2 py-1 rounded ${mode === 'items' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200'}`}
        >
          Por itens
        </button>
      </div>

      {mode === 'manual' && items.length > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1.5">
          Existem linhas lançadas, mas o valor oficial é o campo manual enquanto o modo for manual.
        </p>
      )}

      {canEdit && (
        <OpportunityQuickAddRow
          busy={busy}
          products={products}
          services={services}
          onAdd={addLine}
        />
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-2 text-xs bg-white border border-slate-100 rounded px-2 py-1.5"
            >
              <div>
                <div className="font-medium text-slate-900">{row.name_snapshot}</div>
                <div className="text-slate-500">
                  {row.line_type === 'product' ? 'Produto' : 'Serviço'} · Qtd {Number(row.quantity)} ×{' '}
                  {formatCurrency(row.unit_price, opportunity.currency)} · Linha:{' '}
                  {formatCurrency(row.line_total, opportunity.currency)}
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeLine(row.id)}
                  className="p-1 text-red-600 hover:bg-red-50 rounded"
                  title="Remover"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {mode === 'items' && (
        <div className="text-xs space-y-1 border-t border-slate-200 pt-2">
          <div className="flex justify-between">
            <span className="text-slate-600">Subtotal itens</span>
            <span className="font-medium tabular-nums">
              {formatCurrency(itemsSub ?? 0, opportunity.currency)}
            </span>
          </div>
          {gdt && (
            <div className="flex justify-between text-slate-600">
              <span>
                Desconto global ({gdt === 'percent' ? `${gdv ?? 0}%` : 'fixo'})
              </span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-slate-900">
            <span>Total (oficial)</span>
            <span>{formatCurrency(opportunity.value, opportunity.currency)}</span>
          </div>
          {canEdit && (
            <GlobalDiscountMini
              busy={busy}
              onApply={applyGlobalDiscount}
            />
          )}
        </div>
      )}

      {mode === 'items' && items.length === 0 && (
        <p className="text-xs text-slate-500">Nenhum item. Inclua itens ou o valor total será zero.</p>
      )}
    </div>
  )
}

const GlobalDiscountMini: React.FC<{
  busy: boolean
  onApply: (dt: DiscountType, dv: number) => void
}> = ({ busy, onApply }) => {
  const [dt, setDt] = useState<DiscountType>('fixed')
  const [dv, setDv] = useState(0)
  return (
    <div className="flex flex-wrap gap-2 items-center pt-1">
      <span className="text-slate-600">Ajustar desconto global:</span>
      <select
        value={dt}
        onChange={(e) => setDt(e.target.value as DiscountType)}
        className="border border-slate-200 rounded px-2 py-0.5"
      >
        <option value="fixed">Fixo</option>
        <option value="percent">Percentual</option>
      </select>
      <input
        type="number"
        min={0}
        step={0.01}
        value={dv}
        onChange={(e) => setDv(parseFloat(e.target.value) || 0)}
        className="w-24 border border-slate-200 rounded px-2 py-0.5"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onApply(dt, dv)}
        className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:bg-white"
      >
        Aplicar
      </button>
    </div>
  )
}
