/**
 * PromptEditor
 *
 * Textarea enriquecido para edição de prompts de agentes e diretrizes de IA.
 *
 * Funcionalidades:
 *   1. Painel colapsável com variáveis disponíveis (clique para inserir)
 *   2. Autocomplete ao digitar {{ — dropdown filtrável com variáveis
 *   3. Suporte a campos personalizados dinâmicos (prop customFieldVariables)
 *
 * Uso básico:
 *   <PromptEditor value={prompt} onChange={setPrompt} rows={8} />
 *
 * Com campos personalizados:
 *   <PromptEditor
 *     value={prompt}
 *     onChange={setPrompt}
 *     customFieldVariables={customFieldsToVariables(fields)}
 *   />
 */

import { useRef, useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Copy } from 'lucide-react'
import {
  PROMPT_VARIABLES,
  PROMPT_VARIABLE_GROUPS,
  type PromptVariable,
} from '../../lib/promptVariables'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AutocompleteState {
  show:        boolean
  query:       string    // texto após {{ digitado pelo usuário
  insertStart: number    // posição do {{ no texto
}

// ── Highlight de variáveis ────────────────────────────────────────────────────

/**
 * Converte texto plano em HTML com variáveis {{token}} destacadas em azul.
 * Escapa HTML antes de colorir para evitar XSS.
 * Apenas tokens completos {{palavra}} são coloridos — tokens parciais ficam neutros.
 */
function highlightVariables(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(
    /\{\{(\w+)\}\}/g,
    '<mark style="background:transparent;color:#2563EB;font-weight:600;font-style:normal">{{$1}}</mark>'
  )
}

interface Props {
  value:                  string
  onChange:               (val: string) => void
  rows?:                  number
  placeholder?:           string
  disabled?:              boolean
  className?:             string
  /** Campos personalizados dinâmicos (cp_*) — passados pelo componente pai */
  customFieldVariables?:  PromptVariable[]
  /** Grupos estáticos a exibir (omitir = todos) */
  visibleGroups?:         string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Insere texto na textarea via evento nativo (compatível com React controlado) */
function insertAtCursor(ta: HTMLTextAreaElement, insertStart: number, insertEnd: number, text: string): void {
  const before = ta.value.slice(0, insertStart)
  const after  = ta.value.slice(insertEnd)
  const newVal = before + text + after
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  nativeSetter?.call(ta, newVal)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.focus()
  const pos = insertStart + text.length
  ta.selectionStart = ta.selectionEnd = pos
}

// ── Componente principal ──────────────────────────────────────────────────────

export function PromptEditor({
  value,
  onChange,
  rows               = 8,
  placeholder        = 'Digite o prompt...',
  disabled           = false,
  className          = '',
  customFieldVariables = [],
  visibleGroups,
}: Props) {
  const textareaRef                    = useRef<HTMLTextAreaElement>(null)
  const overlayRef                     = useRef<HTMLDivElement>(null)
  const dropdownRef                    = useRef<HTMLDivElement>(null)
  const [panelOpen, setPanelOpen]      = useState(false)
  const [copied, setCopied]            = useState<string | null>(null)
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null)

  // Catálogo completo (estático + campos personalizados dinâmicos)
  const allVariables: PromptVariable[] = [
    ...PROMPT_VARIABLES.filter(v =>
      !visibleGroups || visibleGroups.includes(v.group)
    ),
    ...customFieldVariables,
  ]

  // Grupos a exibir no painel
  const groups = [
    ...(visibleGroups ? PROMPT_VARIABLE_GROUPS.filter(g => visibleGroups.includes(g)) : [...PROMPT_VARIABLE_GROUPS]),
    ...(customFieldVariables.length > 0 ? ['Campos Personalizados'] : []),
  ]

  // Variáveis filtradas para o autocomplete
  const autocompleteItems = autocomplete?.show
    ? allVariables.filter(v =>
        v.variable.toLowerCase().includes(autocomplete.query.toLowerCase()) ||
        v.description.toLowerCase().includes(autocomplete.query.toLowerCase())
      )
    : []

  // Fechar autocomplete ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !textareaRef.current?.contains(e.target as Node)
      ) {
        setAutocomplete(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Handlers de texto ───────────────────────────────────────────────────

  function detectAutocomplete(ta: HTMLTextAreaElement) {
    const cursor         = ta.selectionStart
    const textBefore     = ta.value.slice(0, cursor)
    const match          = textBefore.match(/\{\{(\w*)$/)

    if (match) {
      setAutocomplete({
        show:        true,
        query:       match[1],
        insertStart: cursor - match[0].length,
      })
    } else {
      setAutocomplete(null)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value)
    detectAutocomplete(e.target)
  }

  function handleInput(e: React.FormEvent<HTMLTextAreaElement>) {
    onChange((e.target as HTMLTextAreaElement).value)
    detectAutocomplete(e.target as HTMLTextAreaElement)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (autocomplete?.show) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setAutocomplete(null)
      }
      // Tab ou Enter com um único resultado: inserir automaticamente
      if ((e.key === 'Tab' || e.key === 'Enter') && autocompleteItems.length === 1) {
        e.preventDefault()
        applyAutocomplete(autocompleteItems[0].variable)
      }
    }
  }

  // ── Scroll sync (overlay acompanha textarea) ────────────────────────────

  function syncScroll() {
    if (overlayRef.current && textareaRef.current) {
      overlayRef.current.scrollTop  = textareaRef.current.scrollTop
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  // ── Inserção de variável ────────────────────────────────────────────────

  /** Inserção via autocomplete (substitui {{ + query parcial) */
  function applyAutocomplete(variable: string) {
    const ta = textareaRef.current
    if (!ta || !autocomplete) return
    const cursor = ta.selectionStart
    insertAtCursor(ta, autocomplete.insertStart, cursor, variable)
    setAutocomplete(null)
  }

  /** Inserção via clique no painel de variáveis (insere na posição do cursor) */
  function insertFromPanel(variable: string) {
    const ta = textareaRef.current
    if (ta) {
      const pos = ta.selectionStart
      insertAtCursor(ta, pos, pos, variable)
    } else {
      // Fallback: copiar para clipboard
      navigator.clipboard.writeText(variable).catch(() => {})
    }
    setCopied(variable)
    setTimeout(() => setCopied(null), 1500)
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={`space-y-2 ${className}`}>

      {/* Textarea com overlay de highlight + dropdown de autocomplete */}
      <div className="relative">

        {/*
          Overlay: renderiza o texto com variáveis coloridas em azul.
          Fica atrás da textarea (z-0) com pointer-events: none.
          CSS idêntico ao da textarea para alinhamento perfeito do texto.
          O border transparent garante que o offset de padding seja igual.
        */}
        <div
          ref={overlayRef}
          aria-hidden="true"
          className="absolute inset-0 z-0 border border-transparent rounded-lg
                     px-3 py-2.5 text-sm font-mono leading-relaxed
                     text-gray-800 overflow-hidden pointer-events-none select-none"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word' }}
          dangerouslySetInnerHTML={{
            // <br> final garante que a última linha não seja cortada
            __html: highlightVariables(value) + '<br>'
          }}
        />

        {/*
          Textarea: fica na frente (z-10), recebe todos os eventos.
          color: transparent → texto invisível (overlay mostra o texto colorido).
          caretColor: #1f2937 → cursor permanece visível.
          background: transparent → overlay aparece através da textarea.
        */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          className="relative z-10 w-full border border-gray-300 rounded-lg
                     px-3 py-2.5 text-sm font-mono leading-relaxed resize-y
                     focus:outline-none focus:ring-2 focus:ring-blue-400
                     disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ color: 'transparent', caretColor: '#1f2937', background: 'transparent' }}
        />

        {/* Dropdown autocomplete {{ */}
        {autocomplete?.show && autocompleteItems.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute left-0 top-full z-50 mt-1 w-80 max-h-52 overflow-y-auto
                       bg-white border border-gray-200 rounded-lg shadow-lg"
          >
            <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500">
                Variáveis disponíveis — <kbd className="font-mono bg-white border border-gray-200 rounded px-1">Esc</kbd> para fechar
              </p>
            </div>
            {autocompleteItems.map(v => (
              <button
                key={v.variable}
                type="button"
                onMouseDown={e => { e.preventDefault(); applyAutocomplete(v.variable) }}
                className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-blue-50
                           transition-colors border-b border-gray-50 last:border-0"
              >
                <code className="flex-shrink-0 text-xs font-mono text-blue-700 bg-blue-50 border
                                 border-blue-200 rounded px-1.5 py-0.5 mt-0.5">
                  {v.variable}
                </code>
                <span className="text-xs text-gray-600 min-w-0 truncate">{v.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Painel de variáveis disponíveis (colapsável) */}
      {allVariables.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setPanelOpen(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50
                       hover:bg-gray-100 transition-colors text-xs font-medium text-gray-600"
          >
            <span className="flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-gray-400" />
              Variáveis disponíveis
              <span className="text-gray-400 font-normal">
                ({allVariables.length} — clique para inserir · ou digite {'{{'}  no editor)
              </span>
            </span>
            {panelOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {panelOpen && (
            <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {groups.map(group => {
                const vars = allVariables.filter(v => v.group === group)
                if (vars.length === 0) return null
                return (
                  <div key={group} className="px-3 py-2.5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      {group}
                      {vars.some(v => v.conditional) && (
                        <span className="ml-1.5 font-normal normal-case text-gray-300">
                          (disponível quando o contexto existir)
                        </span>
                      )}
                    </p>
                    <div className="space-y-1.5">
                      {vars.map(v => (
                        <div key={v.variable} className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => insertFromPanel(v.variable)}
                            title="Clique para inserir no texto"
                            className={`flex-shrink-0 font-mono text-xs px-2 py-0.5 rounded border
                                        transition-colors ${
                              copied === v.variable
                                ? 'bg-green-100 border-green-300 text-green-700'
                                : 'bg-white border-gray-300 text-blue-700 hover:bg-blue-50 hover:border-blue-300'
                            }`}
                          >
                            {copied === v.variable ? '✓ inserida' : v.variable}
                          </button>
                          <span className="text-xs text-gray-500 min-w-0">
                            {v.description}
                            {v.example && (
                              <span className="text-gray-400 ml-1">— ex: <em>{v.example}</em></span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
