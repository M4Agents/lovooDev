/**
 * Card compacto com thumbnail para cada mídia vinculada a um item do catálogo.
 * Layout horizontal: miniatura à esquerda, informações e controles à direita.
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

// ── Thumbnail ─────────────────────────────────────────────────────────────────

type ThumbnailProps = {
  mediaType: 'image' | 'video'
  previewUrl: string | null
  filename: string
}

function Thumbnail({ mediaType, previewUrl, filename }: ThumbnailProps) {
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <Play className="w-4 h-4 text-white drop-shadow" fill="white" />
        </div>
      </div>
    )
  }

  const Icon = mediaType === 'video' ? Video : ImageIcon
  return (
    <div className="w-full h-full flex items-center justify-center bg-slate-100">
      <Icon className="w-6 h-6 text-slate-300" />
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
        'relative flex items-start gap-3 p-3',
        'bg-white rounded-xl border border-slate-200',
        'transition-shadow hover:shadow-md',
        !row.is_active ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ── Thumbnail ───────────────────────────────────────────── */}
      <div className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden border border-slate-100">
        <Thumbnail
          mediaType={row.media_type}
          previewUrl={row.preview_url}
          filename={row.original_filename}
        />

        {/* Overlay de patching sobre a thumb */}
        {patching && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          </div>
        )}
      </div>

      {/* ── Informações + controles ──────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Nome, tipo e badge inativo */}
        <div className="flex items-start justify-between gap-2 pr-6">
          <div className="min-w-0">
            <p
              className="text-sm font-medium text-slate-900 truncate leading-tight"
              title={row.original_filename}
            >
              {row.original_filename}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {row.media_type === 'video' ? 'Vídeo' : 'Imagem'}
              {!row.is_active && (
                <span className="ml-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                  Inativo
                </span>
              )}
            </p>
          </div>
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
        <div className="flex items-center gap-3 flex-wrap">
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

      {/* ── Botão remover (canto superior direito do card) ───────── */}
      <button
        type="button"
        title="Remover vínculo"
        disabled={busy}
        onClick={() => void remove()}
        className="absolute top-2.5 right-2.5 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40"
      >
        {removing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  )
}
