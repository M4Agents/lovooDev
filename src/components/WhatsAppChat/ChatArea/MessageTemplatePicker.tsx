import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Tag, Loader2, AlertCircle } from 'lucide-react'
import { listChatTemplates } from '../../../services/messageTemplatesApi'
import type {
  MessageTemplateChatItem,
  MessageTemplateChatResponse,
} from '../../../types/message-templates'

// ---------------------------------------------------------------------------
// Constante: máximo de templates renderizados (performance)
// ---------------------------------------------------------------------------

const MAX_ITEMS = 50

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageTemplatePickerProps {
  conversationId: string
  query: string
  /** Chamado com o conteúdo do template selecionado. */
  onSelect: (payload: TemplateSelectPayload) => void
  onClose: () => void
}

export interface TemplateSelectPayload {
  content: string
  /** S3 key da mídia — null se template sem mídia. */
  media_path?: string | null
  media_type?: string | null
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
  const [data,        setData]        = useState<MessageTemplateChatResponse | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isMobile,    setIsMobile]    = useState(() => window.innerWidth < 640)

  const containerRef = useRef<HTMLDivElement>(null)
  // itemRefs é indexado pelo flat index do template
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // ---------------------------------------------------------------------------
  // Carregar templates ao montar
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listChatTemplates(conversationId)
      .then(res => { if (!cancelled) { setData(res); setLoading(false) } })
      .catch(e  => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Erro'); setLoading(false) } })
    return () => { cancelled = true }
  }, [conversationId])

  // ---------------------------------------------------------------------------
  // Mobile detection
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // ---------------------------------------------------------------------------
  // Fechar ao clicar fora
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // ---------------------------------------------------------------------------
  // Filtrar por query (nome, conteúdo ou categoria) — limitado a MAX_ITEMS
  // ---------------------------------------------------------------------------

  const filteredTemplates = useMemo((): MessageTemplateChatItem[] => {
    if (!data) return []
    const q = query.toLowerCase().trim()

    const all = q
      ? data.templates.filter(tpl => {
          if (tpl.name.toLowerCase().includes(q))    return true
          if (tpl.content.toLowerCase().includes(q)) return true
          const cat = data.categories.find(c => c.id === tpl.category_id)
          if (cat && cat.name.toLowerCase().includes(q)) return true
          return false
        })
      : data.templates

    return all.slice(0, MAX_ITEMS)
  }, [data, query])

  // ---------------------------------------------------------------------------
  // Agrupar por categoria (baseado nos filteredTemplates)
  // ---------------------------------------------------------------------------

  interface Group {
    catName: string
    catId: string | null
    items: MessageTemplateChatItem[]
  }

  const groups = useMemo((): Group[] => {
    if (!data) return []
    const catMap   = new Map(data.categories.map(c => [c.id, c.name]))
    const byCategory = new Map<string | null, MessageTemplateChatItem[]>()

    for (const tpl of filteredTemplates) {
      const key = tpl.category_id ?? null
      if (!byCategory.has(key)) byCategory.set(key, [])
      byCategory.get(key)!.push(tpl)
    }

    const result: Group[] = []
    for (const cat of data.categories) {
      const items = byCategory.get(cat.id)
      if (items && items.length > 0) {
        result.push({ catId: cat.id, catName: catMap.get(cat.id) ?? cat.id, items })
      }
    }
    const uncategorized = byCategory.get(null)
    if (uncategorized && uncategorized.length > 0) {
      result.push({ catId: null, catName: 'Sem categoria', items: uncategorized })
    }
    return result
  }, [data, filteredTemplates])

  // Índice flat de cada template (para mapeamento de activeIndex → template)
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    filteredTemplates.forEach((tpl, idx) => map.set(tpl.id, idx))
    return map
  }, [filteredTemplates])

  // ---------------------------------------------------------------------------
  // Reset activeIndex e refs quando filteredTemplates muda
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setActiveIndex(-1)
    itemRefs.current = new Array(filteredTemplates.length).fill(null)
  }, [filteredTemplates.length])

  // ---------------------------------------------------------------------------
  // Scroll automático ao navegar
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeIndex])

  // ---------------------------------------------------------------------------
  // Teclado — ESC, ArrowUp/Down, Enter
  // Usando listener global apenas porque o foco permanece no textarea do composer.
  // O picker só é montado enquanto está visível, então não há conflito.
  // ---------------------------------------------------------------------------

  const handleSelect = useCallback((tpl: MessageTemplateChatItem) => {
    onSelect({
      content:    tpl.content,
      media_path: (tpl as any).media_path ?? null,
      media_type: (tpl as any).media_type ?? null,
    })
  }, [onSelect])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(prev => {
          const next = prev + 1
          return next >= filteredTemplates.length ? 0 : next
        })
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(prev => {
          const next = prev - 1
          return next < 0 ? filteredTemplates.length - 1 : next
        })
        return
      }

      if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < filteredTemplates.length) {
        e.preventDefault()
        handleSelect(filteredTemplates[activeIndex])
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, handleSelect, filteredTemplates, activeIndex])

  // ---------------------------------------------------------------------------
  // Estilos condicionais mobile / desktop
  // ---------------------------------------------------------------------------

  const containerStyle: React.CSSProperties = isMobile
    ? {
        position:      'fixed',
        bottom:        0,
        left:          0,
        right:         0,
        height:        '60vh',
        borderRadius:  '16px 16px 0 0',
        overflowY:     'auto',
        zIndex:        50,
      }
    : {
        maxHeight: '320px',
        overflowY: 'auto',
      }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Overlay para mobile */}
      {isMobile && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onMouseDown={onClose}
        />
      )}

      <div
        ref={containerRef}
        className="rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
        style={containerStyle}
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
        {!loading && !error && filteredTemplates.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            {query
              ? `Nenhum modelo encontrado para "${query}"`
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
            {group.items.map(tpl => {
              const flatIdx = flatIndexMap.get(tpl.id) ?? -1
              return (
                <TemplateItem
                  key={tpl.id}
                  template={tpl}
                  query={query}
                  isActive={activeIndex === flatIdx}
                  itemRef={(el) => { itemRefs.current[flatIdx] = el }}
                  onSelect={handleSelect}
                />
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-componente: item de template
// ---------------------------------------------------------------------------

interface TemplateItemProps {
  template: MessageTemplateChatItem
  query: string
  isActive: boolean
  itemRef: (el: HTMLButtonElement | null) => void
  onSelect: (tpl: MessageTemplateChatItem) => void
}

function TemplateItem({ template, query, isActive, itemRef, onSelect }: TemplateItemProps) {
  const highlight = (text: string): React.ReactNode => {
    if (!query.trim()) return text
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-100 text-yellow-800 rounded-sm">
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  return (
    <button
      ref={itemRef}
      type="button"
      onClick={() => onSelect(template)}
      className={`w-full text-left px-4 py-3 transition-colors flex flex-col gap-0.5 border-b border-gray-50 last:border-0 ${
        isActive ? 'bg-blue-50' : 'hover:bg-blue-50'
      }`}
    >
      <span className="text-sm font-medium text-gray-800">{highlight(template.name)}</span>
      <span className="text-xs text-gray-500 line-clamp-2">{highlight(template.content)}</span>
    </button>
  )
}
