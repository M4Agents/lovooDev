import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Tag, Loader2, AlertCircle } from 'lucide-react'
import { listChatTemplates } from '../../../services/messageTemplatesApi'
import type {
  MessageTemplateChatItem,
  MessageTemplateChatResponse,
} from '../../../types/message-templates'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageTemplatePickerProps {
  conversationId: string
  query: string
  onSelect: (content: string) => void
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function MessageTemplatePicker({
  conversationId,
  query,
  onSelect,
  onClose,
}: MessageTemplatePickerProps) {
  const [data,    setData]    = useState<MessageTemplateChatResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Carregar templates ao montar
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listChatTemplates(conversationId)
      .then(res => { if (!cancelled) { setData(res); setLoading(false) } })
      .catch(e  => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Erro'); setLoading(false) } })
    return () => { cancelled = true }
  }, [conversationId])

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Fechar ao pressionar ESC
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // ---------------------------------------------------------------------------
  // Filtrar por query (nome, conteúdo ou categoria)
  // ---------------------------------------------------------------------------

  const filteredTemplates = useCallback((): MessageTemplateChatItem[] => {
    if (!data) return []
    const q = query.toLowerCase().trim()
    if (!q) return data.templates

    return data.templates.filter(tpl => {
      if (tpl.name.toLowerCase().includes(q)) return true
      if (tpl.content.toLowerCase().includes(q)) return true
      const cat = data.categories.find(c => c.id === tpl.category_id)
      if (cat && cat.name.toLowerCase().includes(q)) return true
      return false
    })
  }, [data, query])

  const templates = filteredTemplates()

  // ---------------------------------------------------------------------------
  // Agrupar por categoria
  // ---------------------------------------------------------------------------

  interface Group {
    catName: string
    catId: string | null
    items: MessageTemplateChatItem[]
  }

  const groups: Group[] = []

  if (data) {
    // Mapear categorias
    const catMap = new Map(data.categories.map(c => [c.id, c.name]))

    // Agrupar templates filtrados
    const byCategory = new Map<string | null, MessageTemplateChatItem[]>()
    for (const tpl of templates) {
      const key = tpl.category_id ?? null
      if (!byCategory.has(key)) byCategory.set(key, [])
      byCategory.get(key)!.push(tpl)
    }

    // Ordem: categorias na ordem original, depois "sem categoria"
    const orderedCatIds = data.categories.map(c => c.id)
    for (const catId of orderedCatIds) {
      const items = byCategory.get(catId)
      if (items && items.length > 0) {
        groups.push({ catId, catName: catMap.get(catId) ?? catId, items })
      }
    }
    const uncategorized = byCategory.get(null)
    if (uncategorized && uncategorized.length > 0) {
      groups.push({ catId: null, catName: 'Sem categoria', items: uncategorized })
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
      style={{ maxHeight: '320px', overflowY: 'auto' }}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500 tracking-wide uppercase">
          Modelos de mensagem
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded"
        >
          ESC
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8 gap-2 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando modelos...
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-red-600">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Vazio */}
      {!loading && !error && templates.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          {query
            ? `Nenhum modelo para "${query}"`
            : 'Nenhum modelo cadastrado. Acesse Configurações > Integrações > Modelos.'}
        </div>
      )}

      {/* Grupos */}
      {!loading && !error && groups.map((group, gi) => (
        <div key={group.catId ?? '__none__'}>
          {/* Separador de categoria */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 ${gi > 0 ? 'border-t border-gray-100' : ''}`}>
            <Tag className="w-3 h-3 text-gray-400" />
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              {group.catName}
            </span>
          </div>

          {/* Templates da categoria */}
          {group.items.map(tpl => (
            <TemplateItem
              key={tpl.id}
              template={tpl}
              query={query}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: item de template
// ---------------------------------------------------------------------------

interface TemplateItemProps {
  template: MessageTemplateChatItem
  query: string
  onSelect: (content: string) => void
}

function TemplateItem({ template, query, onSelect }: TemplateItemProps) {
  const highlight = (text: string) => {
    if (!query.trim()) return text
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-100 text-yellow-800 rounded-sm">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(template.content)}
      className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex flex-col gap-0.5 border-b border-gray-50 last:border-0"
    >
      <span className="text-sm font-medium text-gray-800">{highlight(template.name)}</span>
      <span className="text-xs text-gray-500 line-clamp-2">{highlight(template.content)}</span>
    </button>
  )
}
