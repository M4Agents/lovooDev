/**
 * Configurações → Produtos e Serviços (catálogo).
 * ai_notes / ai_unavailable_guidance: uso interno para o agente — não exibir ao cliente final.
 */

import { useCallback, useEffect, useState } from 'react'
import { Package, Plus, Pencil, RefreshCw } from 'lucide-react'
import { catalogApi } from '../../services/catalogApi'
import type { CatalogProduct, CatalogService } from '../../types/sales-funnel'
import { CatalogItemMediaEditor } from './CatalogItemMediaEditor'
import { CatalogItemRelationsEditor } from './CatalogItemRelationsEditor'
import { CatalogDefaultPriceField } from './CatalogDefaultPriceField'
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
  const [subTab, setSubTab] = useState<'products' | 'services'>('products')
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
        const [p, s] = await Promise.all([
          catalogApi.getProducts(companyId),
          catalogApi.getServices(companyId),
        ])
        setProducts(p)
        setServices(s)
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
          </div>

          {subTab === 'products' && (
            <CatalogProductList
              companyId={companyId}
              defaultCurrency={defaultCurrency}
              items={products}
              allServices={services}
              onRefresh={load}
            />
          )}
          {subTab === 'services' && (
            <CatalogServiceList
              companyId={companyId}
              defaultCurrency={defaultCurrency}
              items={services}
              allProducts={products}
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
  items: CatalogProduct[]
  allServices: CatalogService[]
  onRefresh: () => void
}> = ({ companyId, defaultCurrency, items, allServices, onRefresh }) => {
  const [editing, setEditing] = useState<CatalogProduct | null>(null)
  const [creating, setCreating] = useState(false)
  /** Mantém o mesmo formulário montado na transição criar → editar (evita perder estado). */
  const [formSessionKey, setFormSessionKey] = useState('')
  const [postCreateHint, setPostCreateHint] = useState(false)

  const handleProductSaved = (saved: CatalogProduct) => {
    const wasCreate = creating
    setCreating(false)
    setEditing(saved)
    if (wasCreate) setPostCreateHint(true)
    void onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
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
      {postCreateHint && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 flex flex-wrap items-center justify-between gap-2">
          <span>
            Produto criado — agora você pode adicionar mídias e relacionamentos abaixo.
          </span>
          <button
            type="button"
            className="text-emerald-800 underline text-xs shrink-0"
            onClick={() => setPostCreateHint(false)}
          >
            Ok
          </button>
        </div>
      )}
      {(creating || editing) && (
        <ProductForm
          key={formSessionKey}
          companyId={companyId}
          defaultCurrency={defaultCurrency}
          initial={editing}
          allProducts={items}
          allServices={allServices}
          onCancel={() => {
            setCreating(false)
            setEditing(null)
            setPostCreateHint(false)
          }}
          onSaved={handleProductSaved}
        />
      )}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-right px-3 py-2">Preço</th>
              <th className="text-left px-3 py-2">Ativo</th>
              <th className="text-left px-3 py-2">Disponibilidade</th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-900">{p.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(p.default_price, defaultCurrency)}
                </td>
                <td className="px-3 py-2">{p.is_active ? 'Sim' : 'Não'}</td>
                <td className="px-3 py-2">{p.availability_status}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFormSessionKey(`product-edit-${p.id}`)
                      setEditing(p)
                      setCreating(false)
                      setPostCreateHint(false)
                    }}
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Nenhum produto cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ProductForm: React.FC<{
  companyId: string
  defaultCurrency: string
  initial: CatalogProduct | null
  allProducts: CatalogProduct[]
  allServices: CatalogService[]
  onCancel: () => void
  onSaved: (saved: CatalogProduct) => void
}> = ({ companyId, defaultCurrency, initial, allProducts, allServices, onCancel, onSaved }) => {
  const [mediaBatchBusy, setMediaBatchBusy] = useState(false)
  const [name, setName] = useState(initial?.name ?? '')
  const [defaultPrice, setDefaultPrice] = useState(initial?.default_price ?? 0)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [availability, setAvailability] = useState(initial?.availability_status ?? 'available')
  const [stock, setStock] = useState(initial?.stock_status ?? 'unknown')
  const [aiNotes, setAiNotes] = useState(initial?.ai_notes ?? '')
  const [aiUnavailableGuidance, setAiUnavailableGuidance] = useState(
    initial?.ai_unavailable_guidance ?? ''
  )
  const [availableAi, setAvailableAi] = useState(initial?.available_for_ai ?? true)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (initial) {
        const updated = await catalogApi.updateProduct(initial.id, {
          name,
          default_price: defaultPrice,
          description: description || null,
          is_active: isActive,
          availability_status: availability as CatalogProduct['availability_status'],
          stock_status: stock as CatalogProduct['stock_status'],
          ai_notes: aiNotes || null,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || null,
          available_for_ai: availableAi,
        })
        onSaved(updated)
      } else {
        const created = await catalogApi.createProduct(companyId, {
          name,
          default_price: defaultPrice,
          description: description || undefined,
          is_active: isActive,
          availability_status: availability as CatalogProduct['availability_status'],
          stock_status: stock as CatalogProduct['stock_status'],
          ai_notes: aiNotes || undefined,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || undefined,
          available_for_ai: availableAi,
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
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Notas internas (contexto geral para o agente)
          </label>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={2}
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            placeholder="Instruções gerais para o agente…"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Quando indisponível ou descontinuado — como o agente deve agir
          </label>
          <p className="text-[11px] text-slate-500 mb-1">
            Use quando a disponibilidade não for “disponível” (ex.: indisponível, descontinuado). O agente usa isto como
            orientação interna; não é texto público automático.
          </p>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={3}
            value={aiUnavailableGuidance}
            onChange={(e) => setAiUnavailableGuidance(e.target.value)}
            placeholder="Ex.: explicar indisponibilidade, sugerir alternativa, oferecer lista de espera ou humano, evitar prazo…"
          />
        </div>
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
  items: CatalogService[]
  allProducts: CatalogProduct[]
  onRefresh: () => void
}> = ({ companyId, defaultCurrency, items, allProducts, onRefresh }) => {
  const [editing, setEditing] = useState<CatalogService | null>(null)
  const [creating, setCreating] = useState(false)
  const [formSessionKey, setFormSessionKey] = useState('')
  const [postCreateHint, setPostCreateHint] = useState(false)

  const handleServiceSaved = (saved: CatalogService) => {
    const wasCreate = creating
    setCreating(false)
    setEditing(saved)
    if (wasCreate) setPostCreateHint(true)
    void onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setFormSessionKey(`service-${Date.now()}`)
            setCreating(true)
            setEditing(null)
            setPostCreateHint(false)
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          Novo serviço
        </button>
      </div>
      {postCreateHint && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 flex flex-wrap items-center justify-between gap-2">
          <span>
            Serviço criado — agora você pode adicionar mídias e relacionamentos abaixo.
          </span>
          <button
            type="button"
            className="text-emerald-800 underline text-xs shrink-0"
            onClick={() => setPostCreateHint(false)}
          >
            Ok
          </button>
        </div>
      )}
      {(creating || editing) && (
        <ServiceForm
          key={formSessionKey}
          companyId={companyId}
          defaultCurrency={defaultCurrency}
          initial={editing}
          allProducts={allProducts}
          allServices={items}
          onCancel={() => {
            setCreating(false)
            setEditing(null)
            setPostCreateHint(false)
          }}
          onSaved={handleServiceSaved}
        />
      )}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-right px-3 py-2">Preço</th>
              <th className="text-left px-3 py-2">Ativo</th>
              <th className="text-left px-3 py-2">Disponibilidade</th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-900">{s.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(s.default_price, defaultCurrency)}
                </td>
                <td className="px-3 py-2">{s.is_active ? 'Sim' : 'Não'}</td>
                <td className="px-3 py-2">{s.availability_status}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFormSessionKey(`service-edit-${s.id}`)
                      setEditing(s)
                      setCreating(false)
                      setPostCreateHint(false)
                    }}
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Nenhum serviço cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ServiceForm: React.FC<{
  companyId: string
  defaultCurrency: string
  initial: CatalogService | null
  allProducts: CatalogProduct[]
  allServices: CatalogService[]
  onCancel: () => void
  onSaved: (saved: CatalogService) => void
}> = ({ companyId, defaultCurrency, initial, allProducts, allServices, onCancel, onSaved }) => {
  const [mediaBatchBusy, setMediaBatchBusy] = useState(false)
  const [name, setName] = useState(initial?.name ?? '')
  const [defaultPrice, setDefaultPrice] = useState(initial?.default_price ?? 0)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [availability, setAvailability] = useState(initial?.availability_status ?? 'available')
  const [aiNotes, setAiNotes] = useState(initial?.ai_notes ?? '')
  const [aiUnavailableGuidance, setAiUnavailableGuidance] = useState(
    initial?.ai_unavailable_guidance ?? ''
  )
  const [availableAi, setAvailableAi] = useState(initial?.available_for_ai ?? true)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (initial) {
        const updated = await catalogApi.updateService(initial.id, {
          name,
          default_price: defaultPrice,
          description: description || null,
          is_active: isActive,
          availability_status: availability as CatalogService['availability_status'],
          ai_notes: aiNotes || null,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || null,
          available_for_ai: availableAi,
        })
        onSaved(updated)
      } else {
        const created = await catalogApi.createService(companyId, {
          name,
          default_price: defaultPrice,
          description: description || undefined,
          is_active: isActive,
          availability_status: availability as CatalogService['availability_status'],
          ai_notes: aiNotes || undefined,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || undefined,
          available_for_ai: availableAi,
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
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Notas internas (contexto geral para o agente)
          </label>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={2}
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            placeholder="Instruções gerais para o agente…"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Quando indisponível ou descontinuado — como o agente deve agir
          </label>
          <p className="text-[11px] text-slate-500 mb-1">
            Use quando a disponibilidade não for “disponível”. Orientação interna para o agente; não é texto público
            automático.
          </p>
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            rows={3}
            value={aiUnavailableGuidance}
            onChange={(e) => setAiUnavailableGuidance(e.target.value)}
            placeholder="Ex.: explicar indisponibilidade, sugerir alternativa, oferecer lista de espera ou humano, evitar prazo…"
          />
        </div>
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
