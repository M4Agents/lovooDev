/**
 * Gestão de relacionamentos do catálogo (alternativas / complementos).
 * Disponível apenas ao editar item existente. Filtros de IA/disponibilidade no consumo, não aqui.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link2, Plus, Trash2 } from 'lucide-react'
import { catalogApi } from '../../services/catalogApi'
import type {
  CatalogProduct,
  CatalogRelationResolvedRow,
  CatalogRelationType,
  CatalogService,
} from '../../types/sales-funnel'

type SourceKind = 'product' | 'service'

type Props = {
  companyId: string
  sourceType: SourceKind
  sourceId: string
  products: CatalogProduct[]
  services: CatalogService[]
}

function isPostgresUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  )
}

function targetKey(kind: SourceKind, id: string): string {
  return `${kind}:${id}`
}

export const CatalogItemRelationsEditor: React.FC<Props> = ({
  companyId,
  sourceType,
  sourceId,
  products,
  services,
}) => {
  const [alternatives, setAlternatives] = useState<CatalogRelationResolvedRow[]>([])
  const [addons, setAddons] = useState<CatalogRelationResolvedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [a, b] = await Promise.all([
        catalogApi.listCatalogRelationsForSource(companyId, sourceType, sourceId, 'alternative'),
        catalogApi.listCatalogRelationsForSource(companyId, sourceType, sourceId, 'addon'),
      ])
      setAlternatives(a)
      setAddons(b)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar relacionamentos')
    } finally {
      setLoading(false)
    }
  }, [companyId, sourceType, sourceId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-4">
      <div className="flex items-center gap-2 text-slate-800">
        <Link2 className="w-4 h-4 text-indigo-600" />
        <span className="text-sm font-semibold">Relacionamentos</span>
      </div>
      <p className="text-[11px] text-slate-500">
        Defina substitutos e itens complementares para o agente de IA e o time. O consumo aplica filtros de
        disponibilidade e IA separadamente.
      </p>
      {error && <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">{error}</div>}
      {loading ? (
        <p className="text-xs text-slate-500">Carregando…</p>
      ) : (
        <>
          <RelationBlock
            title="Alternativas"
            subtitle="Substitutos quando este item não estiver disponível."
            relationType="alternative"
            rows={alternatives}
            companyId={companyId}
            sourceType={sourceType}
            sourceId={sourceId}
            products={products}
            services={services}
            onChange={load}
          />
          <RelationBlock
            title="Itens complementares"
            subtitle="Sugestões adicionais ao oferecer este item."
            relationType="addon"
            rows={addons}
            companyId={companyId}
            sourceType={sourceType}
            sourceId={sourceId}
            products={products}
            services={services}
            onChange={load}
          />
        </>
      )}
    </div>
  )
}

const RelationBlock: React.FC<{
  title: string
  subtitle: string
  relationType: CatalogRelationType
  rows: CatalogRelationResolvedRow[]
  companyId: string
  sourceType: SourceKind
  sourceId: string
  products: CatalogProduct[]
  services: CatalogService[]
  onChange: () => Promise<void>
}> = ({
  title,
  subtitle,
  relationType,
  rows,
  companyId,
  sourceType,
  sourceId,
  products,
  services,
  onChange,
}) => {
  const [targetKind, setTargetKind] = useState<SourceKind>('product')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const existingKeys = useMemo(
    () => new Set(rows.map((r) => targetKey(r.target_kind, r.target_id))),
    [rows]
  )

  const isSelf = useCallback(
    (kind: SourceKind, id: string) =>
      sourceType === kind && id === sourceId,
    [sourceType, sourceId]
  )

  const productOptions = useMemo(
    () => products.filter((p) => !isSelf('product', p.id) && !existingKeys.has(targetKey('product', p.id))),
    [products, isSelf, existingKeys]
  )

  const serviceOptions = useMemo(
    () => services.filter((s) => !isSelf('service', s.id) && !existingKeys.has(targetKey('service', s.id))),
    [services, isSelf, existingKeys]
  )

  const options = targetKind === 'product' ? productOptions : serviceOptions
  const noMoreTargets = productOptions.length === 0 && serviceOptions.length === 0

  const add = async () => {
    if (!targetId) return
    setBusy(true)
    setMsg(null)
    try {
      const nextOrder =
        rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.sort_order)) + 1
      await catalogApi.createCatalogItemRelation({
        companyId,
        relationType,
        sourceProductId: sourceType === 'product' ? sourceId : null,
        sourceServiceId: sourceType === 'service' ? sourceId : null,
        targetProductId: targetKind === 'product' ? targetId : null,
        targetServiceId: targetKind === 'service' ? targetId : null,
        sortOrder: nextOrder,
      })
      setTargetId('')
      await onChange()
    } catch (e) {
      if (isPostgresUniqueViolation(e)) {
        setMsg('Já existe uma relação igual para este tipo. Escolha outro destino.')
      } else {
        setMsg(e instanceof Error ? e.message : 'Erro ao adicionar')
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (relationId: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await catalogApi.deleteCatalogItemRelation(relationId)
      await onChange()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao remover')
    } finally {
      setBusy(false)
    }
  }

  const updateSort = async (relationId: string, sortOrder: number) => {
    const n = Number.isFinite(sortOrder) ? sortOrder : 0
    try {
      await catalogApi.updateCatalogItemRelationSortOrder(relationId, n)
      await onChange()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao salvar prioridade')
    }
  }

  return (
    <div className="border border-slate-200 rounded-md bg-white p-3 space-y-2">
      <div>
        <h4 className="text-sm font-medium text-slate-800">{title}</h4>
        <p className="text-[11px] text-slate-500">{subtitle}</p>
      </div>
      {msg && <div className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">{msg}</div>}
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">Nenhum vínculo cadastrado.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.relation_id}
              className="flex flex-wrap items-center gap-2 text-xs border border-slate-100 rounded px-2 py-1.5"
            >
              <span
                className={`px-1.5 py-0.5 rounded font-medium ${
                  r.target_kind === 'product' ? 'bg-indigo-100 text-indigo-800' : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {r.target_kind === 'product' ? 'Produto' : 'Serviço'}
              </span>
              <span className="font-medium text-slate-800 flex-1 min-w-[120px]">{r.name}</span>
              <label className="flex items-center gap-1 text-slate-500">
                Prioridade
                <input
                  key={`${r.relation_id}-${r.sort_order}`}
                  type="number"
                  className="w-16 border border-slate-200 rounded px-1 py-0.5"
                  defaultValue={r.sort_order}
                  disabled={busy}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!Number.isFinite(v) || v === r.sort_order) return
                    void updateSort(r.relation_id, v)
                  }}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(r.relation_id)}
                className="p-1 text-red-600 hover:bg-red-50 rounded"
                title="Remover"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-slate-100">
        {noMoreTargets && (
          <p className="w-full text-[11px] text-slate-500">
            Todos os produtos e serviços já estão vinculados nesta categoria ou não há outros itens no catálogo.
          </p>
        )}
        <div>
          <label className="block text-[10px] text-slate-500 mb-0.5">Tipo do destino</label>
          <select
            className="border border-slate-300 rounded px-2 py-1 text-xs"
            value={targetKind}
            onChange={(e) => {
              setTargetKind(e.target.value as SourceKind)
              setTargetId('')
            }}
            disabled={busy}
          >
            <option value="product">Produto</option>
            <option value="service">Serviço</option>
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="block text-[10px] text-slate-500 mb-0.5">Item</label>
          <select
            className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={busy}
          >
            <option value="">Selecione…</option>
            {options.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={busy || !targetId}
          onClick={() => add()}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar
        </button>
      </div>
    </div>
  )
}
