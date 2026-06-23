// =====================================================
// COMPONENTE: CloseOpportunityModal
// Objetivo: Modal de confirmação ao mover oportunidade
//           para etapa com stage_type = 'won' ou 'lost'.
//           Dois seletores opcionais (lazy load):
//             - WonItemSelector: produtos/serviços
//             - WonSaleTypeSelector: tipos de venda
// =====================================================

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X, Loader2, TrendingUp, TrendingDown,
  DollarSign, Calendar, MessageSquare, ShoppingBag, Plus, Trash2,
  Tag, AlertCircle, ChevronDown, Check
} from 'lucide-react'
import type { CloseOpportunityParams, WonItemPayload, SaleType } from '../../types/sales-funnel'
import type { CatalogProduct, CatalogService } from '../../types/sales-funnel'
import { catalogApi } from '../../services/catalogApi'
import { saleTypesApi } from '../../services/saleTypesApi'

// ── helpers de formatação monetária ──
const centsToBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const brlToCents = (formatted: string): number =>
  parseInt(formatted.replace(/\D/g, '') || '0', 10)

const priceToBRL = (price: number): string =>
  centsToBRL(Math.round(price * 100))

// ── item de rascunho (estado local, não persistido ainda) ──
interface DraftItem {
  localId: string
  item_type: 'product' | 'service'
  item_id: string
  item_name: string
  unit_price: number
  quantity: number
}

// ──────────────────────────────────────────────────────
// Sub-componente: WonSaleTypeSelector
// Responsável por lazy load e seleção de tipos de venda.
// ──────────────────────────────────────────────────────
interface WonSaleTypeSelectorProps {
  companyId: string
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled: boolean
  currencyCode: string
}

const CHIPS_VISIBLE = 2

const WonSaleTypeSelector: React.FC<WonSaleTypeSelectorProps> = ({
  companyId,
  selectedIds,
  onChange,
  disabled,
}) => {
  const { t } = useTranslation('funnel')
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [saleTypes, setSaleTypes] = useState<SaleType[]>([])
  const [open, setOpen] = useState(false)
  const loaded = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (loaded.current || !companyId) return
    loaded.current = true
    setLoadingTypes(true)
    saleTypesApi.getVisibleSaleTypes(companyId)
      .then(data => setSaleTypes(data))
      .catch(() => setSaleTypes([]))
      .finally(() => setLoadingTypes(false))
  }, [companyId])

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter(x => x !== id)
        : [...selectedIds, id]
    )
  }

  const selectedTypes = saleTypes.filter(st => selectedIds.includes(st.id))
  const visibleChips = selectedTypes.slice(0, CHIPS_VISIBLE)
  const extraCount = selectedTypes.length - CHIPS_VISIBLE

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-indigo-600 flex-shrink-0" />
        <span className="text-sm font-medium text-indigo-900">
          {t('closeOpportunity.wonSaleTypeTitle')}
        </span>
      </div>

      {loadingTypes ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('closeOpportunity.wonSaleTypeLoadingList')}
        </div>
      ) : saleTypes.length === 0 ? (
        <div className="flex items-start gap-2 text-sm text-amber-700 px-1">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {t('closeOpportunity.wonSaleTypeEmptyList')}
        </div>
      ) : (
        <div ref={containerRef} className="relative">
          {/* Campo disparador */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen(prev => !prev)}
            className={[
              'w-full flex items-center gap-2 min-h-[40px] px-3 py-2 bg-white border rounded-lg text-left transition-colors',
              open
                ? 'border-indigo-400 ring-1 ring-indigo-400'
                : 'border-gray-300 hover:border-indigo-300',
              disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            <span className="flex-1 flex flex-wrap gap-1 min-w-0">
              {selectedTypes.length === 0 ? (
                <span className="text-sm text-gray-400">
                  {t('closeOpportunity.wonSaleTypePlaceholder', 'Selecione o tipo de venda...')}
                </span>
              ) : (
                <>
                  {visibleChips.map(st => (
                    <span
                      key={st.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full"
                    >
                      {st.name}
                      {!disabled && (
                        <span
                          role="button"
                          aria-label={`Remover ${st.name}`}
                          onMouseDown={e => { e.stopPropagation(); toggle(st.id) }}
                          className="ml-0.5 text-indigo-500 hover:text-indigo-700"
                        >
                          <X className="w-3 h-3" />
                        </span>
                      )}
                    </span>
                  ))}
                  {extraCount > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                      +{extraCount}
                    </span>
                  )}
                </>
              )}
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {/* Painel dropdown */}
          {open && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
              {saleTypes.map(st => {
                const checked = selectedIds.includes(st.id)
                return (
                  <button
                    key={st.id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); toggle(st.id) }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-indigo-50 transition-colors"
                  >
                    <span className={[
                      'flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center',
                      checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 bg-white',
                    ].join(' ')}>
                      {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-900">{st.name}</span>
                      {st.description && (
                        <span className="block text-xs text-gray-500 truncate">{st.description}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────
// Props do modal principal
// ──────────────────────────────────────────────────────
interface CloseOpportunityModalProps {
  isOpen: boolean
  stageType: 'won' | 'lost'
  opportunityTitle: string
  currentValue: number
  currencyCode?: string
  opportunityId: string
  funnelId: string
  toStageId: string
  positionInStage: number
  companyId: string
  requireItems?: boolean
  hasItems?: boolean
  requireSaleType?: boolean
  hasSaleTypes?: boolean
  onConfirm: (params: CloseOpportunityParams) => Promise<void>
  onCancel: () => void
}

const toLocalDateTimeInput = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const CloseOpportunityModal: React.FC<CloseOpportunityModalProps> = ({
  isOpen,
  stageType,
  opportunityTitle,
  currentValue,
  currencyCode = 'BRL',
  opportunityId,
  funnelId,
  toStageId,
  positionInStage,
  companyId,
  requireItems = false,
  hasItems = true,
  requireSaleType = false,
  hasSaleTypes = true,
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation('funnel')
  const isWon = stageType === 'won'

  // Determina se cada seletor deve aparecer
  const showItemSelector = isWon && requireItems && !hasItems
  const showSaleTypeSelector = isWon && requireSaleType && !hasSaleTypes

  // #region agent log
  if (isOpen) {
    console.log('[debug][CloseOpportunityModal] props on open', {isWon, stageType, requireSaleType, hasSaleTypes, showSaleTypeSelector, requireItems, hasItems, showItemSelector, opportunityId})
  }
  // #endregion

  // ── Formulário base ──
  const [closeDate, setCloseDate] = useState('')
  const [displayValue, setDisplayValue] = useState('')
  const [valueTouched, setValueTouched] = useState(false)
  const [lossReason, setLossReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  // ── Catálogo (lazy para items) ──
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [services, setServices] = useState<CatalogService[]>([])

  // ── Lista de rascunho de items ──
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const localIdRef = useRef(0)

  // ── Add row (items) ──
  const [addType, setAddType] = useState<'product' | 'service'>('product')
  const [addItemId, setAddItemId] = useState('')
  const [addPriceDisplay, setAddPriceDisplay] = useState('')
  const [addQty, setAddQty] = useState(1)

  // ── Tipos de venda selecionados ──
  const [selectedSaleTypeIds, setSelectedSaleTypeIds] = useState<string[]>([])

  // Subtotal dos rascunhos
  const draftSubtotal = draftItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)

  // Auto-fill de preço ao trocar o item selecionado no add row
  const productsRef = useRef(products)
  productsRef.current = products
  const servicesRef = useRef(services)
  servicesRef.current = services

  useEffect(() => {
    if (!addItemId) { setAddPriceDisplay(''); return }
    const list = addType === 'product' ? productsRef.current : servicesRef.current
    const found = list.find(i => i.id === addItemId)
    if (found) setAddPriceDisplay(priceToBRL(found.default_price))
    else setAddPriceDisplay('')
  }, [addItemId, addType])

  // Sincronizar "Valor da venda" com subtotal dos rascunhos (enquanto o usuário não editar)
  useEffect(() => {
    if (valueTouched) return
    if (draftSubtotal > 0) {
      setDisplayValue(priceToBRL(draftSubtotal))
    } else if (currentValue > 0) {
      setDisplayValue(priceToBRL(currentValue))
    } else {
      setDisplayValue('')
    }
  }, [draftSubtotal, valueTouched, currentValue])

  // Resetar ao abrir
  useEffect(() => {
    if (isOpen) {
      setCloseDate(toLocalDateTimeInput(new Date()))
      setDisplayValue(currentValue > 0 ? priceToBRL(currentValue) : '')
      setValueTouched(false)
      setLossReason('')
      setError(undefined)
      setDraftItems([])
      setAddType('product')
      setAddItemId('')
      setAddPriceDisplay('')
      setAddQty(1)
      setSelectedSaleTypeIds([])

      if (showItemSelector) loadCatalog()
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadCatalog = async () => {
    if (!companyId) return
    setLoadingCatalog(true)
    try {
      const [prods, svcs] = await Promise.all([
        catalogApi.getProducts(companyId, { isActive: true }),
        catalogApi.getServices(companyId, { isActive: true }),
      ])
      const filteredProds = prods.filter(p => ['available', 'on_demand'].includes(p.availability_status))
      const filteredSvcs = svcs.filter(s => ['available', 'on_demand'].includes(s.availability_status))
      setProducts(filteredProds)
      setServices(filteredSvcs)
      if (filteredProds.length > 0) {
        setAddType('product')
        setAddItemId(filteredProds[0].id)
      } else if (filteredSvcs.length > 0) {
        setAddType('service')
        setAddItemId(filteredSvcs[0].id)
      }
    } catch {
      // não bloquear o modal
    } finally {
      setLoadingCatalog(false)
    }
  }

  const handleAddTypeChange = (type: 'product' | 'service') => {
    setAddType(type)
    setAddItemId('')
    setAddPriceDisplay('')
  }

  const handleAddItem = () => {
    if (!addItemId) return
    const list = addType === 'product' ? products : services
    const found = list.find(i => i.id === addItemId)
    if (!found) return

    const priceNum = brlToCents(addPriceDisplay) / 100
    const qtyNum = addQty > 0 ? addQty : 1

    setDraftItems(prev => [...prev, {
      localId: String(++localIdRef.current),
      item_type: addType,
      item_id: addItemId,
      item_name: found.name,
      unit_price: priceNum > 0 ? priceNum : found.default_price,
      quantity: qtyNum,
    }])

    setAddItemId('')
    setAddPriceDisplay('')
    setAddQty(1)
  }

  const handleRemoveDraft = (localId: string) => {
    setDraftItems(prev => prev.filter(i => i.localId !== localId))
  }

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cents = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
    setDisplayValue(cents === 0 ? '' : centsToBRL(cents))
    setValueTouched(true)
  }

  const handleAddPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cents = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
    setAddPriceDisplay(cents === 0 ? '' : centsToBRL(cents))
  }

  if (!isOpen) return null

  const hasAnyCatalogItem = products.length > 0 || services.length > 0
  const addRowValid = !!addItemId && brlToCents(addPriceDisplay) > 0

  const itemSelectorBlocking = showItemSelector && draftItems.length === 0
  const saleTypeSelectorBlocking = showSaleTypeSelector && selectedSaleTypeIds.length === 0

  const currentList = addType === 'product' ? products : services

  const handleConfirm = async () => {
    if (showItemSelector && draftItems.length === 0) {
      setError(t('closeOpportunity.wonItemRequired'))
      return
    }
    if (showSaleTypeSelector && selectedSaleTypeIds.length === 0) {
      setError(t('closeOpportunity.wonSaleTypeRequired'))
      return
    }

    setError(undefined)
    setLoading(true)

    try {
      const closedAtISO = closeDate
        ? new Date(closeDate).toISOString()
        : new Date().toISOString()

      const itemsToAdd: WonItemPayload[] = draftItems.map(d => ({
        item_type:  d.item_type,
        item_id:    d.item_id,
        unit_price: d.unit_price,
        quantity:   d.quantity,
      }))

      await onConfirm({
        opportunity_id:    opportunityId,
        funnel_id:         funnelId,
        to_stage_id:       toStageId,
        position_in_stage: positionInStage,
        to_status:         stageType,
        value:             brlToCents(displayValue) / 100 || currentValue,
        loss_reason:       lossReason.trim() || undefined,
        closed_at:         closedAtISO,
        company_id:        companyId,
        items_to_add:      itemsToAdd.length > 0 ? itemsToAdd : undefined,
        sale_types_to_add: selectedSaleTypeIds.length > 0 ? selectedSaleTypeIds : undefined,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('WON_ITEM_REQUIRED')) {
        setError(t('closeOpportunity.errorWonItemRequired'))
      } else if (msg.includes('WON_SALE_TYPE_REQUIRED')) {
        setError(t('closeOpportunity.errorWonSaleTypeRequired'))
      } else if (msg.includes('INVALID_FUNNEL_POSITION')) {
        setError(t('closeOpportunity.errorInvalidFunnelPosition'))
      } else {
        setError(msg || t('closeOpportunity.errorGeneric'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !loading) onCancel()
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onMouseDown={handleBackdropClick}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center gap-3 p-5 border-b rounded-t-xl flex-shrink-0 ${isWon ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
          <div className={`p-2 rounded-lg ${isWon ? 'bg-emerald-100' : 'bg-red-100'}`}>
            {isWon
              ? <TrendingUp className="w-5 h-5 text-emerald-600" />
              : <TrendingDown className="w-5 h-5 text-red-600" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h2 className={`text-base font-semibold ${isWon ? 'text-emerald-900' : 'text-red-900'}`}>
              {isWon ? t('closeOpportunity.confirmWon') : t('closeOpportunity.confirmLost')}
            </h2>
            <p className="text-sm text-gray-500 truncate">{opportunityTitle}</p>
          </div>
          <button onClick={onCancel} disabled={loading} className="p-1.5 hover:bg-white rounded-lg transition-colors disabled:opacity-50">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Body — scrollável */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── Seletor multi-item de produto/serviço ── */}
          {showItemSelector && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span className="text-sm font-medium text-emerald-900">
                  {t('closeOpportunity.wonItemTitle')}
                </span>
              </div>

              {loadingCatalog ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('closeOpportunity.wonItemLoadingCatalog')}
                </div>
              ) : !hasAnyCatalogItem ? (
                <p className="text-sm text-amber-700">{t('closeOpportunity.wonItemEmptyCatalog')}</p>
              ) : (
                <>
                  {/* Linha de adição */}
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <select
                        value={addType}
                        onChange={e => handleAddTypeChange(e.target.value as 'product' | 'service')}
                        disabled={loading}
                        className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                      >
                        {products.length > 0 && <option value="product">{t('closeOpportunity.wonItemTypeProduct')}</option>}
                        {services.length > 0 && <option value="service">{t('closeOpportunity.wonItemTypeService')}</option>}
                      </select>
                      <select
                        value={addItemId}
                        onChange={e => setAddItemId(e.target.value)}
                        disabled={loading}
                        className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                      >
                        <option value="">{t('closeOpportunity.wonItemSelectPlaceholder')}</option>
                        {currentList.map(item => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-2 items-center">
                      <div className="flex-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={addPriceDisplay}
                          onChange={handleAddPriceChange}
                          disabled={loading || !addItemId}
                          placeholder="0,00"
                          title={`${t('closeOpportunity.wonItemPriceLabel')} (${currencyCode})`}
                          className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-gray-50 disabled:opacity-50"
                        />
                      </div>
                      <div className="w-16">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={addQty}
                          onChange={e => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
                          disabled={loading || !addItemId}
                          title={t('closeOpportunity.wonItemQuantityLabel')}
                          className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-gray-50 disabled:opacity-50"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleAddItem}
                        disabled={loading || !addRowValid}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors flex-shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Lista de rascunhos */}
                  {draftItems.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {draftItems.map(item => (
                        <div key={item.localId} className="flex items-center justify-between gap-2 bg-white border border-emerald-100 rounded-lg px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-900 truncate">{item.item_name}</p>
                            <p className="text-xs text-gray-500">
                              {item.item_type === 'product' ? t('closeOpportunity.wonItemTypeProduct') : t('closeOpportunity.wonItemTypeService')}
                              {' · '}Qtd {item.quantity}
                              {' × '}
                              {item.unit_price.toLocaleString('pt-BR', { style: 'currency', currency: currencyCode })}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-semibold text-emerald-700">
                              {(item.unit_price * item.quantity).toLocaleString('pt-BR', { style: 'currency', currency: currencyCode })}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveDraft(item.localId)}
                            disabled={loading}
                            className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <div className="flex justify-between items-center px-3 py-1.5 bg-emerald-100 rounded-lg">
                        <span className="text-xs font-medium text-emerald-800">Subtotal</span>
                        <span className="text-xs font-bold text-emerald-900">
                          {draftSubtotal.toLocaleString('pt-BR', { style: 'currency', currency: currencyCode })}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Seletor de tipos de venda ── */}
          {showSaleTypeSelector && (
            <WonSaleTypeSelector
              companyId={companyId}
              selectedIds={selectedSaleTypeIds}
              onChange={setSelectedSaleTypeIds}
              disabled={loading}
              currencyCode={currencyCode}
            />
          )}

          {/* Data/hora de fechamento */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
              <Calendar className="w-4 h-4 text-gray-400" />
              {t('closeOpportunity.closeDateTime')}
            </label>
            <input
              type="datetime-local"
              value={closeDate}
              onChange={e => setCloseDate(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>

          {/* Valor da venda — único campo de valor (só para won) */}
          {isWon && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                <DollarSign className="w-4 h-4 text-gray-400" />
                {t('closeOpportunity.saleValue', { code: currencyCode })}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={displayValue}
                onChange={handleValueChange}
                disabled={loading}
                placeholder={t('createOpportunity.fields.valuePlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-400 mt-1">{t('closeOpportunity.saleValueHint')}</p>
            </div>
          )}

          {/* Motivo da perda */}
          {!isWon && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                <MessageSquare className="w-4 h-4 text-gray-400" />
                {t('closeOpportunity.lossReason')}
                <span className="text-gray-400 font-normal">{t('closeOpportunity.optional')}</span>
              </label>
              <textarea
                value={lossReason}
                onChange={e => setLossReason(e.target.value)}
                disabled={loading}
                rows={3}
                placeholder={t('closeOpportunity.lossReasonPlaceholder')}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 resize-none"
              />
            </div>
          )}

          {/* Erro inline */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span className="text-red-600 text-sm">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 pt-0 flex-shrink-0">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {t('form.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || itemSelectorBlocking || saleTypeSelectorBlocking}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
              isWon ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isWon ? t('closeOpportunity.confirmWonBtn') : t('closeOpportunity.confirmLostBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
