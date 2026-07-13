// =====================================================
// FORM: UPDATE OPPORTUNITY — Motor de Automações
// Feature flag: VITE_ENABLE_AUTOMATION_UPDATE_OPPORTUNITY
// Não modifica banco diretamente — apenas configura o nó da automação.
// =====================================================

import { useState, useEffect } from 'react'
import { Plus, Trash2, AlertTriangle, AlertCircle } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { catalogApi } from '../../../services/catalogApi'
import type { CatalogProduct, CatalogService } from '../../../types/sales-funnel'

// -------------------------------------------------------
// Tipos locais
// -------------------------------------------------------

type DiscountType = 'fixed' | 'percent'
type ItemsMode = 'add' | 'replace'

interface ConfigItem {
  productId?: string
  serviceId?: string
  quantity: number
  unitPrice?: number | null
  discountType: DiscountType
  discountValue: number
}

interface UpdateOpportunityConfig {
  actionType: 'update_opportunity'
  fields?: {
    title?: string
    description?: string | null
    probability?: number
  }
  manageItems?: boolean
  itemsMode?: ItemsMode
  items?: ConfigItem[]
}

interface Props {
  config: UpdateOpportunityConfig
  setConfig: (c: UpdateOpportunityConfig) => void
}

// -------------------------------------------------------
// Itens disponíveis para venda (is_active + available/on_demand)
// -------------------------------------------------------

const SALEABLE = ['available', 'on_demand'] as const

// -------------------------------------------------------
// Componente: uma linha de item de configuração
// -------------------------------------------------------

interface ItemRowProps {
  item: ConfigItem
  index: number
  products: CatalogProduct[]
  services: CatalogService[]
  onChange: (index: number, patch: Partial<ConfigItem>) => void
  onRemove: (index: number) => void
}

function ItemRow({ item, index, products, services, onChange, onRemove }: ItemRowProps) {
  // '' (string vazia) significa "modo ativado, aguardando seleção no catálogo"
  const itemType = item.productId !== undefined ? 'product' : item.serviceId !== undefined ? 'service' : 'none'

  const handleCatalogChange = (id: string, type: 'product' | 'service') => {
    const catalog = type === 'product' ? products : services
    const entry = catalog.find(x => x.id === id)
    onChange(index, {
      productId:  type === 'product' ? id : undefined,
      serviceId:  type === 'service' ? id : undefined,
      unitPrice:  entry ? null : item.unitPrice,
    })
  }

  return (
    <div className="border border-gray-200 rounded-md p-3 space-y-2 bg-gray-50">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">Item {index + 1}</span>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-red-400 hover:text-red-600 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tipo */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (itemType !== 'product') {
              // Ativa modo produto: limpa serviceId, seta productId para '' (aguarda seleção)
              onChange(index, { productId: '', serviceId: undefined })
            }
          }}
          className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
            itemType === 'product'
              ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
              : 'border-gray-300 text-gray-600 hover:border-gray-400'
          }`}
        >
          Produto
        </button>
        <button
          type="button"
          onClick={() => {
            if (itemType !== 'service') {
              // Ativa modo serviço: limpa productId, seta serviceId para '' (aguarda seleção)
              onChange(index, { productId: undefined, serviceId: '' })
            }
          }}
          className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
            itemType === 'service'
              ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
              : 'border-gray-300 text-gray-600 hover:border-gray-400'
          }`}
        >
          Serviço
        </button>
      </div>

        {/* Aviso: tipo selecionado mas catálogo não escolhido */}
      {itemType !== 'none' && (item.productId === '' || item.serviceId === '') && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          Selecione um {itemType === 'product' ? 'produto' : 'serviço'} no catálogo abaixo.
        </div>
      )}

      {/* Seletor de catálogo */}
      {itemType !== 'none' && (
        <select
          value={item.productId || item.serviceId || ''}
          onChange={(e) => handleCatalogChange(e.target.value, itemType as 'product' | 'service')}
          className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        >
          <option value="">— Selecione —</option>
          {(itemType === 'product' ? products : services).map(x => (
            <option key={x.id} value={x.id}>
              {x.name} {x.default_price != null ? `(R$ ${x.default_price.toFixed(2)})` : ''}
            </option>
          ))}
        </select>
      )}

      {/* Quantidade e Preço unitário */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Quantidade *</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={item.quantity || ''}
            onChange={(e) => onChange(index, { quantity: parseFloat(e.target.value) || 0 })}
            placeholder="1"
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Preço unit. <span className="text-gray-400">(vazio = catálogo)</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.unitPrice != null ? item.unitPrice : ''}
            onChange={(e) => {
              const v = e.target.value
              onChange(index, { unitPrice: v === '' ? null : parseFloat(v) })
            }}
            placeholder="Padrão"
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Desconto */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tipo desconto</label>
          <select
            value={item.discountType}
            onChange={(e) => onChange(index, { discountType: e.target.value as DiscountType })}
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="fixed">Fixo (R$)</option>
            <option value="percent">Percentual (%)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Valor desconto</label>
          <input
            type="number"
            min="0"
            max={item.discountType === 'percent' ? 100 : undefined}
            step="0.01"
            value={item.discountValue || 0}
            onChange={(e) => onChange(index, { discountValue: parseFloat(e.target.value) || 0 })}
            className="w-full text-sm rounded border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------------
// Componente principal
// -------------------------------------------------------

export default function UpdateOpportunityForm({ config, setConfig }: Props) {
  const { company } = useAuth()

  // Catálogo
  const [products, setProducts]         = useState<CatalogProduct[]>([])
  const [services, setServices]         = useState<CatalogService[]>([])
  const [loadingCatalog, setLoading]    = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  // Estado de toggles derivado da config (inicializado uma vez)
  const [enableTitle, setEnableTitle]           = useState('title' in (config.fields ?? {}))
  const [enableDescription, setEnableDescription] = useState('description' in (config.fields ?? {}))
  const [enableProbability, setEnableProbability] = useState('probability' in (config.fields ?? {}))

  // Carregar catálogo apenas quando itens estiverem ativos
  useEffect(() => {
    if (!company?.id || !config.manageItems) return

    setLoading(true)
    setCatalogError(null)

    Promise.all([
      catalogApi.getProducts(company.id, { isActive: true }),
      catalogApi.getServices(company.id, { isActive: true }),
    ])
      .then(([prods, svcs]) => {
        setProducts(prods.filter(p => (SALEABLE as readonly string[]).includes(p.availability_status)))
        setServices(svcs.filter(s => (SALEABLE as readonly string[]).includes(s.availability_status)))
      })
      .catch(() => setCatalogError('Erro ao carregar catálogo. Verifique sua conexão.'))
      .finally(() => setLoading(false))
  }, [company?.id, config.manageItems])

  // Helpers para atualizar config
  const setFields = (patch: Partial<NonNullable<UpdateOpportunityConfig['fields']>>) => {
    setConfig({ ...config, fields: { ...(config.fields ?? {}), ...patch } })
  }

  const removeField = (key: keyof NonNullable<UpdateOpportunityConfig['fields']>) => {
    const fields = { ...(config.fields ?? {}) }
    delete fields[key]
    setConfig({ ...config, fields: Object.keys(fields).length ? fields : undefined })
  }

  const setItems = (items: ConfigItem[]) => {
    setConfig({ ...config, items })
  }

  const addItem = () => {
    const current = config.items ?? []
    setItems([...current, { quantity: 1, discountType: 'fixed', discountValue: 0 }])
  }

  const removeItem = (index: number) => {
    const current = config.items ?? []
    setItems(current.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, patch: Partial<ConfigItem>) => {
    const current = config.items ?? []
    setItems(current.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  const currentItems = config.items ?? []
  const isReplaceEmpty = config.manageItems && config.itemsMode === 'replace' && currentItems.length === 0

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------

  return (
    <div className="space-y-4">

      {/* ---- CAMPOS SIMPLES ---- */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Campos da oportunidade</h4>
        <div className="space-y-3">

          {/* Título */}
          <div>
            <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enableTitle}
                onChange={(e) => {
                  setEnableTitle(e.target.checked)
                  if (!e.target.checked) {
                    removeField('title')
                  } else {
                    setFields({ title: config.fields?.title ?? '' })
                  }
                }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Título</span>
            </label>
            {enableTitle && (
              <input
                type="text"
                value={config.fields?.title ?? ''}
                onChange={(e) => setFields({ title: e.target.value })}
                placeholder="Novo título da oportunidade"
                className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            )}
          </div>

          {/* Descrição */}
          <div>
            <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enableDescription}
                onChange={(e) => {
                  setEnableDescription(e.target.checked)
                  if (!e.target.checked) {
                    removeField('description')
                  } else {
                    setFields({ description: config.fields?.description ?? '' })
                  }
                }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Descrição</span>
            </label>
            {enableDescription && (
              <textarea
                value={config.fields?.description ?? ''}
                onChange={(e) => setFields({ description: e.target.value || null })}
                rows={2}
                placeholder="Nova descrição (deixe vazio para limpar)"
                className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            )}
          </div>

          {/* Probabilidade */}
          <div>
            <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enableProbability}
                onChange={(e) => {
                  setEnableProbability(e.target.checked)
                  if (!e.target.checked) {
                    removeField('probability')
                  } else {
                    setFields({ probability: config.fields?.probability ?? 50 })
                  }
                }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Probabilidade (%)</span>
            </label>
            {enableProbability && (
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={config.fields?.probability ?? 50}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 0 && v <= 100) setFields({ probability: v })
                }}
                className="w-full text-sm rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              />
            )}
          </div>

        </div>
      </div>

      <div className="border-t border-gray-200" />

      {/* ---- GERENCIAR ITENS ---- */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.manageItems === true}
            onChange={(e) => {
              setConfig({
                ...config,
                manageItems: e.target.checked,
                itemsMode:   e.target.checked ? (config.itemsMode ?? 'add') : config.itemsMode,
              })
            }}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Gerenciar itens da oportunidade</span>
        </label>
        <p className="text-xs text-gray-400 mt-0.5 ml-6">
          Produtos e serviços vinculados à proposta
        </p>
      </div>

      {config.manageItems && (
        <div className="space-y-3 ml-1">

          {/* Modo add/replace */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Modo de operação</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfig({ ...config, itemsMode: 'add' })}
                className={`py-2 px-3 text-sm rounded-md border transition-colors ${
                  config.itemsMode === 'add'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                Adicionar itens
              </button>
              <button
                type="button"
                onClick={() => setConfig({ ...config, itemsMode: 'replace' })}
                className={`py-2 px-3 text-sm rounded-md border transition-colors ${
                  config.itemsMode === 'replace'
                    ? 'border-orange-500 bg-orange-50 text-orange-700 font-medium'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                Substituir todos
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {config.itemsMode === 'add'
                ? 'Os novos itens serão adicionados aos existentes.'
                : 'Todos os itens atuais serão removidos e substituídos pela lista abaixo.'}
            </p>
          </div>

          {/* Aviso destrutivo: replace com lista vazia */}
          {isReplaceEmpty && (
            <div className="flex gap-2 bg-orange-50 border border-orange-200 rounded-md p-3">
              <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-orange-700">
                <strong>Atenção:</strong> Esta configuração removerá <strong>todos os itens atuais</strong> da oportunidade sem adicionar novos.
              </p>
            </div>
          )}

          {/* Catálogo */}
          {loadingCatalog && (
            <p className="text-sm text-gray-400">Carregando catálogo...</p>
          )}
          {catalogError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
              {catalogError}
            </div>
          )}

          {/* Lista de itens */}
          {!loadingCatalog && !catalogError && (
            <div className="space-y-2">
              {currentItems.map((item, i) => (
                <ItemRow
                  key={i}
                  item={item}
                  index={i}
                  products={products}
                  services={services}
                  onChange={updateItem}
                  onRemove={removeItem}
                />
              ))}

              <button
                type="button"
                onClick={addItem}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 rounded-md hover:border-blue-500 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar item
              </button>
            </div>
          )}

        </div>
      )}

    </div>
  )
}
