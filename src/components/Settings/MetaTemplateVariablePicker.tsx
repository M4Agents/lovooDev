import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  META_VARIABLE_PARAM_DISCLAIMER,
  buildMetaVariableSuggestions,
  detectOpenTrigger,
  filterSuggestions,
  formatLockNote,
  insertMetaPlaceholder,
  classifyTemplateFormat,
  type MetaVariableSuggestion,
} from './metaTemplateVariableCatalog'
import { listTemplateCreateVariables } from './metaTemplateCreateModel'

function formatFromTexts(headerText: string, bodyText: string) {
  const listed = listTemplateCreateVariables(headerText, bodyText)
  return classifyTemplateFormat([...listed.header, ...listed.body])
}

type FieldComponent = 'header' | 'body'

export function MetaTemplateVariablePicker({
  id,
  label,
  value,
  onChange,
  headerText,
  bodyText,
  component,
  maxLength,
  rows,
  error,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  headerText: string
  bodyText: string
  component: FieldComponent
  maxLength: number
  rows: number
  error?: string | null
  disabled?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const reactId = useId()
  const listId = `${id}-var-list`
  const [panelOpen, setPanelOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [trigger, setTrigger] = useState<{ query: string; from: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const format = formatFromTexts(headerText, bodyText)
  const options = useMemo(
    () => buildMetaVariableSuggestions({ component, headerText, bodyText }),
    [component, headerText, bodyText],
  )
  const query = trigger ? trigger.query : search
  const filtered = filterSuggestions(options, query)
  const listOpen = (panelOpen || trigger != null)
  const emptyMessage = component === 'header' && options.length === 0
    ? 'O cabeçalho aceita no máximo uma variável.'
    : format === 'MIXED'
      ? 'Há formatos misturados. Corrija o texto antes de inserir outra variável.'
      : 'Nenhuma variável disponível para este campo.'

  useEffect(() => {
    setActiveIndex(0)
  }, [query, listOpen, filtered.length])

  useEffect(() => {
    if (!listOpen) return
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPanelOpen(false)
        setTrigger(null)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [listOpen])

  function restoreCursor(next: string, cursor: number) {
    onChange(next)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(cursor, cursor)
    })
  }

  function applySuggestion(option: MetaVariableSuggestion) {
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? value.length
    const selectionEnd = ta?.selectionEnd ?? cursor
    const open = detectOpenTrigger(value, cursor)
    const from = open ? open.from : cursor
    const to = open ? cursor : selectionEnd
    const inserted = insertMetaPlaceholder(value, from, to, option.syntax)
    setPanelOpen(false)
    setTrigger(null)
    setSearch('')
    restoreCursor(inserted.text, inserted.cursor)
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value
    const cursor = event.target.selectionStart ?? next.length
    onChange(next)
    setTrigger(detectOpenTrigger(next, cursor))
    setPanelOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!listOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setPanelOpen(false)
      setTrigger(null)
      textareaRef.current?.focus()
      return
    }
    if (filtered.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % filtered.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const option = filtered[activeIndex] ?? filtered[0]
      if (option) applySuggestion(option)
    }
  }

  return (
    <div ref={rootRef} className="block space-y-1" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>
        <button
          type="button"
          disabled={disabled}
          aria-expanded={panelOpen}
          aria-controls={listId}
          aria-haspopup="listbox"
          onClick={() => {
            setTrigger(null)
            setPanelOpen((open) => !open)
            setSearch('')
          }}
          className="text-xs font-medium text-green-700 hover:text-green-800 disabled:opacity-50"
        >
          Consultar variáveis
        </button>
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={handleChange}
        maxLength={maxLength}
        rows={rows}
        disabled={disabled}
        aria-autocomplete="list"
        aria-controls={listOpen ? listId : undefined}
        aria-expanded={listOpen}
        aria-activedescendant={listOpen && filtered[activeIndex] ? `${reactId}-${filtered[activeIndex].id}` : undefined}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
      />
      {listOpen ? (
        <div className="relative">
          <div className="absolute z-20 mt-1 w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg">
            {panelOpen ? (
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Buscar variáveis"
                placeholder="Buscar"
                className="w-full px-3 py-2 text-xs border-b border-slate-200 rounded-t-lg"
              />
            ) : null}
            <p className="px-3 py-2 text-[11px] text-slate-500">{META_VARIABLE_PARAM_DISCLAIMER}</p>
            <p className="px-3 pb-1 text-[11px] text-slate-500">{formatLockNote(format)}</p>
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">{emptyMessage}</p>
            ) : (
              <ul id={listId} role="listbox" aria-label="Variáveis do modelo" className="max-h-48 overflow-y-auto py-1">
                {filtered.map((option, index) => (
                  <li key={option.id} role="presentation">
                    <button
                      id={`${reactId}-${option.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySuggestion(option)}
                      className={`w-full px-3 py-2 text-left ${index === activeIndex ? 'bg-green-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="block text-xs font-medium text-slate-800">{option.label}</span>
                      <span className="block font-mono text-[11px] text-slate-600">{option.syntax}</span>
                      <span className="block text-[11px] text-slate-500">Ex.: {option.example}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
