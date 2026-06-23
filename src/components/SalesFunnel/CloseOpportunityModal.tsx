// =====================================================
// COMPONENTE: CloseOpportunityModal
// Objetivo: Modal de confirmação ao mover oportunidade
//           para etapa com stage_type = 'won' ou 'lost'.
//           Coleta data/hora de fechamento, valor final
//           (won) e motivo de perda (lost).
//           Quando requireItems && !hasItems && won:
//           exibe seletor de produto/serviço com lazy load.
// =====================================================

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Loader2, TrendingUp, TrendingDown, DollarSign, Calendar, MessageSquare, ShoppingBag } from 'lucide-react'
import type { CloseOpportunityParams, WonItemPayload } from '../../types/sales-funnel'
import type { CatalogProduct, CatalogService } from '../../types/sales-funnel'
import { catalogApi } from '../../services/catalogApi'

// Converte centavos (inteiro) para string formatada em pt-BR (ex: 150050 → "1.500,50")
const centsToBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Extrai centavos de uma string formatada (ex: "1.500,50" → 150050)
const brlToCents = (formatted: string): number =>
  parseInt(formatted.replace(/\D/g, '') || '0', 10)

interface CloseOpportunityModalProps {
  isOpen: boolean
  stageType: 'won' | 'lost'
  opportunityTitle: string
  currentValue: number
  /** ISO 4217 — exibe no rótulo; valor já está na moeda da oportunidade */
  currencyCode?: string
  opportunityId: string
  funnelId: string
  toStageId: string
  positionInStage: number
  companyId: string
  /** Quando true e !hasItems, exibe seletor de produto/serviço */
  requireItems?: boolean
  /** Se a oportunidade já tem itens, o seletor não é exibido */
  hasItems?: boolean
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
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation('funnel')
  const isWon = stageType === 'won'

  // ── Formulário base ──
  const [closeDate, setCloseDate] = useState('')
  const [displayValue, setDisplayValue] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  // ── Seletor de item (lazy — só carrega quando necessário) ──
  const needsItemSelector = isWon && requireItems && !hasItems
  const [showItemSelector, setShowItemSelector] = useState(false)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [services, setServices] = useState<CatalogService[]>([])

  const [selectedItemType, setSelectedItemType] = useState<'product' | 'service'>('product')
  const [selectedItemId, setSelectedItemId] = useState('')
  const [selectedItemPrice, setSelectedItemPrice] = useState('')

  // Preencher valores padrão ao abrir
  useEffect(() => {
    if (isOpen) {
      setCloseDate(toLocalDateTimeInput(new Date()))
      setDisplayValue(currentValue > 0 ? centsToBRL(Math.round(currentValue * 100)) : '')
      setLossReason('')
      setError(undefined)
      setSelectedItemId('')
      setSelectedItemPrice('')
      setSelectedItemType('product')

      // Lazy load: carregar catálogo somente quando necessário
      if (isWon && requireItems && !hasItems) {
        setShowItemSelector(true)
        loadCatalog()
      } else {
        setShowItemSelector(false)
      }
    }
  }, [isOpen, currentValue, isWon, requireItems, hasItems])

  const loadCatalog = async () => {
    if (!companyId) return
    setLoadingCatalog(true)
    try {
      const [prods, svcs] = await Promise.all([
        catalogApi.getProducts(companyId, { isActive: true }),
        catalogApi.getServices(companyId, { isActive: true }),
      ])
      setProducts(prods)
      setServices(svcs)
      // Pré-selecionar primeiro item disponível
      if (prods.length > 0) {
        setSelectedItemType('product')
        setSelectedItemId(prods[0].id)
        setSelectedItemPrice(centsToBRL(Math.round(prods[0].default_price * 100)))
      } else if (svcs.length > 0) {
        setSelectedItemType('service')
        setSelectedItemId(svcs[0].id)
        setSelectedItemPrice(centsToBRL(Math.round(svcs[0].default_price * 100)))
      }
    } catch {
      // Não bloquear modal por erro de catálogo
    } finally {
      setLoadingCatalog(false)
    }
  }

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cents = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
    setDisplayValue(cents === 0 ? '' : centsToBRL(cents))
  }

  const handleItemPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cents = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
    setSelectedItemPrice(cents === 0 ? '' : centsToBRL(cents))
  }

  const handleItemTypeChange = (type: 'product' | 'service') => {
    setSelectedItemType(type)
    setSelectedItemId('')
    setSelectedItemPrice('')
  }

  const handleItemSelect = (itemId: string) => {
    setSelectedItemId(itemId)
    const list = selectedItemType === 'product' ? products : services
    const found = list.find(i => i.id === itemId)
    if (found) {
      setSelectedItemPrice(centsToBRL(Math.round(found.default_price * 100)))
    }
  }

  if (!isOpen) return null

  const currentList = selectedItemType === 'product' ? products : services
  const itemSelectionValid = !showItemSelector || (selectedItemId !== '' && brlToCents(selectedItemPrice) > 0)

  const handleConfirm = async () => {
    // Validação frontend: item obrigatório
    if (showItemSelector && !selectedItemId) {
      setError(t('closeOpportunity.wonItemRequired'))
      return
    }

    setError(undefined)
    setLoading(true)

    try {
      const closedAtISO = closeDate
        ? new Date(closeDate).toISOString()
        : new Date().toISOString()

      let itemToAdd: WonItemPayload | undefined
      if (showItemSelector && selectedItemId) {
        itemToAdd = {
          item_type:  selectedItemType,
          item_id:    selectedItemId,
          unit_price: brlToCents(selectedItemPrice) / 100,
          quantity:   1,
        }
      }

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
        item_to_add:       itemToAdd,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('WON_ITEM_REQUIRED')) {
        // Mostrar seletor retroativamente se ainda não estava visível
        if (!showItemSelector) {
          setShowItemSelector(true)
          loadCatalog()
        }
        setError(t('closeOpportunity.errorWonItemRequired'))
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`flex items-center gap-3 p-5 border-b rounded-t-xl ${isWon ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
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
          <button
            onClick={onCancel}
            disabled={loading}
            className="p-1.5 hover:bg-white rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* Seletor de produto/serviço — lazy load */}
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
              ) : products.length === 0 && services.length === 0 ? (
                <p className="text-sm text-amber-700">{t('closeOpportunity.wonItemEmptyCatalog')}</p>
              ) : (
                <>
                  {/* Tipo */}
                  <div className="flex gap-2">
                    {products.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleItemTypeChange('product')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                          selectedItemType === 'product'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-emerald-400'
                        }`}
                      >
                        {t('closeOpportunity.wonItemTypeProduct')}
                      </button>
                    )}
                    {services.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleItemTypeChange('service')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                          selectedItemType === 'service'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-emerald-400'
                        }`}
                      >
                        {t('closeOpportunity.wonItemTypeService')}
                      </button>
                    )}
                  </div>

                  {/* Item */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {t('closeOpportunity.wonItemSelectPlaceholder')}
                    </label>
                    <select
                      value={selectedItemId}
                      onChange={e => handleItemSelect(e.target.value)}
                      disabled={loading}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50"
                    >
                      <option value="">{t('closeOpportunity.wonItemSelectPlaceholder')}</option>
                      {currentList.map(item => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Preço */}
                  {selectedItemId && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {t('closeOpportunity.wonItemPriceLabel')} ({currencyCode})
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={selectedItemPrice}
                        onChange={handleItemPriceChange}
                        disabled={loading}
                        placeholder="0,00"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
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

          {/* Valor final — apenas para won */}
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
              <p className="text-xs text-gray-400 mt-1">
                {t('closeOpportunity.saleValueHint')}
              </p>
            </div>
          )}

          {/* Motivo da perda — apenas para lost */}
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

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-red-600 text-sm">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 pt-0">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {t('form.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !itemSelectionValid}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
              isWon
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-red-600 hover:bg-red-700'
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
