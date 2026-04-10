/**
 * AgentPromptBuilder
 *
 * Builder estruturado de prompt por seções.
 * Utilizado em agentes conversacionais no modo 'structured'.
 *
 * Regras:
 *   - Nunca envia o campo `prompt` — apenas `prompt_config`
 *   - Preview espelha exatamente o algoritmo do backend (promptAssembler)
 *   - Conteúdo interno preservado integralmente (apenas trim nas bordas)
 *   - Limite de 1500 chars por seção
 *
 * Funcionalidades de variáveis:
 *   - Painel colapsável → clique para inserir na seção ativa
 *   - Autocomplete ao digitar {{ em qualquer seção
 */

import { useRef, useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, ToggleLeft, ToggleRight } from 'lucide-react'
import {
  SECTION_ORDER,
  SECTION_CATALOG,
  PROMPT_VARIABLES,
  PROMPT_VARIABLE_GROUPS,
  type PromptConfig,
  type PromptSection,
  type SectionId,
  type PromptVariable,
} from '../../lib/promptVariables'

// ── Constantes ────────────────────────────────────────────────────────────────

const SECTION_MAX_CHARS = 3000
const PROMPT_MAX_CHARS  = 30000
const PROMPT_NEAR_LIMIT = PROMPT_MAX_CHARS * 0.85  // aviso a partir de 85%

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
    '<mark style="background:transparent;color:#2563EB;font-weight:normal;font-style:normal">{{$1}}</mark>'
  )
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AutocompleteState {
  show:        boolean
  query:       string    // texto após {{ digitado pelo usuário
  insertStart: number    // posição do {{ no texto
}

// ── Preview (espelha promptAssembler.ts) ─────────────────────────────────────

function assemblePreview(config: PromptConfig): string {
  const parts: string[] = []

  for (const sectionId of SECTION_ORDER) {
    const section = config.sections[sectionId]
    if (!section)         continue
    if (!section.enabled) continue
    const trimmed = section.content.trim()
    if (!trimmed)         continue

    const { label } = SECTION_CATALOG[sectionId]
    parts.push(`## ${label}\n\n${trimmed}`)
  }

  if (parts.length === 0) return ''
  return parts.join('\n\n---\n\n').trim()
}

// ── Helper: config inicial para novo agente ───────────────────────────────────

export function createEmptyPromptConfig(): PromptConfig {
  return {
    version:  1,
    mode:     'structured',
    sections: {
      identity:  { enabled: true, content: '' },
      objective: { enabled: true, content: '' },
    },
  }
}

// ── Helper: inserção no cursor (compatível com React controlado) ──────────────

function insertAtCursor(
  ta:          HTMLTextAreaElement,
  insertStart: number,
  insertEnd:   number,
  text:        string,
): void {
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

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  value:                 PromptConfig
  onChange:              (config: PromptConfig) => void
  disabled?:             boolean
  customFieldVariables?: PromptVariable[]
}

// ── Helper: atualizar seção no config ────────────────────────────────────────

function updateSection(
  config:    PromptConfig,
  sectionId: SectionId,
  patch:     Partial<PromptSection>,
): PromptConfig {
  const current = config.sections[sectionId] ?? { enabled: false, content: '' }
  return {
    ...config,
    sections: {
      ...config.sections,
      [sectionId]: { ...current, ...patch },
    },
  }
}

// ── Sub-componente: painel de variáveis ───────────────────────────────────────

interface VariablesPanelProps {
  customFieldVariables?: PromptVariable[]
  onInsert:              (variable: string) => void
  hasActiveSection:      boolean
}

function VariablesPanel({ customFieldVariables = [], onInsert, hasActiveSection }: VariablesPanelProps) {
  const [open, setOpen]         = useState(false)
  const [inserted, setInserted] = useState<string | null>(null)

  const allVars = [...PROMPT_VARIABLES, ...customFieldVariables]
  const groups  = [
    ...PROMPT_VARIABLE_GROUPS,
    ...(customFieldVariables.length > 0 ? ['Campos Personalizados' as const] : []),
  ]

  function handleVarClick(variable: string) {
    onInsert(variable)
    setInserted(variable)
    setTimeout(() => setInserted(null), 1500)
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50
                   hover:bg-gray-100 transition-colors font-medium text-gray-600"
      >
        <span className="flex items-center gap-2">
          <Copy className="w-3.5 h-3.5 text-gray-400" />
          Variáveis disponíveis ({allVars.length})
          {hasActiveSection
            ? <span className="font-normal text-gray-400">— clique para inserir no campo ativo</span>
            : <span className="font-normal text-gray-400">— clique em uma seção primeiro</span>
          }
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
          {groups.map(group => {
            const vars = allVars.filter(v => v.group === group)
            if (vars.length === 0) return null
            return (
              <div key={group} className="px-3 py-2">
                <p className="font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{group}</p>
                <div className="space-y-1">
                  {vars.map(v => (
                    <div key={v.variable} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleVarClick(v.variable)}
                        title={hasActiveSection ? 'Inserir no campo ativo' : 'Clique em uma seção para ativar'}
                        className={`flex-shrink-0 font-mono px-1.5 py-0.5 rounded border transition-colors ${
                          inserted === v.variable
                            ? 'bg-green-100 border-green-300 text-green-700'
                            : hasActiveSection
                            ? 'bg-white border-gray-300 text-blue-700 hover:bg-blue-50 hover:border-blue-300'
                            : 'bg-gray-50 border-gray-200 text-gray-400 cursor-default'
                        }`}
                      >
                        {inserted === v.variable ? '✓ inserida' : v.variable}
                      </button>
                      <span className="text-gray-500 truncate">{v.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AgentPromptBuilder({ value, onChange, disabled = false, customFieldVariables = [] }: Props) {
  const [previewOpen, setPreviewOpen]           = useState(false)
  const [activeSectionId, setActiveSectionId]   = useState<SectionId | null>(null)
  const [autocomplete, setAutocomplete]         = useState<AutocompleteState | null>(null)
  const activeTextareaRef                       = useRef<HTMLTextAreaElement | null>(null)
  const dropdownRef                             = useRef<HTMLDivElement | null>(null)
  const overlayRefs                             = useRef<Partial<Record<SectionId, HTMLDivElement | null>>>({})

  const allVariables = [...PROMPT_VARIABLES, ...customFieldVariables]

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
        activeTextareaRef.current !== e.target
      ) {
        setAutocomplete(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function detectAutocomplete(ta: HTMLTextAreaElement) {
    const cursor     = ta.selectionStart
    const textBefore = ta.value.slice(0, cursor)
    const match      = textBefore.match(/\{\{(\w*)$/)
    if (match) {
      setAutocomplete({ show: true, query: match[1], insertStart: cursor - match[0].length })
    } else {
      setAutocomplete(null)
    }
  }

  function applyAutocomplete(variable: string) {
    const ta = activeTextareaRef.current
    if (!ta || !autocomplete) return
    const cursor = ta.selectionStart
    insertAtCursor(ta, autocomplete.insertStart, cursor, variable)
    setAutocomplete(null)
  }

  function insertFromPanel(variable: string) {
    const ta = activeTextareaRef.current
    if (ta) {
      const pos = ta.selectionStart
      insertAtCursor(ta, pos, pos, variable)
      ta.focus()
    }
  }

  function handleTextareaFocus(e: React.FocusEvent<HTMLTextAreaElement>, sectionId: SectionId) {
    activeTextareaRef.current = e.target
    setActiveSectionId(sectionId)
  }

  function handleToggleSection(sectionId: SectionId) {
    const current = value.sections[sectionId]
    const enabled = current ? !current.enabled : true
    onChange(updateSection(value, sectionId, { enabled }))
  }

  function handleContentChange(sectionId: SectionId, content: string) {
    onChange(updateSection(value, sectionId, { content }))
  }

  const preview        = assemblePreview(value)
  const totalChars     = preview.length
  const totalOverLimit = totalChars > PROMPT_MAX_CHARS
  const totalNearLimit = totalChars > PROMPT_NEAR_LIMIT && !totalOverLimit
  const activeSections = SECTION_ORDER.filter(id => {
    const s = value.sections[id]
    return s?.enabled && s.content.trim().length > 0
  })

  return (
    <div className="space-y-3">

      {/* Seções */}
      <div className="space-y-2">
        {SECTION_ORDER.map(sectionId => {
          const section   = value.sections[sectionId]
          const enabled   = section?.enabled ?? false
          const content   = section?.content ?? ''
          const chars     = content.length
          const overLimit = chars > SECTION_MAX_CHARS
          const nearLimit = chars > SECTION_MAX_CHARS * 0.85

          return (
            <div
              key={sectionId}
              className={`border rounded-lg transition-colors ${
                enabled
                  ? 'border-blue-200 bg-white'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              {/* Header da seção */}
              <div
                className="flex items-center justify-between px-3 py-2.5 cursor-pointer select-none"
                onClick={() => !disabled && handleToggleSection(sectionId)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={e => { e.stopPropagation(); handleToggleSection(sectionId) }}
                    className="flex-shrink-0 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                    aria-label={enabled ? 'Desativar seção' : 'Ativar seção'}
                  >
                    {enabled
                      ? <ToggleRight className="w-5 h-5 text-blue-600" />
                      : <ToggleLeft  className="w-5 h-5" />
                    }
                  </button>
                  <span className={`text-sm font-medium truncate ${
                    enabled ? 'text-gray-800' : 'text-gray-400'
                  }`}>
                    {SECTION_CATALOG[sectionId].label}
                  </span>
                  {enabled && content.trim().length > 0 && (
                    <span className="flex-shrink-0 text-xs text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                      preenchida
                    </span>
                  )}
                  {enabled && content.trim().length === 0 && (
                    <span className="flex-shrink-0 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      vazia — não incluída
                    </span>
                  )}
                </div>
              </div>

              {/* Textarea + dropdown — só exibidos quando enabled */}
              {enabled && (
                <div className="border-t border-blue-100 px-3 pb-3 pt-2 space-y-1.5">
                  <div className="relative">
                    {/*
                      Overlay: renderiza o texto com {{variáveis}} coloridas em azul.
                      Fica atrás da textarea (z-0). CSS idêntico ao da textarea para
                      alinhamento perfeito. Border transparent garante offset igual.
                    */}
                    <div
                      aria-hidden="true"
                      ref={el => { overlayRefs.current[sectionId] = el }}
                      className="absolute inset-0 z-0 border border-transparent rounded-md
                                 px-3 py-2 text-sm font-mono leading-relaxed
                                 text-gray-800 overflow-hidden pointer-events-none select-none"
                      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word' }}
                      dangerouslySetInnerHTML={{ __html: highlightVariables(content) + '<br>' }}
                    />

                    <textarea
                      value={content}
                      onChange={e => {
                        handleContentChange(sectionId, e.target.value)
                        detectAutocomplete(e.target)
                      }}
                      onScroll={e => {
                        const ta = e.target as HTMLTextAreaElement
                        const ov = overlayRefs.current[sectionId]
                        // #region agent log
                        fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7a137a'},body:JSON.stringify({sessionId:'7a137a',hypothesisId:'A',location:'AgentPromptBuilder.tsx:onScroll',message:'scroll event',data:{sectionId,scrollTop:ta.scrollTop,hasOverlayRef:Boolean(ov)},timestamp:Date.now()})}).catch(()=>{})
                        // #endregion
                        if (ov) {
                          ov.scrollTop  = ta.scrollTop
                          ov.scrollLeft = ta.scrollLeft
                        }
                      }}
                      onFocus={e => handleTextareaFocus(e, sectionId)}
                      onKeyDown={e => {
                        if (autocomplete?.show) {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setAutocomplete(null)
                          }
                          if ((e.key === 'Tab' || e.key === 'Enter') && autocompleteItems.length === 1) {
                            e.preventDefault()
                            applyAutocomplete(autocompleteItems[0].variable)
                          }
                        }
                      }}
                      disabled={disabled}
                      rows={4}
                      placeholder={SECTION_CATALOG[sectionId].placeholder}
                      className={`relative z-10 w-full border rounded-md px-3 py-2 text-sm font-mono leading-relaxed resize-y
                                  focus:outline-none focus:ring-2 transition-colors
                                  disabled:opacity-50 disabled:cursor-not-allowed ${
                        overLimit
                          ? 'border-red-300 focus:ring-red-400'
                          : nearLimit
                          ? 'border-amber-300 focus:ring-amber-400'
                          : 'border-gray-300 focus:ring-blue-400'
                      }`}
                      style={{ color: 'transparent', caretColor: '#1f2937', background: 'transparent' }}
                    />

                    {/* Dropdown autocomplete — exibido apenas na seção ativa */}
                    {activeSectionId === sectionId && autocomplete?.show && autocompleteItems.length > 0 && (
                      <div
                        ref={dropdownRef}
                        className="absolute left-0 top-full z-50 mt-1 w-80 max-h-52 overflow-y-auto
                                   bg-white border border-gray-200 rounded-lg shadow-lg"
                      >
                        <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50">
                          <p className="text-xs text-gray-500">
                            Variáveis —{' '}
                            <kbd className="font-mono bg-white border border-gray-200 rounded px-1">Esc</kbd>{' '}
                            para fechar
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

                  <div className="flex items-center justify-between">
                    {content.trim().length === 0 ? (
                      <button
                        type="button"
                        onClick={() => handleContentChange(sectionId, SECTION_CATALOG[sectionId].placeholder)}
                        className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
                      >
                        ↙ usar texto de exemplo
                      </button>
                    ) : (
                      <span />
                    )}
                    <span className={`text-xs ${
                      overLimit ? 'text-red-600 font-medium' : nearLimit ? 'text-amber-600' : 'text-gray-400'
                    }`}>
                      {chars.toLocaleString('pt-BR')} / {SECTION_MAX_CHARS.toLocaleString('pt-BR')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Indicador de total do prompt montado */}
      {(totalNearLimit || totalOverLimit) && (
        <div className={`rounded-lg border px-3 py-2.5 text-xs flex items-start gap-2 ${
          totalOverLimit
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}>
          <span className="flex-shrink-0 font-bold">{totalOverLimit ? '✕' : '!'}</span>
          <div className="min-w-0">
            <p className="font-semibold">
              {totalOverLimit
                ? `Prompt excede o limite — ${totalChars.toLocaleString('pt-BR')} / ${PROMPT_MAX_CHARS.toLocaleString('pt-BR')} caracteres`
                : `Prompt próximo do limite — ${totalChars.toLocaleString('pt-BR')} / ${PROMPT_MAX_CHARS.toLocaleString('pt-BR')} caracteres`
              }
            </p>
            <p className="mt-0.5 text-xs opacity-80">
              {totalOverLimit
                ? 'Reduza o conteúdo de algumas seções para conseguir salvar. O servidor rejeitará o prompt acima de 30.000 caracteres.'
                : 'Você está se aproximando do limite. Considere reduzir ou desativar algumas seções.'
              }
            </p>
          </div>
        </div>
      )}

      {/* Painel de variáveis */}
      <VariablesPanel
        customFieldVariables={customFieldVariables}
        onInsert={insertFromPanel}
        hasActiveSection={activeSectionId !== null}
      />

      {/* Preview */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setPreviewOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50
                     hover:bg-gray-100 transition-colors text-xs font-medium text-gray-600"
        >
          <span className="flex items-center gap-2">
            {previewOpen
              ? <EyeOff className="w-3.5 h-3.5 text-gray-400" />
              : <Eye     className="w-3.5 h-3.5 text-gray-400" />
            }
            Prévia do prompt
            {activeSections.length > 0
              ? <span className="text-gray-400 font-normal">
                  ({activeSections.length} seção{activeSections.length !== 1 ? 'ões' : ''} ativa{activeSections.length !== 1 ? 's' : ''})
                </span>
              : <span className="text-amber-500 font-normal">— nenhuma seção ativa</span>
            }
          </span>
          {previewOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {previewOpen && (
          <div className="border-t border-gray-100">
            {/* Badge de aviso */}
            <div className="px-3 py-2 bg-amber-50 border-b border-amber-100">
              <p className="text-xs text-amber-700">
                Prévia local — o prompt final é montado e validado pelo servidor ao salvar.
              </p>
            </div>

            {preview ? (
              <pre className="px-4 py-3 text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed
                              max-h-72 overflow-y-auto bg-white">
                {preview}
              </pre>
            ) : (
              <p className="px-4 py-4 text-xs text-gray-400 italic">
                Nenhuma seção ativa com conteúdo. Ative e preencha ao menos uma seção para ver a prévia.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
