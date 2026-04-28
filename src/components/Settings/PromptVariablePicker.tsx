/**
 * PromptVariablePicker
 *
 * Textarea enriquecida para edição de prompts avançados.
 *
 * Funcionalidades:
 *   - Autocomplete ativado ao digitar `{{` → lista de variáveis filtrada em tempo real
 *   - Clique ou Enter na variável insere `{{var_nome}}` na posição do cursor
 *   - Painel colapsível "Ver variáveis" com referência completa agrupada
 *   - Variáveis condicionais marcadas com ⚡ (preenchidas apenas quando o dado existe)
 *   - Escape ou foco fora fecha o autocomplete sem perder o texto
 *
 * Trigger de abertura:
 *   - `{`  → abre o picker (fácil de acionar)
 *   - `{{` → mantém o picker aberto e começa a filtrar
 *   - Digitar letras após `{{` → filtra por nome ou descrição da variável
 */

import { useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import {
  PROMPT_VARIABLES,
  PROMPT_VARIABLE_GROUPS,
} from '../../lib/promptVariables'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  value:      string
  onChange:   (v: string) => void
  rows?:      number
  disabled?:  boolean
  className?: string
}

// ── Detecção de trigger ───────────────────────────────────────────────────────

/**
 * Retorna o texto de filtro após `{{` se há um trigger ativo antes do cursor.
 * Retorna `null` se o picker deve ficar fechado.
 */
function detectTrigger(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos)

  // Verificar se há um único `{` no final (abre o picker vazio)
  if (before.endsWith('{') && !before.endsWith('{{')) {
    return ''
  }

  const lastDouble = before.lastIndexOf('{{')
  if (lastDouble === -1) return null

  const afterTrigger = before.slice(lastDouble + 2)

  // Fecha se já fechou com }} ou se tem espaço (usuário saiu do contexto)
  if (afterTrigger.includes('}}') || afterTrigger.includes(' ')) return null

  return afterTrigger.toLowerCase()
}

// ── Componente ────────────────────────────────────────────────────────────────

export function PromptVariablePicker({ value, onChange, rows = 22, disabled, className }: Props) {
  const textareaRef             = useRef<HTMLTextAreaElement>(null)
  const [filter, setFilter]     = useState<string | null>(null)  // null = picker fechado
  const [refOpen, setRefOpen]   = useState(false)

  const pickerOpen = filter !== null

  const filtered = pickerOpen
    ? PROMPT_VARIABLES.filter(v =>
        !filter ||
        v.variable.toLowerCase().includes(filter) ||
        v.description.toLowerCase().includes(filter)
      )
    : []

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newVal   = e.target.value
    onChange(newVal)
    const cursor   = e.target.selectionStart ?? 0
    setFilter(detectTrigger(newVal, cursor))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') setFilter(null)
  }

  // onMouseDown no dropdown usa e.preventDefault() para evitar que o blur
  // do textarea feche o picker antes do clique ser processado.
  function insertVariable(variable: string) {
    const ta = textareaRef.current
    if (!ta) return

    const cursor = ta.selectionStart ?? value.length
    const before = value.slice(0, cursor)

    // Determina o ponto de substituição: a partir de `{{` ou de `{` simples
    const lastDouble = before.lastIndexOf('{{')
    const lastSingle = before.lastIndexOf('{')
    const replaceFrom = lastDouble !== -1
      ? lastDouble
      : lastSingle !== -1 ? lastSingle : cursor

    const newValue = value.slice(0, replaceFrom) + variable + value.slice(cursor)
    onChange(newValue)
    setFilter(null)

    // Restaura foco e posiciona cursor após a variável inserida
    setTimeout(() => {
      ta.focus()
      const pos = replaceFrom + variable.length
      ta.setSelectionRange(pos, pos)
    }, 0)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-1.5">

      {/* ── Barra de info + toggle de referência ─────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          💡 Digite{' '}
          <code className="bg-gray-100 px-1 rounded font-mono text-gray-600 text-[11px]">
            {'{{'}
          </code>{' '}
          para inserir variáveis dinâmicas no prompt
        </p>
        <button
          type="button"
          onClick={() => setRefOpen(v => !v)}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap flex-shrink-0 transition-colors"
        >
          <BookOpen className="w-3 h-3" />
          {refOpen ? 'Ocultar' : 'Ver variáveis'}
          {refOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* ── Painel de referência colapsível ──────────────────────────────── */}
      {refOpen && (
        <div className="border border-blue-100 rounded-xl bg-blue-50/30 overflow-hidden">
          {/* Cabeçalho explicativo */}
          <div className="px-4 py-3 border-b border-blue-100 bg-blue-50 space-y-1">
            <p className="text-xs font-semibold text-blue-800">Como usar variáveis</p>
            <p className="text-xs text-blue-700 leading-relaxed">
              Escreva{' '}
              <code className="bg-white/80 px-1 rounded font-mono text-blue-900 text-[11px]">
                {'{{nome_empresa}}'}
              </code>{' '}
              no prompt e o sistema substitui pelo valor real em cada atendimento.{' '}
              <span className="text-amber-600 font-medium">⚡ Condicionais</span>
              {' '}só são preenchidas quando o dado existe (ex: lead sem e-mail → variável fica vazia).{' '}
              Clique em qualquer variável para inserir no cursor.
            </p>
          </div>

          {/* Lista agrupada */}
          <div className="max-h-52 overflow-y-auto divide-y divide-blue-50">
            {PROMPT_VARIABLE_GROUPS.map(group => (
              <div key={group}>
                <div className="px-4 py-1.5 bg-gray-50/80 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  {group}
                </div>
                <div>
                  {PROMPT_VARIABLES.filter(v => v.group === group).map(v => (
                    <button
                      key={v.variable}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); insertVariable(v.variable); setRefOpen(false) }}
                      className="w-full text-left px-4 py-1.5 hover:bg-blue-50 flex items-baseline gap-2 transition-colors group border-b border-gray-50 last:border-0"
                    >
                      <code className="font-mono text-[11px] text-blue-700 flex-shrink-0 group-hover:text-blue-900">
                        {v.variable}
                      </code>
                      <span className="text-xs text-gray-500 truncate">{v.description}</span>
                      {v.conditional && (
                        <span className="ml-auto text-[10px] text-amber-500 flex-shrink-0" title="Condicional">⚡</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Textarea + dropdown de autocomplete ──────────────────────────── */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setFilter(null), 150)}
          disabled={disabled}
          rows={rows}
          className={className}
        />

        {/* Dropdown de autocomplete — aparece abaixo do textarea */}
        {pickerOpen && filtered.length > 0 && (
          <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-white border border-blue-200 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto">

            {/* Cabeçalho do dropdown */}
            <div className="sticky top-0 px-3 py-2 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
              <p className="text-xs text-blue-700 font-medium">
                {filter
                  ? `Variáveis com "${filter}"`
                  : 'Selecione uma variável'
                }
              </p>
              <span className="text-[10px] text-blue-400">
                {filtered.length} disponíve{filtered.length !== 1 ? 'is' : 'l'}
              </span>
            </div>

            {/* Lista agrupada */}
            {PROMPT_VARIABLE_GROUPS.map(group => {
              const groupVars = filtered.filter(v => v.group === group)
              if (groupVars.length === 0) return null
              return (
                <div key={group}>
                  <div className="px-3 py-1 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    {group}
                  </div>
                  {groupVars.map(v => (
                    <button
                      key={v.variable}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); insertVariable(v.variable) }}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-baseline gap-2 border-b border-gray-50 last:border-0 transition-colors group"
                    >
                      <code className="font-mono text-xs text-blue-700 flex-shrink-0 group-hover:text-blue-900">
                        {v.variable}
                      </code>
                      <span className="text-xs text-gray-500 min-w-0 truncate">{v.description}</span>
                      {v.conditional && (
                        <span className="ml-auto text-[10px] text-amber-500 flex-shrink-0" title="Condicional — só preenchida quando o dado existe">
                          ⚡
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* Nenhum resultado */}
        {pickerOpen && filtered.length === 0 && filter && (
          <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl px-4 py-3">
            <p className="text-xs text-gray-500">
              Nenhuma variável com <strong>{filter}</strong>. Pressione Esc para fechar.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
