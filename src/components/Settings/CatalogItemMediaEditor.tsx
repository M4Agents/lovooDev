/**
 * Mídias do item (produto/serviço) — vínculos à biblioteca corporativa.
 * Disponível apenas ao editar item existente.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Image as ImageIcon, Plus, Trash2, Video } from 'lucide-react'
import {
  catalogMediaApi,
  CATALOG_MEDIA_USAGE_ROLES,
  type CatalogItemMediaResolved,
  type CatalogMediaUsageRole,
  type CompanyLibraryAssetPicker,
} from '../../services/catalogMediaApi'

type SourceKind = 'product' | 'service'

function usageRoleLabel(role: CatalogMediaUsageRole): string {
  const map: Record<CatalogMediaUsageRole, string> = {
    presentation: 'Apresentação',
    demo: 'Demonstração',
    proof: 'Prova / resultado',
    testimonial: 'Depoimento',
    before_after: 'Antes e depois',
  }
  return map[role] ?? role
}

type Props = {
  companyId: string
  sourceType: SourceKind
  sourceId: string
}

export const CatalogItemMediaEditor: React.FC<Props> = ({ companyId, sourceType, sourceId }) => {
  const [rows, setRows] = useState<CatalogItemMediaResolved[]>([])
  const [assets, setAssets] = useState<CompanyLibraryAssetPicker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addAssetId, setAddAssetId] = useState('')
  const [addUsageRole, setAddUsageRole] = useState<CatalogMediaUsageRole>('presentation')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, a] = await Promise.all([
        catalogMediaApi.listResolved(companyId, {
          productId: sourceType === 'product' ? sourceId : null,
          serviceId: sourceType === 'service' ? sourceId : null,
        }),
        catalogMediaApi.listLibraryAssetsForPicker(companyId),
      ])
      setRows(r)
      setAssets(a)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar mídias do item')
    } finally {
      setLoading(false)
    }
  }, [companyId, sourceType, sourceId])

  useEffect(() => {
    void load()
  }, [load])

  const assetById = useMemo(() => {
    const m = new Map<string, CompanyLibraryAssetPicker>()
    for (const x of assets) m.set(x.id, x)
    return m
  }, [assets])

  const comboKey = (assetId: string, role: CatalogMediaUsageRole) => `${assetId}:${role}`

  const existingCombos = useMemo(() => {
    const s = new Set<string>()
    for (const row of rows) {
      s.add(comboKey(row.library_asset_id, row.usage_role))
    }
    return s
  }, [rows])

  const selectableAssets = useMemo(() => {
    return assets.filter((a) => a.file_type === 'image' || a.file_type === 'video')
  }, [assets])

  const handleAdd = async () => {
    if (!addAssetId) return
    const asset = assetById.get(addAssetId)
    if (!asset || (asset.file_type !== 'image' && asset.file_type !== 'video')) return
    if (existingCombos.has(comboKey(addAssetId, addUsageRole))) {
      setError('Esta combinação de arquivo e função já existe.')
      return
    }
    setError(null)
    setAdding(true)
    try {
      await catalogMediaApi.addLink({
        companyId,
        productId: sourceType === 'product' ? sourceId : null,
        serviceId: sourceType === 'service' ? sourceId : null,
        libraryAssetId: addAssetId,
        mediaType: asset.file_type === 'video' ? 'video' : 'image',
        usageRole: addUsageRole,
        sortOrder: rows.length,
      })
      setAddAssetId('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao vincular mídia')
    } finally {
      setAdding(false)
    }
  }

  const patchRow = async (id: string, patch: Parameters<typeof catalogMediaApi.update>[1]) => {
    setError(null)
    try {
      await catalogMediaApi.update(id, patch)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao atualizar')
    }
  }

  const handleRemove = async (id: string) => {
    setError(null)
    try {
      await catalogMediaApi.remove(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao remover')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">Mídias do item</span>
        <Link
          to="/media-library"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-indigo-600 hover:underline"
        >
          Abrir biblioteca de mídias
        </Link>
      </div>
      <p className="text-[11px] text-slate-500">
        Vincule arquivos já existentes na biblioteca (imagens e vídeos). O mesmo arquivo pode ser reutilizado em
        vários itens. A exclusão na biblioteca pode ser bloqueada enquanto houver vínculo ativo.
      </p>
      {error && <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">{error}</div>}

      {loading ? (
        <p className="text-xs text-slate-500">Carregando mídias…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded border border-dashed border-slate-200 bg-white p-2">
            <div className="min-w-[180px] flex-1">
              <label className="block text-[10px] text-slate-500 mb-0.5">Arquivo da biblioteca</label>
              <select
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                value={addAssetId}
                onChange={(e) => setAddAssetId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {selectableAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.original_filename} ({a.file_type})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <label className="block text-[10px] text-slate-500 mb-0.5">Função</label>
              <select
                className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                value={addUsageRole}
                onChange={(e) => setAddUsageRole(e.target.value as CatalogMediaUsageRole)}
              >
                {CATALOG_MEDIA_USAGE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {usageRoleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={adding || !addAssetId}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 text-white text-xs disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Vincular
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma mídia vinculada a este item.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="text-left px-2 py-1.5">Arquivo</th>
                    <th className="text-left px-2 py-1.5">Tipo</th>
                    <th className="text-left px-2 py-1.5">Função</th>
                    <th className="text-left px-2 py-1.5 w-14">Ordem</th>
                    <th className="text-center px-2 py-1.5">Ativo</th>
                    <th className="text-center px-2 py-1.5">IA</th>
                    <th className="w-10 px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 max-w-[200px]">
                        <div className="flex items-center gap-2 min-w-0">
                          {row.media_type === 'video' ? (
                            <Video className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          )}
                          <span className="truncate" title={row.original_filename}>
                            {row.original_filename}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{row.media_type}</td>
                      <td className="px-2 py-1.5">
                        <select
                          className="w-full border border-slate-200 rounded px-1 py-0.5 max-w-[140px]"
                          value={row.usage_role}
                          onChange={(e) =>
                            void patchRow(row.id, { usage_role: e.target.value as CatalogMediaUsageRole })
                          }
                        >
                          {CATALOG_MEDIA_USAGE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {usageRoleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          className="w-12 border border-slate-200 rounded px-1 py-0.5"
                          defaultValue={row.sort_order}
                          onBlur={(e) => {
                            const v = Number.parseInt(e.target.value, 10)
                            if (Number.isFinite(v) && v !== row.sort_order) {
                              void patchRow(row.id, { sort_order: v })
                            }
                          }}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.is_active}
                          onChange={(e) => void patchRow(row.id, { is_active: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={row.use_in_ai}
                          onChange={(e) => void patchRow(row.id, { use_in_ai: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => void handleRemove(row.id)}
                          className="text-red-600 hover:bg-red-50 rounded p-1"
                          title="Remover vínculo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
