/**
 * AgentToolsSelector
 *
 * Seção de configuração de ações do agente.
 * Exibe checkboxes por categoria com descrições curtas e não técnicas.
 *
 * Comportamento:
 *   - Nenhum item marcado por padrão em novos agentes (controlled pelo pai)
 *   - Exibe aviso âmbar quando nenhuma ação está selecionada
 *   - Aviso não bloqueia o save — agente puramente conversacional é válido
 *   - Estado totalmente controlado via props (selectedTools / onChange)
 */

import { AlertTriangle } from 'lucide-react'
import {
  TOOL_CATALOG,
  TOOL_CATEGORY_LABELS,
  TOOL_CATEGORY_ORDER,
  type ToolCategory,
} from '../../lib/agents/toolCatalog'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface AgentToolsSelectorProps {
  selectedTools: string[]
  onChange:      (tools: string[]) => void
  disabled?:     boolean
}

// ── Componente ────────────────────────────────────────────────────────────────

export function AgentToolsSelector({ selectedTools, onChange, disabled = false }: AgentToolsSelectorProps) {
  function toggle(key: string) {
    if (disabled) return
    if (selectedTools.includes(key)) {
      onChange(selectedTools.filter(t => t !== key))
    } else {
      onChange([...selectedTools, key])
    }
  }

  // Agrupar tools por categoria na ordem canônica
  const byCategory = TOOL_CATEGORY_ORDER.reduce<Record<ToolCategory, typeof TOOL_CATALOG>>((acc, cat) => {
    acc[cat] = TOOL_CATALOG.filter(t => t.category === cat)
    return acc
  }, {} as Record<ToolCategory, typeof TOOL_CATALOG>)

  // eslint-disable-next-line no-console
  console.log('[AgentToolsSelector] tools:', TOOL_CATALOG.map(t => t.key))

  const hasNoneSelected = selectedTools.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-700">Ações do agente</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Selecione o que este agente pode executar automaticamente no sistema
          </p>
        </div>
        {selectedTools.length > 0 && (
          <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
            {selectedTools.length} {selectedTools.length === 1 ? 'ação' : 'ações'}
          </span>
        )}
      </div>

      {/* Grid de categorias */}
      <div className="grid grid-cols-1 gap-3">
        {TOOL_CATEGORY_ORDER.map(category => {
          const tools = byCategory[category]
          if (!tools.length) return null

          return (
            <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  {TOOL_CATEGORY_LABELS[category]}
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                {tools.map(tool => {
                  const isChecked = selectedTools.includes(tool.key)
                  return (
                    <label
                      key={tool.key}
                      className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                        disabled
                          ? 'opacity-60 cursor-not-allowed'
                          : 'hover:bg-blue-50'
                      } ${isChecked ? 'bg-blue-50' : 'bg-white'}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(tool.key)}
                        disabled={disabled}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600
                                   focus:ring-blue-500 cursor-pointer flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${isChecked ? 'text-blue-800' : 'text-gray-700'}`}>
                          {tool.label}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                          {tool.description}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Aviso — sem ação selecionada */}
      {hasNoneSelected && (
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 leading-relaxed">
            Nenhuma ação selecionada. Este agente será apenas conversacional e não poderá
            executar ações no sistema.
          </p>
        </div>
      )}
    </div>
  )
}
