// =============================================================================
// MetaMediaAssetSelector — MVP4B.4D.2C
//
// Seletor unificado de assets para HEADER de template Meta (CML + LMU).
//
// Responsabilidades:
//   - Carregar assets via metaWhatsAppApi.getMediaPicker() (CML + LMU unificado)
//   - Filtrar visualmente por MIME e tamanho (UX — não é security boundary)
//   - Pesquisa client-side por filename (dados já carregados)
//   - Selecionar exatamente 1 asset; retornar { picker_id }
//   - Indicador visual de truncagem (>100 assets)
//   - Proteção stale (generation ref + cancelled flag — mesmo padrão do MetaTemplatePicker)
//
// Isolamento:
//   - Zero conhecimento de Graph API, mediaId, phone_number_id, WABA ou token Meta
//   - NÃO retorna s3_key, source, source_id nem qualquer internal ao caller
//   - preview_url usada somente para display (com fallback onError)
//   - Backend valida MIME, tamanho e tenant — filtro frontend é UX only
//   - Diferença CML vs LMU é transparente ao usuário (sem label técnico exposto)
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { metaWhatsAppApi }        from '../../../services/metaWhatsAppApi'
import type { MetaMediaPickerItem } from '../../../types/meta-whatsapp'

// ── Tipos públicos ──────────────────────────────────────────────────────────────

export type MediaAssetFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT'

export interface MetaMediaAssetSelectorProps {
  companyId:        string
  mediaFormat:      MediaAssetFormat
  selectedPickerId?: string | null
  onSelect:         (asset: { picker_id: string }) => void
  disabled?:        boolean
}

// ── Tipos locais ────────────────────────────────────────────────────────────────

interface AssetItem {
  picker_id:         string
  original_filename: string
  mime_type:         string
  file_size:         number
  preview_url:       string | null
}

type LoadState = 'idle' | 'loading' | 'error'

// ── Constantes ──────────────────────────────────────────────────────────────────

// Filtro MIME — UX apenas; backend é autoridade final de MIME e tamanho.
const FORMAT_MIME_WHITELIST: Record<MediaAssetFormat, string[]> = {
  IMAGE:    ['image/jpeg', 'image/png'],
  VIDEO:    ['video/mp4',  'video/3gpp'],
  DOCUMENT: ['application/pdf'],
}

const FORMAT_SIZE_LIMIT: Record<MediaAssetFormat, number> = {
  IMAGE:    5  * 1024 * 1024,  //  5 MB
  VIDEO:    16 * 1024 * 1024,  // 16 MB
  DOCUMENT: 30 * 1024 * 1024,  // 30 MB
}

const FORMAT_LABEL: Record<MediaAssetFormat, string> = {
  IMAGE: 'Imagem', VIDEO: 'Vídeo', DOCUMENT: 'Documento',
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function mapItem(i: MetaMediaPickerItem): AssetItem {
  return {
    picker_id:         i.picker_id,
    original_filename: i.filename,
    mime_type:         i.mime_type,
    file_size:         i.file_size,
    preview_url:       i.preview_url,
  }
}

// ── Componente ───────────────────────────────────────────────────────────────────

export function MetaMediaAssetSelector({
  companyId,
  mediaFormat,
  selectedPickerId,
  onSelect,
  disabled = false,
}: MetaMediaAssetSelectorProps) {
  const [allItems,   setAllItems]   = useState<AssetItem[]>([])
  const [truncated,  setTruncated]  = useState(false)
  const [loadState,  setLoadState]  = useState<LoadState>('idle')
  const [loadError,  setLoadError]  = useState<string | null>(null)
  const [search,     setSearch]     = useState('')

  const loadGenRef = useRef(0)

  // ── Carga inicial e ao trocar companyId / mediaFormat ───────────────────────
  useEffect(() => {
    loadGenRef.current += 1
    const gen       = loadGenRef.current
    let cancelled   = false

    setAllItems([])
    setTruncated(false)
    setSearch('')
    setLoadError(null)
    setLoadState('loading')

    async function doLoad() {
      try {
        const result = await metaWhatsAppApi.getMediaPicker(companyId, mediaFormat)
        if (cancelled || loadGenRef.current !== gen) return

        setAllItems(result.items.map(mapItem))
        setTruncated(result.truncated)
        setLoadState('idle')
      } catch (err: unknown) {
        if (cancelled || loadGenRef.current !== gen) return
        setLoadError(err instanceof Error ? err.message : 'Erro ao carregar mídias')
        setLoadState('error')
      }
    }

    doLoad()
    return () => { cancelled = true }
  }, [companyId, mediaFormat])

  // ── Retry ───────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(async () => {
    loadGenRef.current += 1
    const gen     = loadGenRef.current
    let cancelled = false

    setAllItems([])
    setTruncated(false)
    setLoadError(null)
    setLoadState('loading')

    try {
      const result = await metaWhatsAppApi.getMediaPicker(companyId, mediaFormat)
      if (cancelled || loadGenRef.current !== gen) return
      setAllItems(result.items.map(mapItem))
      setTruncated(result.truncated)
      setLoadState('idle')
    } catch (err: unknown) {
      if (cancelled || loadGenRef.current !== gen) return
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar mídias')
      setLoadState('error')
    }
    return () => { cancelled = true }
  }, [companyId, mediaFormat])

  // ── Pesquisa client-side ─────────────────────────────────────────────────────
  // Sem debounce — dados já em memória, filtro é instantâneo.
  const displayItems = search.trim()
    ? allItems.filter(f =>
        f.original_filename.toLowerCase().includes(search.toLowerCase()),
      )
    : allItems

  // ── Render ───────────────────────────────────────────────────────────────────

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
        onChange={e => setSearch(e.target.value)}
        disabled={disabled}
        aria-label="Buscar mídia"
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
      />

      {/* Loading */}
      {loadState === 'loading' && (
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
      {loadState === 'idle' && displayItems.length === 0 && (
        <p className="text-xs text-slate-500 text-center py-3" data-testid="mas-empty">
          Nenhuma mídia compatível encontrada.
        </p>
      )}

      {/* Lista de assets */}
      {displayItems.length > 0 && (
        <div className="space-y-1.5 max-h-52 overflow-y-auto" data-testid="mas-list">
          {displayItems.map(file => {
            const mimeOk      = FORMAT_MIME_WHITELIST[mediaFormat].includes(file.mime_type)
            const tooBig      = file.file_size > FORMAT_SIZE_LIMIT[mediaFormat]
            const isSelectable = mimeOk && !tooBig && !disabled
            const isSelected   = selectedPickerId === file.picker_id

            return (
              <button
                key={file.picker_id}
                type="button"
                onClick={() => { if (isSelectable) onSelect({ picker_id: file.picker_id }) }}
                disabled={!isSelectable}
                data-testid={`mas-asset-${file.picker_id}`}
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

      {/* Aviso de truncagem */}
      {truncated && loadState === 'idle' && (
        <p
          className="text-xs text-slate-400 text-center pt-2"
          data-testid="mas-truncated-notice"
        >
          Exibindo os 100 assets mais recentes.
        </p>
      )}
    </div>
  )
}
