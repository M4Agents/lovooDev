/**
 * Configurações → Produtos e Serviços (catálogo).
 * ai_notes / ai_unavailable_guidance: uso interno para o agente — não exibir ao cliente final.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Package, Plus, Pencil, RefreshCw, Tag, Trash2,
  ChevronDown, Search, SlidersHorizontal, X as XIcon,
  Download, Upload, Sparkles,
} from 'lucide-react'
import { catalogApi } from '../../services/catalogApi'
import { lovooAgentsApi } from '../../services/lovooAgentsApi'
import { catalogMediaApi } from '../../services/catalogMediaApi'
import { catalogCategoriesApi } from '../../services/catalogCategoriesApi'
import type { CatalogCategory, CatalogProduct, CatalogService } from '../../types/sales-funnel'
import { CatalogItemMediaEditor } from './CatalogItemMediaEditor'
import { CatalogItemRelationsEditor } from './CatalogItemRelationsEditor'
import { CatalogDefaultPriceField } from './CatalogDefaultPriceField'
import { CatalogImportModal } from './CatalogImportModal'
import { exportCatalogToCsv } from '../../utils/catalogCsvExport'
import { useDebounce } from '../../hooks/useDebounce'
import { formatMoney } from '../../lib/formatMoney'

type Props = {
  companyId: string
  companyPlan: string
  /** ISO 4217 — ex.: moeda padrão da empresa */
  defaultCurrency: string
  onCompanyFlagChange?: () => void
}

export const CatalogSettings: React.FC<Props> = ({
  companyId,
  companyPlan,
  defaultCurrency,
  onCompanyFlagChange,
}) => {
  const [loading, setLoading] = useState(true)
  const [entitled, setEntitled] = useState(false)
  const [companyEnabled, setCompanyEnabled] = useState(false)
  const [planOk, setPlanOk] = useState(false)
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [services, setServices] = useState<CatalogService[]>([])
  const [productThumbs, setProductThumbs] = useState<Record<string, string>>({})
  const [serviceThumbs, setServiceThumbs] = useState<Record<string, string>>({})
  const [subTab, setSubTab] = useState<'products' | 'services' | 'categories'>('products')
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savingFlag, setSavingFlag] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const e = await catalogApi.getOpportunityItemsEntitlement(companyId)
      setEntitled(e.allowed)
      setCompanyEnabled(Boolean(e.company_enabled))
      setPlanOk(Boolean(e.plan_ok))
      if (e.allowed) {
        const [p, s, pt, st, cats] = await Promise.all([
          catalogApi.getProducts(companyId),
          catalogApi.getServices(companyId),
          catalogMediaApi.getThumbnails(companyId, 'product'),
          catalogMediaApi.getThumbnails(companyId, 'service'),
          catalogCategoriesApi.listAll(companyId),
        ])
        setProducts(p)
        setServices(s)
        setProductThumbs(pt)
        setServiceThumbs(st)
        setCategories(cats)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar catálogo')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    load()
  }, [load])

  const toggleFeature = async () => {
    if (!planOk) return
    setSavingFlag(true)
    try {
      await catalogApi.setCompanyOpportunityItemsEnabled(companyId, !companyEnabled)
      setCompanyEnabled(!companyEnabled)
      onCompanyFlagChange?.()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSavingFlag(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-600 py-8">
        <RefreshCw className="w-5 h-5 animate-spin" />
        Carregando catálogo…
      </div>
    )
  }

  if (!planOk) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 text-sm">
        <p className="font-medium">Plano atual ({companyPlan}) não inclui composição por itens.</p>
        <p className="mt-1">Faça upgrade para Pro ou Enterprise para habilitar produtos, serviços e itens em oportunidades.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <Package className="w-6 h-6 text-indigo-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Produtos e serviços</h2>
          <p className="text-sm text-slate-600 mt-1">
            Cadastre itens para compor o valor das oportunidades. A moeda segue a configuração da empresa.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={companyEnabled}
                disabled={savingFlag || !planOk}
                onChange={() => toggleFeature()}
              />
              <span>Habilitar composição por itens nesta empresa</span>
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 text-red-800 text-sm px-3 py-2">{error}</div>
      )}

      {!entitled && planOk && (
        <p className="text-sm text-slate-600">
          Ative a opção acima para usar o catálogo e os itens nas oportunidades.
        </p>
      )}

      {entitled && (
        <>
          <div className="flex gap-2 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setSubTab('products')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subTab === 'products' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Produtos ({products.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('services')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subTab === 'services' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Serviços ({services.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('categories')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subTab === 'categories' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Categorias ({categories.length})
            </button>
          </div>

          {subTab === 'products' && (
            <CatalogProductList
              companyId={companyId}
              defaultCurrency={defaultCurrency}
              thumbnails={productThumbs}
              allServices={services}
              categories={categories.filter((c) => c.type === 'product')}
              onRefresh={load}
            />
          )}
          {subTab === 'services' && (
            <CatalogServiceList
              companyId={companyId}
              defaultCurrency={defaultCurrency}
              thumbnails={serviceThumbs}
              allProducts={products}
              categories={categories.filter((c) => c.type === 'service')}
              onRefresh={load}
            />
          )}
          {subTab === 'categories' && (
            <CatalogCategoryManager
              companyId={companyId}
              categories={categories}
              onRefresh={load}
            />
          )}
        </>
      )}
    </div>
  )
}

const CatalogProductList: React.FC<{
  companyId: string
  defaultCurrency: string
  thumbnails: Record<string, string>
  allServices: CatalogService[]
  categories: CatalogCategory[]
  onRefresh: () => void
}> = ({ companyId, defaultCurrency, thumbnails, allServices, categories, onRefresh }) => {
  const [listItems, setListItems] = useState<CatalogProduct[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // Filtros básicos
  const [filterName, setFilterName] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  // Filtros avançados (drawer)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [filterMinPrice, setFilterMinPrice] = useState('')
  const [filterMaxPrice, setFilterMaxPrice] = useState('')
  const [filterAvailability, setFilterAvailability] = useState('')

  const debouncedName = useDebounce(filterName, 300)

  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState<CatalogProduct | null>(null)
  const [creating, setCreating] = useState(false)
  const [formSessionKey, setFormSessionKey] = useState('')
  const [postCreateHint, setPostCreateHint] = useState(false)

  const hasActiveFilters =
    filterName || filterStatus || filterCategoryId || filterMinPrice || filterMaxPrice || filterAvailability

  const clearFilters = () => {
    setFilterName('')
    setFilterStatus('')
    setFilterCategoryId('')
    setFilterMinPrice('')
    setFilterMaxPrice('')
    setFilterAvailability('')
  }

  // Fetch com cancelamento para evitar race condition
  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    const filters = {
      name: debouncedName || undefined,
      isActive: filterStatus === '' ? undefined : filterStatus === 'active',
      categoryId: filterCategoryId || undefined,
      minPrice: filterMinPrice !== '' ? parseFloat(filterMinPrice) : undefined,
      maxPrice: filterMaxPrice !== '' ? parseFloat(filterMaxPrice) : undefined,
      availability: filterAvailability || undefined,
    }
    catalogApi.getProducts(companyId, filters)
      .then((data) => { if (!cancelled) setListItems(data) })
      .catch(() => { /* silencioso — erro não bloqueia a UI */ })
      .finally(() => { if (!cancelled) setListLoading(false) })
    return () => { cancelled = true }
  }, [companyId, debouncedName, filterStatus, filterCategoryId, filterMinPrice, filterMaxPrice, filterAvailability, refreshKey])

  const handleProductSaved = (saved: CatalogProduct) => {
    const wasCreate = creating
    setCreating(false)
    setEditing(saved)
    if (wasCreate) setPostCreateHint(true)
    setRefreshKey((k) => k + 1)
    void onRefresh()
  }

  return (
    <div className="space-y-3">
      {/* Barra de ações e filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Busca */}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Buscar produto…"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
        </div>
        {/* Status */}
        <select
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
        </select>
        {/* Categoria */}
        <select
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={filterCategoryId}
          onChange={(e) => setFilterCategoryId(e.target.value)}
        >
          <option value="">Categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {/* + Filtros */}
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            drawerOpen ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-gray-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filtros
        </button>
        {/* Limpar */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            <XIcon className="w-3 h-3" />
            Limpar
          </button>
        )}
        <div className="flex-1" />
        {/* Ações */}
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Upload className="w-3.5 h-3.5" />
          Importar
        </button>
        <button
          type="button"
          onClick={() => exportCatalogToCsv(listItems, 'produtos.csv')}
          disabled={listItems.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />
          Exportar CSV
        </button>
        <button
          type="button"
          onClick={() => {
            setFormSessionKey(`product-${Date.now()}`)
            setCreating(true)
            setEditing(null)
            setPostCreateHint(false)
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          Novo produto
        </button>
      </div>

      {/* Drawer de filtros avançados */}
      {drawerOpen && (
        <div ref={drawerRef} className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Preço mínimo</label>
            <input
              type="number" min="0" step="0.01"
              className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="0,00"
              value={filterMinPrice}
              onChange={(e) => setFilterMinPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Preço máximo</label>
            <input
              type="number" min="0" step="0.01"
              className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="—"
              value={filterMaxPrice}
              onChange={(e) => setFilterMaxPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Disponibilidade</label>
            <select
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              value={filterAvailability}
              onChange={(e) => setFilterAvailability(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="available">Disponível</option>
              <option value="unavailable">Indisponível</option>
              <option value="on_demand">Sob consulta</option>
              <option value="discontinued">Descontinuado</option>
            </select>
          </div>
        </div>
      )}

      {postCreateHint && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 flex flex-wrap items-center justify-between gap-2">
          <span>Produto criado — agora você pode adicionar mídias e relacionamentos abaixo.</span>
          <button type="button" className="text-emerald-800 underline text-xs shrink-0" onClick={() => setPostCreateHint(false)}>Ok</button>
        </div>
      )}

      {(creating || editing) && (
        <ProductForm
          key={formSessionKey}
          companyId={companyId}
          defaultCurrency={defaultCurrency}
          initial={editing}
          allProducts={listItems}
          allServices={allServices}
          categories={categories}
          onCancel={() => { setCreating(false); setEditing(null); setPostCreateHint(false) }}
          onSaved={handleProductSaved}
        />
      )}

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-left px-3 py-2">Categoria</th>
              <th className="text-right px-3 py-2">Preço</th>
              <th className="text-left px-3 py-2">Ativo</th>
              <th className="text-left px-3 py-2">Disponibilidade</th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {listLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-slate-400 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Carregando…
                </td>
              </tr>
            )}
            {!listLoading && listItems.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-2 py-1 align-middle">
                  {thumbnails[p.id] && (
                    <img src={thumbnails[p.id]} alt="" loading="lazy" className="w-6 h-6 rounded object-cover" />
                  )}
                </td>
                <td className="px-3 py-2 font-medium text-slate-900">{p.name}</td>
                <td className="px-3 py-2 text-slate-500">{p.catalog_categories?.name ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.default_price, defaultCurrency)}</td>
                <td className="px-3 py-2">{p.is_active ? 'Sim' : 'Não'}</td>
                <td className="px-3 py-2">{p.availability_status}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => { setFormSessionKey(`product-edit-${p.id}`); setEditing(p); setCreating(false); setPostCreateHint(false) }}
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />Editar
                  </button>
                </td>
              </tr>
            ))}
            {!listLoading && listItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  {hasActiveFilters ? 'Nenhum produto encontrado com os filtros aplicados.' : 'Nenhum produto cadastrado.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {importOpen && (
        <CatalogImportModal
          companyId={companyId}
          type="product"
          existingCategories={categories}
          onClose={() => setImportOpen(false)}
          onImported={() => { setRefreshKey((k) => k + 1); void onRefresh() }}
        />
      )}
    </div>
  )
}

const ProductForm: React.FC<{
  companyId: string
  defaultCurrency: string
  initial: CatalogProduct | null
  allProducts: CatalogProduct[]
  allServices: CatalogService[]
  categories: CatalogCategory[]
  onCancel: () => void
  onSaved: (saved: CatalogProduct) => void
}> = ({ companyId, defaultCurrency, initial, allProducts, allServices, categories, onCancel, onSaved }) => {
  const [mediaBatchBusy, setMediaBatchBusy] = useState(false)
  const [name, setName] = useState(initial?.name ?? '')
  const [defaultPrice, setDefaultPrice] = useState(initial?.default_price ?? 0)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [availability, setAvailability] = useState(initial?.availability_status ?? 'available')
  const [stock, setStock] = useState(initial?.stock_status ?? 'unknown')
  const [aiNotes, setAiNotes] = useState(initial?.ai_notes ?? '')
  const [aiUnavailableGuidance, setAiUnavailableGuidance] = useState(
    initial?.ai_unavailable_guidance ?? ''
  )
  const [availableAi, setAvailableAi] = useState(initial?.available_for_ai ?? true)
  const [externalSource, setExternalSource] = useState(initial?.external_source ?? '')
  const [externalId, setExternalId] = useState(initial?.external_id ?? '')
  const [externalReference, setExternalReference] = useState(initial?.external_reference ?? '')
  const [integrationOpen, setIntegrationOpen] = useState(
    Boolean(initial?.external_source || initial?.external_id || initial?.external_reference)
  )
  const [saving, setSaving] = useState(false)
  const [generatingNotes, setGeneratingNotes] = useState(false)
  const [generatingGuidance, setGeneratingGuidance] = useState(false)
  const [previewNotes, setPreviewNotes] = useState<string | null>(null)
  const [previewGuidance, setPreviewGuidance] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const handleGenerate = async (field: 'notes' | 'guidance') => {
    const isNotes = field === 'notes'
    const useId = isNotes
      ? 'products:field_writer:internal_notes'
      : 'products:field_writer:unavailable_behavior'
    isNotes ? setGeneratingNotes(true) : setGeneratingGuidance(true)
    setGenerateError(null)
    try {
      const result = await lovooAgentsApi.generateFieldText({
        use_id: useId,
        item_type: 'product',
        item_name: name,
        item_description: description,
        company_id: companyId,
      })
      isNotes ? setPreviewNotes(result) : setPreviewGuidance(result)
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Erro ao gerar texto')
    } finally {
      isNotes ? setGeneratingNotes(false) : setGeneratingGuidance(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (initial) {
        const updated = await catalogApi.updateProduct(initial.id, {
          name,
          default_price: defaultPrice,
          description: description || null,
          category_id: categoryId || null,
          is_active: isActive,
          availability_status: availability as CatalogProduct['availability_status'],
          stock_status: stock as CatalogProduct['stock_status'],
          ai_notes: aiNotes || null,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || null,
          available_for_ai: availableAi,
          external_source: externalSource.toLowerCase().trim() || null,
          external_id: externalId.trim() || null,
          external_reference: externalReference.trim() || null,
        })
        onSaved(updated)
      } else {
        const created = await catalogApi.createProduct(companyId, {
          name,
          default_price: defaultPrice,
          description: description || undefined,
          category_id: categoryId || null,
          is_active: isActive,
          availability_status: availability as CatalogProduct['availability_status'],
          stock_status: stock as CatalogProduct['stock_status'],
          ai_notes: aiNotes || undefined,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || undefined,
          available_for_ai: availableAi,
          external_source: externalSource || undefined,
          external_id: externalId || undefined,
          external_reference: externalReference || undefined,
        })
        onSaved(created)
      }
    } finally {
      setSaving(false)
    }
  }

  const requestCancel = () => {
    if (
      mediaBatchBusy &&
      !window.confirm(
        'Envio de mídias em andamento. Cancelar mesmo assim? O que já foi enviado permanece na biblioteca.'
      )
    ) {
      return
    }
    onCancel()
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 bg-white">
      <h3 className="text-lg font-semibold text-gray-900">
        {initial ? 'Editar produto' : 'Novo produto'}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Preço padrão</label>
          <CatalogDefaultPriceField
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            currencyCode={defaultCurrency}
            value={defaultPrice}
            onChange={setDefaultPrice}
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Categoria</label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Sem categoria</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Descrição (catálogo)</label>
        <textarea
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Disponibilidade</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
          >
            <option value="available">Disponível</option>
            <option value="unavailable">Indisponível</option>
            <option value="on_demand">Sob consulta</option>
            <option value="discontinued">Descontinuado</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Estoque (sinalização)</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          >
            <option value="unknown">Desconhecido</option>
            <option value="in_stock">Em estoque</option>
            <option value="out_of_stock">Sem estoque</option>
            <option value="not_applicable">Não aplicável</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Cadastro ativo
      </label>
      <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3 space-y-3">
        <p className="text-xs font-medium text-amber-900/90">
          Agente de IA (uso interno — não enviado como mensagem ao cliente)
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={availableAi} onChange={(e) => setAvailableAi(e.target.checked)} />
          Incluir este item no contexto do agente de IA
        </label>
        {generateError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{generateError}</p>
        )}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-slate-700">
              Notas internas (contexto geral para o agente)
            </label>
            <button
              type="button"
              onClick={() => handleGenerate('notes')}
              disabled={generatingNotes || !name.trim()}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={!name.trim() ? 'Preencha o nome primeiro' : 'Gerar com IA'}
            >
              {generatingNotes ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Gerar com IA
            </button>
          </div>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={2}
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            placeholder="Instruções gerais para o agente…"
          />
          {previewNotes && (
            <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-2">
              <p className="text-xs font-medium text-indigo-700">Texto gerado:</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{previewNotes}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAiNotes(previewNotes); setPreviewNotes(null) }}
                  className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition-colors">
                  Usar este texto
                </button>
                <button type="button" onClick={() => setPreviewNotes(null)}
                  className="px-3 py-1 bg-white text-slate-600 border border-slate-300 rounded text-xs hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-slate-700">
              Quando indisponível ou descontinuado — como o agente deve agir
            </label>
            <button
              type="button"
              onClick={() => handleGenerate('guidance')}
              disabled={generatingGuidance || !name.trim()}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={!name.trim() ? 'Preencha o nome primeiro' : 'Gerar com IA'}
            >
              {generatingGuidance ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Gerar com IA
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mb-1">
            Use quando a disponibilidade não for "disponível" (ex.: indisponível, descontinuado). O agente usa isto como
            orientação interna; não é texto público automático.
          </p>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={3}
            value={aiUnavailableGuidance}
            onChange={(e) => setAiUnavailableGuidance(e.target.value)}
            placeholder="Ex.: explicar indisponibilidade, sugerir alternativa, oferecer lista de espera ou humano, evitar prazo…"
          />
          {previewGuidance && (
            <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-2">
              <p className="text-xs font-medium text-indigo-700">Texto gerado:</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{previewGuidance}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAiUnavailableGuidance(previewGuidance); setPreviewGuidance(null) }}
                  className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition-colors">
                  Usar este texto
                </button>
                <button type="button" onClick={() => setPreviewGuidance(null)}
                  className="px-3 py-1 bg-white text-slate-600 border border-slate-300 rounded text-xs hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setIntegrationOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 text-left hover:bg-slate-100 transition-colors"
        >
          <span className="text-xs font-medium text-slate-600">Integração externa</span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${integrationOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {integrationOpen && (
          <div className="p-3 space-y-3 border-t border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Origem da integração</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="ex: shopify, bling"
                value={externalSource}
                onChange={(e) => setExternalSource(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">ID externo</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="ID no sistema externo"
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Referência externa</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="ex: SKU, código"
                  value={externalReference}
                  onChange={(e) => setExternalReference(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      {initial && (
        <CatalogItemMediaEditor
          companyId={companyId}
          sourceType="product"
          sourceId={initial.id}
          onBatchBusyChange={setMediaBatchBusy}
        />
      )}
      {initial && (
        <CatalogItemRelationsEditor
          companyId={companyId}
          sourceType="product"
          sourceId={initial.id}
          products={allProducts}
          services={allServices}
        />
      )}
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button type="button" onClick={requestCancel} className="px-6 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}

const CatalogServiceList: React.FC<{
  companyId: string
  defaultCurrency: string
  thumbnails: Record<string, string>
  allProducts: CatalogProduct[]
  categories: CatalogCategory[]
  onRefresh: () => void
}> = ({ companyId, defaultCurrency, thumbnails, allProducts, categories, onRefresh }) => {
  const [listItems, setListItems] = useState<CatalogService[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const [filterName, setFilterName] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [filterMinPrice, setFilterMinPrice] = useState('')
  const [filterMaxPrice, setFilterMaxPrice] = useState('')
  const [filterAvailability, setFilterAvailability] = useState('')

  const debouncedName = useDebounce(filterName, 300)

  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState<CatalogService | null>(null)
  const [creating, setCreating] = useState(false)
  const [formSessionKey, setFormSessionKey] = useState('')
  const [postCreateHint, setPostCreateHint] = useState(false)

  const hasActiveFilters =
    filterName || filterStatus || filterCategoryId || filterMinPrice || filterMaxPrice || filterAvailability

  const clearFilters = () => {
    setFilterName(''); setFilterStatus(''); setFilterCategoryId('')
    setFilterMinPrice(''); setFilterMaxPrice(''); setFilterAvailability('')
  }

  useEffect(() => {
    let cancelled = false
    setListLoading(true)
    const filters = {
      name: debouncedName || undefined,
      isActive: filterStatus === '' ? undefined : filterStatus === 'active',
      categoryId: filterCategoryId || undefined,
      minPrice: filterMinPrice !== '' ? parseFloat(filterMinPrice) : undefined,
      maxPrice: filterMaxPrice !== '' ? parseFloat(filterMaxPrice) : undefined,
      availability: filterAvailability || undefined,
    }
    catalogApi.getServices(companyId, filters)
      .then((data) => { if (!cancelled) setListItems(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setListLoading(false) })
    return () => { cancelled = true }
  }, [companyId, debouncedName, filterStatus, filterCategoryId, filterMinPrice, filterMaxPrice, filterAvailability, refreshKey])

  const handleServiceSaved = (saved: CatalogService) => {
    const wasCreate = creating
    setCreating(false)
    setEditing(saved)
    if (wasCreate) setPostCreateHint(true)
    setRefreshKey((k) => k + 1)
    void onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Buscar serviço…"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
        </select>
        <select
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={filterCategoryId}
          onChange={(e) => setFilterCategoryId(e.target.value)}
        >
          <option value="">Categoria</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            drawerOpen ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-gray-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />Filtros
        </button>
        {hasActiveFilters && (
          <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
            <XIcon className="w-3 h-3" />Limpar
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-slate-600 hover:bg-slate-50"
        >
          <Upload className="w-3.5 h-3.5" />Importar
        </button>
        <button
          type="button"
          onClick={() => exportCatalogToCsv(listItems, 'servicos.csv')}
          disabled={listItems.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />Exportar CSV
        </button>
        <button
          type="button"
          onClick={() => { setFormSessionKey(`service-${Date.now()}`); setCreating(true); setEditing(null); setPostCreateHint(false) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />Novo serviço
        </button>
      </div>

      {drawerOpen && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Preço mínimo</label>
            <input type="number" min="0" step="0.01"
              className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="0,00" value={filterMinPrice} onChange={(e) => setFilterMinPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Preço máximo</label>
            <input type="number" min="0" step="0.01"
              className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="—" value={filterMaxPrice} onChange={(e) => setFilterMaxPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Disponibilidade</label>
            <select
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              value={filterAvailability} onChange={(e) => setFilterAvailability(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="available">Disponível</option>
              <option value="unavailable">Indisponível</option>
              <option value="on_demand">Sob consulta</option>
              <option value="discontinued">Descontinuado</option>
            </select>
          </div>
        </div>
      )}

      {postCreateHint && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 flex flex-wrap items-center justify-between gap-2">
          <span>Serviço criado — agora você pode adicionar mídias e relacionamentos abaixo.</span>
          <button type="button" className="text-emerald-800 underline text-xs shrink-0" onClick={() => setPostCreateHint(false)}>Ok</button>
        </div>
      )}

      {(creating || editing) && (
        <ServiceForm
          key={formSessionKey}
          companyId={companyId}
          defaultCurrency={defaultCurrency}
          initial={editing}
          allProducts={allProducts}
          allServices={listItems}
          categories={categories}
          onCancel={() => { setCreating(false); setEditing(null); setPostCreateHint(false) }}
          onSaved={handleServiceSaved}
        />
      )}

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-left px-3 py-2">Categoria</th>
              <th className="text-right px-3 py-2">Preço</th>
              <th className="text-left px-3 py-2">Ativo</th>
              <th className="text-left px-3 py-2">Disponibilidade</th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {listLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-slate-400 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Carregando…
                </td>
              </tr>
            )}
            {!listLoading && listItems.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-2 py-1 align-middle">
                  {thumbnails[s.id] && (
                    <img src={thumbnails[s.id]} alt="" loading="lazy" className="w-6 h-6 rounded object-cover" />
                  )}
                </td>
                <td className="px-3 py-2 font-medium text-slate-900">{s.name}</td>
                <td className="px-3 py-2 text-slate-500">{s.catalog_categories?.name ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.default_price, defaultCurrency)}</td>
                <td className="px-3 py-2">{s.is_active ? 'Sim' : 'Não'}</td>
                <td className="px-3 py-2">{s.availability_status}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => { setFormSessionKey(`service-edit-${s.id}`); setEditing(s); setCreating(false); setPostCreateHint(false) }}
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />Editar
                  </button>
                </td>
              </tr>
            ))}
            {!listLoading && listItems.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  {hasActiveFilters ? 'Nenhum serviço encontrado com os filtros aplicados.' : 'Nenhum serviço cadastrado.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {importOpen && (
        <CatalogImportModal
          companyId={companyId}
          type="service"
          existingCategories={categories}
          onClose={() => setImportOpen(false)}
          onImported={() => { setRefreshKey((k) => k + 1); void onRefresh() }}
        />
      )}
    </div>
  )
}

const ServiceForm: React.FC<{
  companyId: string
  defaultCurrency: string
  initial: CatalogService | null
  allProducts: CatalogProduct[]
  allServices: CatalogService[]
  categories: CatalogCategory[]
  onCancel: () => void
  onSaved: (saved: CatalogService) => void
}> = ({ companyId, defaultCurrency, initial, allProducts, allServices, categories, onCancel, onSaved }) => {
  const [mediaBatchBusy, setMediaBatchBusy] = useState(false)
  const [name, setName] = useState(initial?.name ?? '')
  const [defaultPrice, setDefaultPrice] = useState(initial?.default_price ?? 0)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [availability, setAvailability] = useState(initial?.availability_status ?? 'available')
  const [aiNotes, setAiNotes] = useState(initial?.ai_notes ?? '')
  const [aiUnavailableGuidance, setAiUnavailableGuidance] = useState(
    initial?.ai_unavailable_guidance ?? ''
  )
  const [availableAi, setAvailableAi] = useState(initial?.available_for_ai ?? true)
  const [externalSource, setExternalSource] = useState(initial?.external_source ?? '')
  const [externalId, setExternalId] = useState(initial?.external_id ?? '')
  const [externalReference, setExternalReference] = useState(initial?.external_reference ?? '')
  const [integrationOpen, setIntegrationOpen] = useState(
    Boolean(initial?.external_source || initial?.external_id || initial?.external_reference)
  )
  const [saving, setSaving] = useState(false)
  const [generatingNotes, setGeneratingNotes] = useState(false)
  const [generatingGuidance, setGeneratingGuidance] = useState(false)
  const [previewNotes, setPreviewNotes] = useState<string | null>(null)
  const [previewGuidance, setPreviewGuidance] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const handleGenerate = async (field: 'notes' | 'guidance') => {
    const isNotes = field === 'notes'
    const useId = isNotes
      ? 'services:field_writer:internal_notes'
      : 'services:field_writer:unavailable_behavior'
    isNotes ? setGeneratingNotes(true) : setGeneratingGuidance(true)
    setGenerateError(null)
    try {
      const result = await lovooAgentsApi.generateFieldText({
        use_id: useId,
        item_type: 'service',
        item_name: name,
        item_description: description,
        company_id: companyId,
      })
      isNotes ? setPreviewNotes(result) : setPreviewGuidance(result)
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Erro ao gerar texto')
    } finally {
      isNotes ? setGeneratingNotes(false) : setGeneratingGuidance(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (initial) {
        const updated = await catalogApi.updateService(initial.id, {
          name,
          default_price: defaultPrice,
          description: description || null,
          category_id: categoryId || null,
          is_active: isActive,
          availability_status: availability as CatalogService['availability_status'],
          ai_notes: aiNotes || null,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || null,
          available_for_ai: availableAi,
          external_source: externalSource.toLowerCase().trim() || null,
          external_id: externalId.trim() || null,
          external_reference: externalReference.trim() || null,
        })
        onSaved(updated)
      } else {
        const created = await catalogApi.createService(companyId, {
          name,
          default_price: defaultPrice,
          description: description || undefined,
          category_id: categoryId || null,
          is_active: isActive,
          availability_status: availability as CatalogService['availability_status'],
          ai_notes: aiNotes || undefined,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || undefined,
          available_for_ai: availableAi,
          external_source: externalSource || undefined,
          external_id: externalId || undefined,
          external_reference: externalReference || undefined,
        })
        onSaved(created)
      }
    } finally {
      setSaving(false)
    }
  }

  const requestCancel = () => {
    if (
      mediaBatchBusy &&
      !window.confirm(
        'Envio de mídias em andamento. Cancelar mesmo assim? O que já foi enviado permanece na biblioteca.'
      )
    ) {
      return
    }
    onCancel()
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 bg-white">
      <h3 className="text-lg font-semibold text-gray-900">
        {initial ? 'Editar serviço' : 'Novo serviço'}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Preço padrão</label>
          <CatalogDefaultPriceField
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            currencyCode={defaultCurrency}
            value={defaultPrice}
            onChange={setDefaultPrice}
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Categoria</label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Sem categoria</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Descrição</label>
        <textarea
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Disponibilidade</label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={availability}
          onChange={(e) => setAvailability(e.target.value)}
        >
          <option value="available">Disponível</option>
          <option value="unavailable">Indisponível</option>
          <option value="on_demand">Sob consulta</option>
          <option value="discontinued">Descontinuado</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Cadastro ativo
      </label>
      <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-3 space-y-3">
        <p className="text-xs font-medium text-amber-900/90">
          Agente de IA (uso interno — não enviado como mensagem ao cliente)
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={availableAi} onChange={(e) => setAvailableAi(e.target.checked)} />
          Incluir este item no contexto do agente de IA
        </label>
        {generateError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{generateError}</p>
        )}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-slate-700">
              Notas internas (contexto geral para o agente)
            </label>
            <button
              type="button"
              onClick={() => handleGenerate('notes')}
              disabled={generatingNotes || !name.trim()}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={!name.trim() ? 'Preencha o nome primeiro' : 'Gerar com IA'}
            >
              {generatingNotes ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Gerar com IA
            </button>
          </div>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={2}
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            placeholder="Instruções gerais para o agente…"
          />
          {previewNotes && (
            <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-2">
              <p className="text-xs font-medium text-indigo-700">Texto gerado:</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{previewNotes}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAiNotes(previewNotes); setPreviewNotes(null) }}
                  className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition-colors">
                  Usar este texto
                </button>
                <button type="button" onClick={() => setPreviewNotes(null)}
                  className="px-3 py-1 bg-white text-slate-600 border border-slate-300 rounded text-xs hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-slate-700">
              Quando indisponível ou descontinuado — como o agente deve agir
            </label>
            <button
              type="button"
              onClick={() => handleGenerate('guidance')}
              disabled={generatingGuidance || !name.trim()}
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={!name.trim() ? 'Preencha o nome primeiro' : 'Gerar com IA'}
            >
              {generatingGuidance ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Gerar com IA
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mb-1">
            Use quando a disponibilidade não for "disponível". Orientação interna para o agente; não é texto público
            automático.
          </p>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={3}
            value={aiUnavailableGuidance}
            onChange={(e) => setAiUnavailableGuidance(e.target.value)}
            placeholder="Ex.: explicar indisponibilidade, sugerir alternativa, oferecer lista de espera ou humano, evitar prazo…"
          />
          {previewGuidance && (
            <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-2">
              <p className="text-xs font-medium text-indigo-700">Texto gerado:</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{previewGuidance}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAiUnavailableGuidance(previewGuidance); setPreviewGuidance(null) }}
                  className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 transition-colors">
                  Usar este texto
                </button>
                <button type="button" onClick={() => setPreviewGuidance(null)}
                  className="px-3 py-1 bg-white text-slate-600 border border-slate-300 rounded text-xs hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setIntegrationOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 text-left hover:bg-slate-100 transition-colors"
        >
          <span className="text-xs font-medium text-slate-600">Integração externa</span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${integrationOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {integrationOpen && (
          <div className="p-3 space-y-3 border-t border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Origem da integração</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="ex: shopify, bling"
                value={externalSource}
                onChange={(e) => setExternalSource(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">ID externo</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="ID no sistema externo"
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Referência externa</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="ex: SKU, código"
                  value={externalReference}
                  onChange={(e) => setExternalReference(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      {initial && (
        <CatalogItemMediaEditor
          companyId={companyId}
          sourceType="service"
          sourceId={initial.id}
          onBatchBusyChange={setMediaBatchBusy}
        />
      )}
      {initial && (
        <CatalogItemRelationsEditor
          companyId={companyId}
          sourceType="service"
          sourceId={initial.id}
          products={allProducts}
          services={allServices}
        />
      )}
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button type="button" onClick={requestCancel} className="px-6 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}

// ── Gestão de Categorias ────────────────────────────────────────────────────

type CategorySectionProps = {
  type: 'product' | 'service'
  label: string
  categories: CatalogCategory[]
  companyId: string
  onRefresh: () => void
}

const CategorySection: React.FC<CategorySectionProps> = ({ type, label, categories, companyId, onRefresh }) => {
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [sectionError, setSectionError] = useState<string | null>(null)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setSectionError(null)
    try {
      await catalogCategoriesApi.create(companyId, type, newName.trim())
      setNewName('')
      await onRefresh()
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : 'Erro ao criar categoria')
    } finally {
      setCreating(false)
    }
  }

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return
    setSavingId(id)
    setSectionError(null)
    try {
      await catalogCategoriesApi.update(id, { name: editName.trim() })
      setEditingId(null)
      await onRefresh()
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : 'Erro ao atualizar')
    } finally {
      setSavingId(null)
    }
  }

  const handleToggleActive = async (cat: CatalogCategory) => {
    setSavingId(cat.id)
    setSectionError(null)
    try {
      await catalogCategoriesApi.update(cat.id, { is_active: !cat.is_active })
      await onRefresh()
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : 'Erro ao atualizar')
    } finally {
      setSavingId(null)
    }
  }

  const handleRemove = async (id: string) => {
    if (!window.confirm('Remover categoria? Produtos/serviços vinculados perderão a categoria (dados preservados).')) return
    setSavingId(id)
    setSectionError(null)
    try {
      await catalogCategoriesApi.remove(id)
      await onRefresh()
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : 'Erro ao remover')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-indigo-500" />
        <h4 className="text-sm font-semibold text-slate-800">{label}</h4>
      </div>

      {sectionError && (
        <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{sectionError}</p>
      )}

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          placeholder="Nova categoria…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={120}
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar
        </button>
      </form>

      {categories.length === 0 ? (
        <p className="text-xs text-slate-400 italic">Nenhuma categoria cadastrada.</p>
      ) : (
        <ul className="space-y-1">
          {categories.map((cat) => (
            <li
              key={cat.id}
              className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
            >
              {editingId === cat.id ? (
                <>
                  <input
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    maxLength={120}
                  />
                  <button
                    type="button"
                    disabled={savingId === cat.id}
                    onClick={() => handleUpdate(cat.id)}
                    className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                  >
                    {savingId === cat.id ? 'Salvando…' : 'Salvar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${cat.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                    {cat.name}
                  </span>
                  <button
                    type="button"
                    disabled={savingId === cat.id}
                    onClick={() => handleToggleActive(cat)}
                    className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
                    title={cat.is_active ? 'Desativar' : 'Ativar'}
                  >
                    {cat.is_active ? 'Ativa' : 'Inativa'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(cat.id)
                      setEditName(cat.name)
                    }}
                    className="text-indigo-600 hover:text-indigo-800"
                    title="Editar nome"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={savingId === cat.id}
                    onClick={() => handleRemove(cat.id)}
                    className="text-red-500 hover:text-red-700 disabled:opacity-50"
                    title="Remover categoria"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const CatalogCategoryManager: React.FC<{
  companyId: string
  categories: CatalogCategory[]
  onRefresh: () => void
}> = ({ companyId, categories, onRefresh }) => {
  const productCats = categories.filter((c) => c.type === 'product')
  const serviceCats = categories.filter((c) => c.type === 'service')

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="rounded-xl border border-slate-200 shadow-sm p-5 bg-white space-y-4">
        <CategorySection
          type="product"
          label="Categorias de Produtos"
          categories={productCats}
          companyId={companyId}
          onRefresh={onRefresh}
        />
      </div>
      <div className="rounded-xl border border-slate-200 shadow-sm p-5 bg-white space-y-4">
        <CategorySection
          type="service"
          label="Categorias de Serviços"
          categories={serviceCats}
          companyId={companyId}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  )
}
