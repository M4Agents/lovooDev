/**
 * Card com thumbnail compacta (topo) e informações/controles abaixo.
 * Altura da thumbnail fixa para uniformidade no grid.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, Loader2, Play, Trash2, Video, X } from 'lucide-react'
import {
  CATALOG_MEDIA_USAGE_ROLES,
  type CatalogItemMediaResolved,
  type CatalogMediaUsageRole,
} from '../../services/catalogMediaApi'

// ── usageRoleLabel ────────────────────────────────────────────────────────────

export function usageRoleLabel(role: CatalogMediaUsageRole): string {
  const map: Record<CatalogMediaUsageRole, string> = {
    presentation: 'Apresentação',
    demo: 'Demonstração',
    proof: 'Prova / resultado',
    testimonial: 'Depoimento',
    before_after: 'Antes e depois',
  }
  return map[role] ?? role
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────

/** Extrai URL de thumbnail estática dos campos livres do metadata. */
function resolveVideoThumbnail(metadata: Record<string, unknown>): string | null {
  for (const key of ['thumbnail_url', 'poster_url', 'thumbnail', 'poster']) {
    const val = metadata[key]
    if (typeof val === 'string' && val.length > 0) return val
  }
  return null
}

// ── VideoLightbox ──────────────────────────────────────────────────────────────

type VideoLightboxProps = {
  src: string
  filename: string
  open: boolean
  onClose: () => void
}

function VideoLightbox({ src, filename, open, onClose }: VideoLightboxProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!open && videoRef.current) {
      videoRef.current.pause()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-3xl w-full bg-black rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-sm text-white/80 truncate pr-4">{filename}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Player */}
        <video
          ref={videoRef}
          src={src}
          controls
          autoPlay
          className="w-full max-h-[70vh] bg-black"
        />
      </div>
    </div>,
    document.body,
  )
}

// ── PlayOverlay ────────────────────────────────────────────────────────────────

const PlayOverlay = ({ onClick }: { onClick?: () => void }) => (
  <div
    className={[
      'absolute inset-0 flex items-center justify-center bg-black/30',
      onClick ? 'cursor-pointer' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    onClick={onClick}
  >
    <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow">
      <Play className="w-4 h-4 text-slate-800 ml-0.5" fill="currentColor" />
    </div>
  </div>
)

type ThumbnailProps = {
  mediaType: 'image' | 'video'
  previewUrl: string | null
  filename: string
  metadata: Record<string, unknown>
  onPlayClick?: () => void
}

function Thumbnail({ mediaType, previewUrl, filename, metadata, onPlayClick }: ThumbnailProps) {
  const [imgError, setImgError] = useState(false)
  const [thumbError, setThumbError] = useState(false)

  // ── Imagem ──────────────────────────────────────────────────────
  if (mediaType === 'image' && previewUrl && !imgError) {
    return (
      <img
        src={previewUrl}
        alt={filename}
        loading="lazy"
        className="w-full h-full object-contain"
        onError={() => setImgError(true)}
      />
    )
  }

  // ── Vídeo ───────────────────────────────────────────────────────
  if (mediaType === 'video') {
    // 1ª prioridade: thumbnail estática em metadata (imagem, sem carregar o vídeo)
    const staticThumb = !thumbError ? resolveVideoThumbnail(metadata) : null
    if (staticThumb) {
      return (
        <div className="relative w-full h-full">
          <img
            src={staticThumb}
            alt={filename}
            loading="lazy"
            className="w-full h-full object-contain"
            onError={() => setThumbError(true)}
          />
          <PlayOverlay onClick={onPlayClick} />
        </div>
      )
    }

    // 2ª prioridade: elemento <video> — browser renderiza o primeiro frame
    if (previewUrl) {
      return (
        <div className="relative w-full h-full">
          <video
            src={previewUrl}
            className="w-full h-full object-contain bg-slate-900/5"
            preload="metadata"
          />
          <PlayOverlay onClick={onPlayClick} />
        </div>
      )
    }
  }

  // ── Fallback ────────────────────────────────────────────────────
  const Icon = mediaType === 'video' ? Video : ImageIcon
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-slate-50">
      <Icon className="w-8 h-8 text-slate-300" />
      <span className="text-[10px] text-slate-400 px-2 text-center line-clamp-1">{filename}</span>
    </div>
  )
}

// ── CatalogMediaCard ──────────────────────────────────────────────────────────

type PatchPayload = Partial<{
  usage_role: CatalogMediaUsageRole
  sort_order: number
  is_active: boolean
  use_in_ai: boolean
}>

type CatalogMediaCardProps = {
  row: CatalogItemMediaResolved
  /** Quando true bloqueia todos os controles (ex: batch em andamento) */
  disabled?: boolean
  onPatch: (id: string, patch: PatchPayload) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

export function CatalogMediaCard({
  row,
  disabled = false,
  onPatch,
  onRemove,
}: CatalogMediaCardProps) {
  const [patching, setPatching] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const busy = disabled || patching || removing

  const patch = async (payload: PatchPayload) => {
    setPatching(true)
    try {
      await onPatch(row.id, payload)
    } finally {
      setPatching(false)
    }
  }

  const remove = async () => {
    setRemoving(true)
    try {
      await onRemove(row.id)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div
      className={[
        'bg-white rounded-xl border border-slate-200 overflow-hidden',
        'transition-shadow hover:shadow-md',
        !row.is_active ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ── Thumbnail (altura fixa, proporcional ao card) ─────── */}
      <div className="relative h-28 w-full bg-slate-50">
        <Thumbnail
          mediaType={row.media_type}
          previewUrl={row.preview_url}
          filename={row.original_filename}
          metadata={row.metadata}
          onPlayClick={
            row.media_type === 'video' && row.preview_url
              ? () => setLightboxOpen(true)
              : undefined
          }
        />

        {/* Badge inativo */}
        {!row.is_active && (
          <span className="absolute top-2 left-2 text-[10px] font-semibold tracking-wide bg-slate-700/75 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
            Inativo
          </span>
        )}

        {/* Botão remover */}
        <button
          type="button"
          title="Remover vínculo"
          disabled={busy}
          onClick={() => void remove()}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-white/85 text-slate-500 hover:bg-red-50 hover:text-red-600 shadow-sm transition-colors disabled:opacity-40"
        >
          {removing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Trash2 className="w-3 h-3" />
          )}
        </button>

        {/* Overlay de patching */}
        {patching && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center backdrop-blur-[1px]">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          </div>
        )}
      </div>

      {/* ── Lightbox de vídeo ────────────────────────────────────── */}
      {row.media_type === 'video' && row.preview_url && (
        <VideoLightbox
          src={row.preview_url}
          filename={row.original_filename}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {/* ── Informações + controles ──────────────────────────────── */}
      <div className="p-2.5 space-y-2">
        {/* Nome e tipo */}
        <div>
          <p
            className="text-sm font-medium text-slate-900 truncate leading-tight"
            title={row.original_filename}
          >
            {row.original_filename}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {row.media_type === 'video' ? 'Vídeo' : 'Imagem'}
          </p>
        </div>

        {/* Função */}
        <select
          className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
          value={row.usage_role}
          disabled={busy}
          onChange={(e) =>
            void patch({ usage_role: e.target.value as CatalogMediaUsageRole })
          }
        >
          {CATALOG_MEDIA_USAGE_ROLES.map((r) => (
            <option key={r} value={r}>
              {usageRoleLabel(r)}
            </option>
          ))}
        </select>

        {/* Toggles + Ordem */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={row.use_in_ai}
              disabled={busy}
              onChange={(e) => void patch({ use_in_ai: e.target.checked })}
            />
            IA
          </label>

          <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={row.is_active}
              disabled={busy}
              onChange={(e) => void patch({ is_active: e.target.checked })}
            />
            Ativo
          </label>

          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[11px] font-medium text-slate-600">Ord.</span>
            <input
              type="number"
              key={`ord-${row.id}-${row.sort_order}`}
              defaultValue={row.sort_order}
              disabled={busy}
              className="w-10 border border-slate-200 rounded-lg px-1 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
              onBlur={(e) => {
                const v = Number.parseInt(e.target.value, 10)
                if (Number.isFinite(v) && v !== row.sort_order) {
                  void patch({ sort_order: v })
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
