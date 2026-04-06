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
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                subTab === 'products' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'
              }`}
            >
              Produtos ({products.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('services')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                subTab === 'services' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'
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

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { setCreating(true); setEditing(null) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          Novo produto
        </button>
      </div>
      {(creating || editing) && (
        <ProductForm
          key={editing?.id ?? (creating ? 'new-product' : 'closed')}
          companyId={companyId}
          defaultCurrency={defaultCurrency}
          initial={editing}
          allProducts={items}
          allServices={allServices}
          onCancel={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); onRefresh() }}
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
                    onClick={() => { setEditing(p); setCreating(false) }}
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
  onSaved: () => void
}> = ({ companyId, defaultCurrency, initial, allProducts, allServices, onCancel, onSaved }) => {
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
        await catalogApi.updateProduct(initial.id, {
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
      } else {
        await catalogApi.createProduct(companyId, {
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
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 p-4 space-y-3 bg-white">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Nome</label>
          <input
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Preço padrão</label>
          <CatalogDefaultPriceField
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            currencyCode={defaultCurrency}
            value={defaultPrice}
            onChange={setDefaultPrice}
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Descrição (catálogo)</label>
        <textarea
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Disponibilidade</label>
          <select
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
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
          <label className="block text-xs text-slate-500 mb-1">Estoque (sinalização)</label>
          <select
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
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
          <label className="block text-xs text-slate-600 mb-1">
            Notas internas (contexto geral para o agente)
          </label>
          <textarea
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
            rows={2}
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            placeholder="Instruções gerais para o agente…"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">
            Quando indisponível ou descontinuado — como o agente deve agir
          </label>
          <p className="text-[11px] text-slate-500 mb-1">
            Use quando a disponibilidade não for “disponível” (ex.: indisponível, descontinuado). O agente usa isto como
            orientação interna; não é texto público automático.
          </p>
          <textarea
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
            rows={3}
            value={aiUnavailableGuidance}
            onChange={(e) => setAiUnavailableGuidance(e.target.value)}
            placeholder="Ex.: explicar indisponibilidade, sugerir alternativa, oferecer lista de espera ou humano, evitar prazo…"
          />
        </div>
      </div>
      {initial && (
        <CatalogItemMediaEditor companyId={companyId} sourceType="product" sourceId={initial.id} />
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
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-600">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
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

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { setCreating(true); setEditing(null) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          Novo serviço
        </button>
      </div>
      {(creating || editing) && (
        <ServiceForm
          key={editing?.id ?? (creating ? 'new-service' : 'closed')}
          companyId={companyId}
          defaultCurrency={defaultCurrency}
          initial={editing}
          allProducts={allProducts}
          allServices={items}
          onCancel={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); onRefresh() }}
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
                    onClick={() => { setEditing(s); setCreating(false) }}
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
  onSaved: () => void
}> = ({ companyId, defaultCurrency, initial, allProducts, allServices, onCancel, onSaved }) => {
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
        await catalogApi.updateService(initial.id, {
          name,
          default_price: defaultPrice,
          description: description || null,
          is_active: isActive,
          availability_status: availability as CatalogService['availability_status'],
          ai_notes: aiNotes || null,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || null,
          available_for_ai: availableAi,
        })
      } else {
        await catalogApi.createService(companyId, {
          name,
          default_price: defaultPrice,
          description: description || undefined,
          is_active: isActive,
          availability_status: availability as CatalogService['availability_status'],
          ai_notes: aiNotes || undefined,
          ai_unavailable_guidance: aiUnavailableGuidance.trim() || undefined,
          available_for_ai: availableAi,
        })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 p-4 space-y-3 bg-white">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Nome</label>
          <input
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Preço padrão</label>
          <CatalogDefaultPriceField
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
            currencyCode={defaultCurrency}
            value={defaultPrice}
            onChange={setDefaultPrice}
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Descrição</label>
        <textarea
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Disponibilidade</label>
        <select
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
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
          <label className="block text-xs text-slate-600 mb-1">
            Notas internas (contexto geral para o agente)
          </label>
          <textarea
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
            rows={2}
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            placeholder="Instruções gerais para o agente…"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">
            Quando indisponível ou descontinuado — como o agente deve agir
          </label>
          <p className="text-[11px] text-slate-500 mb-1">
            Use quando a disponibilidade não for “disponível”. Orientação interna para o agente; não é texto público
            automático.
          </p>
          <textarea
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
            rows={3}
            value={aiUnavailableGuidance}
            onChange={(e) => setAiUnavailableGuidance(e.target.value)}
            placeholder="Ex.: explicar indisponibilidade, sugerir alternativa, oferecer lista de espera ou humano, evitar prazo…"
          />
        </div>
      </div>
      {initial && (
        <CatalogItemMediaEditor companyId={companyId} sourceType="service" sourceId={initial.id} />
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
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-600">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}
