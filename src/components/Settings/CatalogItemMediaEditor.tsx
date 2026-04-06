/**
 * Mídias do item (produto/serviço) — biblioteca + upload em lote (regras do catálogo).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Upload } from 'lucide-react'
import {
  catalogMediaApi,
  CATALOG_MEDIA_USAGE_ROLES,
  type CatalogItemMediaResolved,
  type CatalogMediaUsageRole,
  type CompanyLibraryAssetPicker,
} from '../../services/catalogMediaApi'
import {
  CATALOG_MEDIA_MAX_FILES_PER_BATCH,
  uploadCatalogMediaToLibrary,
  validateCatalogMediaFile,
} from '../../services/catalogLibraryUpload'
import { CatalogMediaCard, usageRoleLabel } from './CatalogMediaCard'

type SourceKind = 'product' | 'service'

type BatchLineResult = {
  fileName: string
  status: 'ok' | 'invalid' | 'upload_fail' | 'link_fail' | 'duplicate'
  detail?: string
  libraryAssetId?: string
  mediaType?: 'image' | 'video'
}

type PendingLinkRetry = {
  key: string
  libraryAssetId: string
  fileName: string
  mediaType: 'image' | 'video'
}

type Props = {
  companyId: string
  sourceType: SourceKind
  sourceId: string
  /** Indica processamento de upload em lote (para bloquear fechamento do formulário) */
  onBatchBusyChange?: (busy: boolean) => void
}

function nextSortOrder(existing: CatalogItemMediaResolved[]): number {
  if (existing.length === 0) return 0
  return Math.max(...existing.map((r) => r.sort_order), -1) + 1
}

export const CatalogItemMediaEditor: React.FC<Props> = ({
  companyId,
  sourceType,
  sourceId,
  onBatchBusyChange,
}) => {
  const [rows, setRows] = useState<CatalogItemMediaResolved[]>([])
  const [assets, setAssets] = useState<CompanyLibraryAssetPicker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addAssetId, setAddAssetId] = useState('')
  const [defaultUsageRole, setDefaultUsageRole] = useState<CatalogMediaUsageRole>('presentation')
  const [defaultUseInAi, setDefaultUseInAi] = useState(true)
  const [defaultIsActive, setDefaultIsActive] = useState(true)
  const [adding, setAdding] = useState(false)
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [lastResults, setLastResults] = useState<BatchLineResult[] | null>(null)
  const [batchSummary, setBatchSummary] = useState<{ ok: number; fail: number } | null>(null)
  const [pendingRetries, setPendingRetries] = useState<PendingLinkRetry[]>([])

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

  useEffect(() => {
    onBatchBusyChange?.(batchProcessing)
  }, [batchProcessing, onBatchBusyChange])

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

  const handleAddFromLibrary = async () => {
    if (!addAssetId) return
    const asset = assetById.get(addAssetId)
    if (!asset || (asset.file_type !== 'image' && asset.file_type !== 'video')) return
    if (existingCombos.has(comboKey(addAssetId, defaultUsageRole))) {
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
        usageRole: defaultUsageRole,
        sortOrder: nextSortOrder(rows),
        isActive: defaultIsActive,
        useInAi: defaultUseInAi,
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

  const runBatchUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    const files = Array.from(fileList)
    if (files.length > CATALOG_MEDIA_MAX_FILES_PER_BATCH) {
      setError(`Selecione no máximo ${CATALOG_MEDIA_MAX_FILES_PER_BATCH} arquivos por vez.`)
      return
    }

    setError(null)
    setLastResults(null)
    setBatchSummary(null)
    setBatchProcessing(true)
    const results: BatchLineResult[] = []
    let ok = 0
    let fail = 0
    let orderCursor = nextSortOrder(rows)
    const retries: PendingLinkRetry[] = []
    const comboSeen = new Set(existingCombos)

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const pre = validateCatalogMediaFile(file)
      if (!pre.ok) {
        results.push({ fileName: file.name, status: 'invalid', detail: pre.message })
        fail++
        continue
      }

      const up = await uploadCatalogMediaToLibrary(file, companyId, sourceType)
      if (!up.ok) {
        results.push({ fileName: file.name, status: 'upload_fail', detail: up.error })
        fail++
        continue
      }

      const ft = file.type.startsWith('video/') ? 'video' : 'image'
      const assetId = String(up.data.id)

      if (comboSeen.has(comboKey(assetId, defaultUsageRole))) {
        results.push({
          fileName: file.name,
          status: 'duplicate',
          detail: 'Mesmo arquivo e função já vinculados.',
        })
        fail++
        continue
      }

      try {
        await catalogMediaApi.addLink({
          companyId,
          productId: sourceType === 'product' ? sourceId : null,
          serviceId: sourceType === 'service' ? sourceId : null,
          libraryAssetId: assetId,
          mediaType: ft,
          usageRole: defaultUsageRole,
          sortOrder: orderCursor,
          isActive: defaultIsActive,
          useInAi: defaultUseInAi,
        })
        orderCursor++
        comboSeen.add(comboKey(assetId, defaultUsageRole))
        results.push({ fileName: file.name, status: 'ok', libraryAssetId: assetId })
        ok++
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao vincular'
        results.push({
          fileName: file.name,
          status: 'link_fail',
          detail: msg,
          libraryAssetId: assetId,
          mediaType: ft,
        })
        retries.push({
          key: `${assetId}-${i}`,
          libraryAssetId: assetId,
          fileName: file.name,
          mediaType: ft,
        })
        fail++
      }
    }

    setLastResults(results)
    setBatchSummary({ ok, fail })
    setPendingRetries(retries)
    setBatchProcessing(false)
    await load()
  }

  const retryPendingLink = async (p: PendingLinkRetry) => {
    setError(null)
    try {
      await catalogMediaApi.addLink({
        companyId,
        productId: sourceType === 'product' ? sourceId : null,
        serviceId: sourceType === 'service' ? sourceId : null,
        libraryAssetId: p.libraryAssetId,
        mediaType: p.mediaType,
        usageRole: defaultUsageRole,
        sortOrder: nextSortOrder(rows),
        isActive: defaultIsActive,
        useInAi: defaultUseInAi,
      })
      setPendingRetries((prev) => prev.filter((x) => x.key !== p.key))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao vincular')
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
        Imagens e vídeos apenas. Limites no catálogo: imagem até 5 MB, vídeo até 20 MB. Até{' '}
        {CATALOG_MEDIA_MAX_FILES_PER_BATCH} arquivos por envio em lote.
      </p>
      {error && <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">{error}</div>}

      <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
        <p className="text-[11px] font-medium text-slate-700">Padrões para novos vínculos</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[140px]">
            <label className="block text-[10px] text-slate-500 mb-0.5">Função</label>
            <select
              className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
              value={defaultUsageRole}
              onChange={(e) => setDefaultUsageRole(e.target.value as CatalogMediaUsageRole)}
              disabled={batchProcessing}
            >
              {CATALOG_MEDIA_USAGE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {usageRoleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={defaultUseInAi}
              onChange={(e) => setDefaultUseInAi(e.target.checked)}
              disabled={batchProcessing}
            />
            Usar na IA
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={defaultIsActive}
              onChange={(e) => setDefaultIsActive(e.target.checked)}
              disabled={batchProcessing}
            />
            Ativo
          </label>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Carregando mídias…</p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-700">Selecionar da biblioteca</p>
            <div className="flex flex-wrap items-end gap-2 rounded border border-dashed border-slate-200 bg-white p-2">
              <div className="min-w-[180px] flex-1">
                <label className="block text-[10px] text-slate-500 mb-0.5">Arquivo</label>
                <select
                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                  value={addAssetId}
                  onChange={(e) => setAddAssetId(e.target.value)}
                  disabled={adding || batchProcessing}
                >
                  <option value="">Selecione…</option>
                  {selectableAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.original_filename} ({a.file_type})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void handleAddFromLibrary()}
                disabled={adding || batchProcessing || !addAssetId}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 text-white text-xs disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Vincular
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-700">Enviar nova mídia</p>
            <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-indigo-200 bg-white p-2">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-slate-300 bg-slate-50 text-xs font-medium cursor-pointer hover:bg-slate-100 disabled:opacity-50">
                <Upload className="w-3.5 h-3.5" />
                Escolher arquivos
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,video/*"
                  multiple
                  disabled={batchProcessing}
                  onChange={(e) => {
                    void runBatchUpload(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              {batchProcessing && (
                <span className="text-xs text-indigo-600">Enviando e vinculando…</span>
              )}
            </div>
          </div>

          {lastResults && lastResults.length > 0 && (
            <div className="rounded border border-slate-200 bg-white p-2 text-[11px] space-y-1">
              <p className="font-medium text-slate-800">
                Resultado do último envio
                {batchSummary && (
                  <span className="text-slate-600 font-normal">
                    {' '}
                    — {batchSummary.ok} ok, {batchSummary.fail} com problema
                  </span>
                )}
              </p>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {lastResults.map((r, i) => (
                  <li key={`${r.fileName}-${i}`} className="flex flex-wrap gap-1 text-slate-700">
                    <span className="truncate max-w-[180px]" title={r.fileName}>
                      {r.fileName}
                    </span>
                    <span
                      className={
                        r.status === 'ok'
                          ? 'text-emerald-700'
                          : r.status === 'duplicate'
                            ? 'text-amber-700'
                            : 'text-red-700'
                      }
                    >
                      {r.status === 'ok' && '✓ vinculado'}
                      {r.status === 'invalid' && `✗ ${r.detail || 'inválido'}`}
                      {r.status === 'upload_fail' && `✗ upload: ${r.detail || ''}`}
                      {r.status === 'link_fail' && `✗ vínculo: ${r.detail || ''}`}
                      {r.status === 'duplicate' && `✗ ${r.detail || 'duplicado'}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingRetries.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50/80 p-2 text-[11px] space-y-2">
              <p className="font-medium text-amber-900">Falha ao vincular — arquivo já está na biblioteca</p>
              <ul className="space-y-1">
                {pendingRetries.map((p) => (
                  <li key={p.key} className="flex flex-wrap items-center gap-2">
                    <span className="truncate max-w-[200px]">{p.fileName}</span>
                    <button
                      type="button"
                      className="text-indigo-600 underline text-xs"
                      onClick={() => void retryPendingLink(p)}
                    >
                      Tentar vincular novamente
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-10 h-10 text-slate-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm text-slate-500">Nenhuma mídia vinculada a este item.</p>
              <p className="text-xs text-slate-400">Envie arquivos ou selecione da biblioteca acima.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-3">
              {rows.map((row) => (
                <CatalogMediaCard
                  key={row.id}
                  row={row}
                  disabled={batchProcessing}
                  onPatch={patchRow}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
