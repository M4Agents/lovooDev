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
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, ToggleLeft, ToggleRight } from 'lucide-react'
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

const SECTION_MAX_CHARS = 1500

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

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Props {
  value:                 PromptConfig
  onChange:              (config: PromptConfig) => void
  disabled?:             boolean
  customFieldVariables?: PromptVariable[]
}

// ── Helper: atualizar seção no config ────────────────────────────────────────

function updateSection(
  config: PromptConfig,
  sectionId: SectionId,
  patch: Partial<PromptSection>
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

function VariablesPanel({ customFieldVariables = [] }: { customFieldVariables?: PromptVariable[] }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const allVars = [...PROMPT_VARIABLES, ...customFieldVariables]
  const groups  = [
    ...PROMPT_VARIABLE_GROUPS,
    ...(customFieldVariables.length > 0 ? ['Campos Personalizados' as const] : []),
  ]

  function copyVar(variable: string) {
    navigator.clipboard.writeText(variable).catch(() => {})
    setCopied(variable)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50
                   hover:bg-gray-100 transition-colors font-medium text-gray-600"
      >
        <span>Variáveis disponíveis ({allVars.length})</span>
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
                        onClick={() => copyVar(v.variable)}
                        className={`flex-shrink-0 font-mono px-1.5 py-0.5 rounded border transition-colors ${
                          copied === v.variable
                            ? 'bg-green-100 border-green-300 text-green-700'
                            : 'bg-white border-gray-300 text-blue-700 hover:bg-blue-50 hover:border-blue-300'
                        }`}
                      >
                        {copied === v.variable ? '✓' : v.variable}
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
  const [previewOpen, setPreviewOpen] = useState(false)

  function handleToggleSection(sectionId: SectionId) {
    const current = value.sections[sectionId]
    const enabled = current ? !current.enabled : true
    onChange(updateSection(value, sectionId, { enabled }))
  }

  function handleContentChange(sectionId: SectionId, content: string) {
    onChange(updateSection(value, sectionId, { content }))
  }

  const preview = assemblePreview(value)
  const activeSections = SECTION_ORDER.filter(id => {
    const s = value.sections[id]
    return s?.enabled && s.content.trim().length > 0
  })

  return (
    <div className="space-y-3">

      {/* Seções */}
      <div className="space-y-2">
        {SECTION_ORDER.map(sectionId => {
          const section  = value.sections[sectionId]
          const enabled  = section?.enabled ?? false
          const content  = section?.content ?? ''
          const chars    = content.length
          const overLimit = chars > SECTION_MAX_CHARS
          const nearLimit = chars > SECTION_MAX_CHARS * 0.85

          return (
            <div
              key={sectionId}
              className={`border rounded-lg overflow-hidden transition-colors ${
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

              {/* Textarea — só exibida quando enabled */}
              {enabled && (
                <div className="border-t border-blue-100 px-3 pb-3 pt-2 space-y-1.5">
                  <textarea
                    value={content}
                    onChange={e => handleContentChange(sectionId, e.target.value)}
                    disabled={disabled}
                    rows={4}
                    placeholder={SECTION_CATALOG[sectionId].placeholder}
                    className={`w-full border rounded-md px-3 py-2 text-sm font-mono leading-relaxed resize-y
                                focus:outline-none focus:ring-2 transition-colors
                                disabled:opacity-50 disabled:cursor-not-allowed ${
                      overLimit
                        ? 'border-red-300 focus:ring-red-400'
                        : nearLimit
                        ? 'border-amber-300 focus:ring-amber-400'
                        : 'border-gray-300 focus:ring-blue-400'
                    }`}
                  />
                  <div className="flex justify-end">
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

      {/* Painel de variáveis */}
      <VariablesPanel customFieldVariables={customFieldVariables} />

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
              ? <span className="text-gray-400 font-normal">({activeSections.length} seção{activeSections.length !== 1 ? 'ões' : ''} ativa{activeSections.length !== 1 ? 's' : ''})</span>
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
