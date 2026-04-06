/**
 * Card visual para cada mídia vinculada a um item do catálogo.
 * Renderiza preview, informações e controles de edição inline.
 */

import { useState } from 'react'
import { Image as ImageIcon, Loader2, Play, Trash2, Video } from 'lucide-react'
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

// ── MediaPreview ──────────────────────────────────────────────────────────────

type MediaPreviewProps = {
  mediaType: 'image' | 'video'
  previewUrl: string | null
  filename: string
}

function MediaPreview({ mediaType, previewUrl, filename }: MediaPreviewProps) {
  const [imgError, setImgError] = useState(false)

  if (mediaType === 'image' && previewUrl && !imgError) {
    return (
      <img
        src={previewUrl}
        alt={filename}
        loading="lazy"
        className="w-full h-full object-cover"
        onError={() => setImgError(true)}
      />
    )
  }

  if (mediaType === 'video' && previewUrl) {
    return (
      <div className="relative w-full h-full">
        <video
          src={previewUrl}
          className="w-full h-full object-cover"
          preload="metadata"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-md">
            <Play className="w-5 h-5 text-slate-800 ml-0.5" fill="currentColor" />
          </div>
        </div>
      </div>
    )
  }

  const Icon = mediaType === 'video' ? Video : ImageIcon
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-50">
      <Icon className="w-10 h-10 text-slate-300" />
      <span className="text-[11px] text-slate-400 px-2 text-center line-clamp-2">{filename}</span>
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
      {/* ── Área de preview ─────────────────────────────────────── */}
      <div className="relative aspect-[4/5]">
        <MediaPreview
          mediaType={row.media_type}
          previewUrl={row.preview_url}
          filename={row.original_filename}
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
          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full bg-white/85 text-slate-500 hover:bg-red-50 hover:text-red-600 shadow-sm transition-colors disabled:opacity-40"
        >
          {removing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Overlay de patch em andamento */}
        {patching && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center backdrop-blur-[1px]">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
        )}
      </div>

      {/* ── Informações + controles ──────────────────────────────── */}
      <div className="p-3 space-y-3">
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

        {/* Controles */}
        <div className="space-y-2">
          {/* Função (usage_role) */}
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
              Função
            </label>
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
          </div>

          {/* Toggles + Ordem */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={row.use_in_ai}
                disabled={busy}
                onChange={(e) => void patch({ use_in_ai: e.target.checked })}
              />
              IA
            </label>

            <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={row.is_active}
                disabled={busy}
                onChange={(e) => void patch({ is_active: e.target.checked })}
              />
              Ativo
            </label>

            {/* Ordem */}
            <div className="flex items-center gap-1 ml-auto">
              <label className="text-[11px] font-medium text-slate-600">Ord.</label>
              <input
                type="number"
                key={`ord-${row.id}-${row.sort_order}`}
                defaultValue={row.sort_order}
                disabled={busy}
                className="w-12 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
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
    </div>
  )
}
