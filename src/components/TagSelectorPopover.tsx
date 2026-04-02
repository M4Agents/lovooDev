import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Tag as TagIcon } from 'lucide-react'
import { TagBadge } from './TagBadge'
import { useLeadTags } from '../hooks/useLeadTags'
import { useAvailableTags } from '../hooks/useAvailableTags'
import type { Tag } from '../types/tags'

interface TagSelectorPopoverProps {
  leadId: number
  companyId: string
  /** Elemento âncora: o popover se posiciona abaixo dele via createPortal. */
  anchorRef: React.RefObject<HTMLButtonElement>
  /** Chamado com os nomes atualizados apenas se houver mudança real. */
  onTagsChanged: (names: string[]) => void
  onClose: () => void
}

export const TagSelectorPopover: React.FC<TagSelectorPopoverProps> = ({
  leadId,
  companyId,
  anchorRef,
  onTagsChanged,
  onClose
}) => {
  const { tags: leadTags, loading: loadingLead, error, load, addTag, removeTag } = useLeadTags()
  const { tags: availableTags, loading: loadingAvailable } = useAvailableTags(companyId)
  const [searchTerm, setSearchTerm] = useState('')
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Snapshot das tag IDs ao abrir o popover (para comparação ao fechar)
  const initialTagIdsRef = useRef<string[] | null>(null)
  // Referência sempre atualizada para leadTags (evita stale closure nos handlers)
  const leadTagsRef = useRef<Tag[]>(leadTags)
  leadTagsRef.current = leadTags

  // Carregar tags do lead ao montar
  useEffect(() => {
    load(leadId)
  }, [leadId, load])

  // Armazenar snapshot inicial após primeira carga
  useEffect(() => {
    if (initialTagIdsRef.current === null && !loadingLead) {
      initialTagIdsRef.current = leadTags.map(t => t.id)
    }
  }, [leadTags, loadingLead])

  // Calcular posição do popover abaixo do botão âncora
  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setCoords({
      top: rect.bottom + 4,
      left: Math.max(4, rect.left)
    })
  }, [anchorRef])

  // Fechar e chamar onTagsChanged apenas se houve mudança real
  const handleClose = useCallback(() => {
    const currentIds = [...leadTagsRef.current].map(t => t.id).sort().join(',')
    const initialIds = [...(initialTagIdsRef.current ?? [])].sort().join(',')
    if (currentIds !== initialIds) {
      onTagsChanged(leadTagsRef.current.map(t => t.name))
    }
    onClose()
  }, [onTagsChanged, onClose])

  // Click fora fecha o popover
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        handleClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [handleClose, anchorRef])

  // Fechar com Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  const assignedIds = new Set(leadTags.map(t => t.id))

  const filteredAvailable = availableTags.filter(t =>
    !assignedIds.has(t.id) &&
    (searchTerm === '' || t.name.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const handleAdd = async (tag: Tag) => {
    await addTag(leadId, tag)
    setSearchTerm('')
  }

  const handleRemove = async (tagId: string) => {
    await removeTag(leadId, tagId)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredAvailable.length === 1) {
      handleAdd(filteredAvailable[0])
    }
  }

  if (!coords) return null

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        zIndex: 9999,
        width: '280px'
      }}
      className="bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
          <TagIcon className="w-3.5 h-3.5" />
          Tags
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600"
          aria-label="Fechar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tags atribuídas */}
      <div className="px-3 pt-2.5 pb-1.5">
        {loadingLead ? (
          <p className="text-xs text-gray-400 italic">Carregando...</p>
        ) : leadTags.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Nenhuma tag atribuída</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {leadTags.map(tag => (
              <TagBadge
                key={tag.id}
                tag={tag}
                size="sm"
                removable
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>

      {/* Erro inline */}
      {error && (
        <p className="px-3 py-1 text-xs text-red-500">{error}</p>
      )}

      {/* Input de busca */}
      <div className="px-3 pb-2 pt-1">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border border-gray-200 rounded-md bg-white focus-within:ring-1 focus-within:ring-blue-400 focus-within:border-blue-400">
          <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Buscar tag..."
            className="flex-1 text-xs outline-none bg-transparent"
            autoFocus
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="text-gray-300 hover:text-gray-500"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Lista de tags disponíveis */}
      <div className="max-h-48 overflow-y-auto border-t border-gray-100">
        {loadingAvailable ? (
          <p className="px-3 py-3 text-xs text-gray-400 text-center">Carregando tags...</p>
        ) : filteredAvailable.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400 text-center">
            {searchTerm ? 'Nenhuma tag encontrada' : 'Todas as tags já foram atribuídas'}
          </p>
        ) : (
          filteredAvailable.map(tag => (
            <button
              key={tag.id}
              type="button"
              onClick={() => handleAdd(tag)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
            >
              <TagBadge tag={tag} size="sm" />
              {tag.description && (
                <span className="text-xs text-gray-400 truncate">{tag.description}</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body
  )
}
