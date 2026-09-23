// =============================================================================
// MetaMediaAssetSelector — MVP4B
//
// Seletor de asset da company_media_library para templates Meta com HEADER media.
//
// Responsabilidades:
//   - Listar assets via mediaLibraryApi.getCompanyFiles() (Bearer auth)
//   - Filtrar por file_type compatível com mediaFormat
//   - Filtrar visualmente por MIME e tamanho (UX — não é security boundary)
//   - Selecionar exatamente 1 asset; retornar { id }
//   - Search com debounce ~350ms
//   - Paginação "Carregar mais" (limit=50)
//   - Proteção stale (generation ref + cancelled flag — mesmo padrão do MetaTemplatePicker)
//
// Isolamento:
//   - Zero conhecimento de Graph API, mediaId, phone_number_id, WABA ou token Meta
//   - NÃO retorna s3_key, mime_type, filename nem preview_url como payload de envio
//   - preview_url usada somente para display interno (thumbnail)
//   - Backend validateMediaAsset continua autoridade final de MIME, tamanho e tenant
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase }        from '../../../lib/supabase'
import { mediaLibraryApi } from '../../../services/mediaLibraryApi'
import type { MediaFile }  from '../../../services/mediaLibraryApi'

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export type MediaAssetFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT'

export interface MetaMediaAssetSelectorProps {
  companyId:        string
  mediaFormat:      MediaAssetFormat
  selectedAssetId?: string | null
  onSelect:         (asset: { id: string }) => void
  disabled?:        boolean
}

// ── Tipos locais ──────────────────────────────────────────────────────────────

interface AssetItem {
  id:                string
  original_filename: string
  mime_type:         string
  file_size:         number
  preview_url:       string | null
}

type LoadState = 'idle' | 'loading' | 'error'

// ── Constantes ────────────────────────────────────────────────────────────────

const FORMAT_TO_FILE_TYPE: Record<MediaAssetFormat, 'image' | 'video' | 'document'> = {
  IMAGE:    'image',
  VIDEO:    'video',
  DOCUMENT: 'document',
}

// Filtro MIME — UX apenas; backend é autoridade final.
const FORMAT_MIME_WHITELIST: Record<MediaAssetFormat, string[]> = {
  IMAGE:    ['image/jpeg', 'image/png'],
  VIDEO:    ['video/mp4',  'video/3gpp'],
  DOCUMENT: ['application/pdf'],
}

// Limites de tamanho — UX apenas; backend é autoridade final.
const FORMAT_SIZE_LIMIT: Record<MediaAssetFormat, number> = {
  IMAGE:    5  * 1024 * 1024,  //  5 MB
  VIDEO:    16 * 1024 * 1024,  // 16 MB
  DOCUMENT: 30 * 1024 * 1024,  // 30 MB
}

const LIMIT         = 50
const DEBOUNCE_MS   = 350
const FORMAT_LABEL: Record<MediaAssetFormat, string> = {
  IMAGE: 'Imagem', VIDEO: 'Vídeo', DOCUMENT: 'Documento',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function mapFile(f: MediaFile): AssetItem {
  return {
    id:                f.id,
    original_filename: f.original_filename,
    mime_type:         f.mime_type,
    file_size:         f.file_size,
    preview_url:       f.preview_url ?? null,
  }
}

// ── Componente ────────────────────────────────────────────────────────────────

export function MetaMediaAssetSelector({
  companyId,
  mediaFormat,
  selectedAssetId,
  onSelect,
  disabled = false,
}: MetaMediaAssetSelectorProps) {
  const [files,       setFiles]       = useState<AssetItem[]>([])
  const [loadState,   setLoadState]   = useState<LoadState>('idle')
  const [loadError,   setLoadError]   = useState<string | null>(null)
  const [page,        setPage]        = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [totalCount,  setTotalCount]  = useState(0)
  const [search,      setSearch]      = useState('')

  const loadGenRef      = useRef(0)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Carga inicial e ao trocar companyId / mediaFormat ─────────────────────
  // Mesmo padrão do MetaTemplatePicker: generation ref + cancelled flag.

  useEffect(() => {
    loadGenRef.current += 1
    const gen = loadGenRef.current
    let cancelled = false

    setFiles([])
    setPage(1)
    setHasNextPage(false)
    setTotalCount(0)
    setSearch('')
    setLoadError(null)
    setLoadState('loading')

    async function doLoad() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled || loadGenRef.current !== gen) return
        if (!session?.access_token) throw new Error('Sessão expirada')

        const result = await mediaLibraryApi.getCompanyFiles(
          companyId,
          session.access_token,
          { fileType: FORMAT_TO_FILE_TYPE[mediaFormat], page: 1, limit: LIMIT, search: '' },
        )
        if (cancelled || loadGenRef.current !== gen) return

        setFiles(result.files.map(mapFile))
        setHasNextPage(result.pagination.hasNextPage)
        setTotalCount(result.pagination.totalCount)
        setLoadState('idle')
      } catch (err: unknown) {
        if (cancelled || loadGenRef.current !== gen) return
        setLoadError(err instanceof Error ? err.message : 'Erro ao carregar arquivos')
        setLoadState('error')
      }
    }

    doLoad()
    return () => { cancelled = true }
  }, [companyId, mediaFormat]) // eslint-disable-line react-hooks/exhaustive-deps

  // Limpar debounce ao desmontar
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [])

  // ── Search com debounce ───────────────────────────────────────────────────

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      loadGenRef.current += 1
      const gen = loadGenRef.current
      setFiles([])
      setPage(1)
      setHasNextPage(false)
      setLoadError(null)
      setLoadState('loading')

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (loadGenRef.current !== gen) return
        if (!session?.access_token) throw new Error('Sessão expirada')

        const result = await mediaLibraryApi.getCompanyFiles(
          companyId,
          session.access_token,
          { fileType: FORMAT_TO_FILE_TYPE[mediaFormat], page: 1, limit: LIMIT, search: value },
        )
        if (loadGenRef.current !== gen) return

        setFiles(result.files.map(mapFile))
        setHasNextPage(result.pagination.hasNextPage)
        setTotalCount(result.pagination.totalCount)
        setLoadState('idle')
      } catch (err: unknown) {
        if (loadGenRef.current !== gen) return
        setLoadError(err instanceof Error ? err.message : 'Erro ao carregar arquivos')
        setLoadState('error')
      }
    }, DEBOUNCE_MS)
  }, [companyId, mediaFormat])

  // ── Carregar mais ─────────────────────────────────────────────────────────

  const handleLoadMore = useCallback(async () => {
    const nextPage = page + 1
    const gen      = loadGenRef.current
    setPage(nextPage)
    setLoadState('loading')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (loadGenRef.current !== gen) return
      if (!session?.access_token) throw new Error('Sessão expirada')

      const result = await mediaLibraryApi.getCompanyFiles(
        companyId,
        session.access_token,
        { fileType: FORMAT_TO_FILE_TYPE[mediaFormat], page: nextPage, limit: LIMIT, search },
      )
      if (loadGenRef.current !== gen) return

      setFiles(prev => [...prev, ...result.files.map(mapFile)])
      setHasNextPage(result.pagination.hasNextPage)
      setTotalCount(result.pagination.totalCount)
      setLoadState('idle')
    } catch (err: unknown) {
      if (loadGenRef.current !== gen) return
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar arquivos')
      setLoadState('error')
    }
  }, [companyId, mediaFormat, page, search])

  // ── Retry ─────────────────────────────────────────────────────────────────

  const handleRetry = useCallback(async () => {
    loadGenRef.current += 1
    const gen = loadGenRef.current
    setFiles([])
    setPage(1)
    setHasNextPage(false)
    setLoadError(null)
    setLoadState('loading')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (loadGenRef.current !== gen) return
      if (!session?.access_token) throw new Error('Sessão expirada')

      const result = await mediaLibraryApi.getCompanyFiles(
        companyId,
        session.access_token,
        { fileType: FORMAT_TO_FILE_TYPE[mediaFormat], page: 1, limit: LIMIT, search },
      )
      if (loadGenRef.current !== gen) return

      setFiles(result.files.map(mapFile))
      setHasNextPage(result.pagination.hasNextPage)
      setTotalCount(result.pagination.totalCount)
      setLoadState('idle')
    } catch (err: unknown) {
      if (loadGenRef.current !== gen) return
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar arquivos')
      setLoadState('error')
    }
  }, [companyId, mediaFormat, search])

  // ── Render ────────────────────────────────────────────────────────────────

  const label = FORMAT_LABEL[mediaFormat]

  return (
    <div className="px-4 py-3 border-t border-slate-100" data-testid="media-asset-selector">
      <p className="text-xs font-medium text-slate-600 uppercase tracking-wide mb-2">
        Mídia — {label}
      </p>

      {/* Campo de busca */}
      <input
        type="text"
        placeholder={`Buscar ${label.toLowerCase()}...`}
        value={search}
        onChange={e => handleSearchChange(e.target.value)}
        disabled={disabled}
        aria-label="Buscar mídia"
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
      />

      {/* Loading (primeiro carregamento) */}
      {loadState === 'loading' && files.length === 0 && (
        <div className="flex items-center justify-center py-4">
          <div
            className="animate-spin h-5 w-5 rounded-full border-2 border-blue-500 border-t-transparent"
            aria-label="Carregando mídias"
            data-testid="mas-loading"
          />
        </div>
      )}

      {/* Erro */}
      {loadState === 'error' && (
        <div className="py-3 text-center">
          <p className="text-xs text-red-600 mb-2" role="alert" data-testid="mas-error">
            {loadError ?? 'Erro ao carregar mídias.'}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Empty */}
      {loadState === 'idle' && files.length === 0 && (
        <p className="text-xs text-slate-500 text-center py-3" data-testid="mas-empty">
          Nenhuma mídia compatível encontrada.
        </p>
      )}

      {/* Lista de assets */}
      {files.length > 0 && (
        <div className="space-y-1.5 max-h-52 overflow-y-auto" data-testid="mas-list">
          {files.map(file => {
            const mimeOk      = FORMAT_MIME_WHITELIST[mediaFormat].includes(file.mime_type)
            const tooBig      = file.file_size > FORMAT_SIZE_LIMIT[mediaFormat]
            const isSelectable = mimeOk && !tooBig && !disabled
            const isSelected   = selectedAssetId === file.id

            return (
              <button
                key={file.id}
                type="button"
                onClick={() => { if (isSelectable) onSelect({ id: file.id }) }}
                disabled={!isSelectable}
                data-testid={`mas-asset-${file.id}`}
                aria-pressed={isSelected}
                title={
                  tooBig
                    ? `Arquivo muito grande (${formatFileSize(file.file_size)} — limite: ${formatFileSize(FORMAT_SIZE_LIMIT[mediaFormat])})`
                    : !mimeOk
                      ? `Formato incompatível (${file.mime_type})`
                      : file.original_filename
                }
                className={`w-full flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400'
                    : isSelectable
                      ? 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      : 'border-slate-100 opacity-40 cursor-not-allowed'
                }`}
              >
                {/* Thumbnail */}
                <div className="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-slate-100 flex items-center justify-center">
                  {mediaFormat === 'IMAGE' && file.preview_url ? (
                    <img
                      src={file.preview_url}
                      alt={file.original_filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      data-testid="mas-image-preview"
                    />
                  ) : mediaFormat === 'VIDEO' && file.preview_url ? (
                    <video
                      src={file.preview_url}
                      className="w-full h-full object-cover"
                      preload="metadata"
                      muted
                      data-testid="mas-video-preview"
                    />
                  ) : (
                    <span
                      role="img"
                      aria-label={label}
                      className="text-lg"
                      data-testid="mas-doc-icon"
                    >
                      {mediaFormat === 'IMAGE' ? '🖼️' : mediaFormat === 'VIDEO' ? '🎥' : '📄'}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-slate-700 font-medium">{file.original_filename}</p>
                  <p className="text-slate-400 flex items-center gap-1">
                    {formatFileSize(file.file_size)}
                    {tooBig && (
                      <span className="text-red-500">(excede limite)</span>
                    )}
                    {!mimeOk && !tooBig && (
                      <span className="text-amber-500">(formato incompatível)</span>
                    )}
                  </p>
                </div>

                {/* Check de seleção */}
                {isSelected && (
                  <span className="flex-shrink-0 text-blue-500 font-bold" aria-hidden>✓</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Carregar mais */}
      {hasNextPage && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadState === 'loading' || disabled}
          className="w-full mt-2 text-xs text-slate-500 hover:text-slate-700 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
          data-testid="mas-load-more"
        >
          {loadState === 'loading'
            ? 'Carregando...'
            : `Carregar mais (${totalCount - files.length} restantes)`
          }
        </button>
      )}
    </div>
  )
}
