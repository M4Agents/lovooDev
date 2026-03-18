// =====================================================
// COMPONENT: VARIABLE AUTOCOMPLETE
// Data: 17/03/2026
// Objetivo: Dropdown de autocomplete para variáveis
// =====================================================

import { Variable, getCategoryIcon, getCategoryLabel } from '../../hooks/useVariables'

interface VariableAutocompleteProps {
  variables: Variable[]
  position: { top: number; left: number }
  onSelect: (variableKey: string) => void
  filter: string
}

export default function VariableAutocomplete({
  variables,
  position,
  onSelect,
  filter
}: VariableAutocompleteProps) {
  
  // Filtrar variáveis baseado no texto digitado
  const filteredVariables = variables.filter(v => 
    v.key.toLowerCase().includes(filter.toLowerCase()) ||
    v.label.toLowerCase().includes(filter.toLowerCase())
  )

  // Agrupar por categoria
  const groupedVariables = filteredVariables.reduce((acc, variable) => {
    if (!acc[variable.category]) {
      acc[variable.category] = []
    }
    acc[variable.category].push(variable)
    return acc
  }, {} as Record<string, Variable[]>)

  // Ordem das categorias
  const categoryOrder: Variable['category'][] = ['lead', 'empresa', 'custom', 'sistema']

  if (filteredVariables.length === 0) {
    return (
      <div 
        className="absolute bg-white border border-gray-300 shadow-lg rounded-lg p-3 z-50 w-80"
        style={{ top: position.top + 25, left: position.left }}
      >
        <p className="text-sm text-gray-500 text-center">
          Nenhuma variável encontrada
        </p>
      </div>
    )
  }

  return (
    <div 
      className="absolute bg-white border border-gray-300 shadow-lg rounded-lg max-h-96 overflow-y-auto z-50 w-80"
      style={{ top: position.top + 25, left: position.left }}
    >
      {categoryOrder.map(category => {
        const categoryVars = groupedVariables[category]
        if (!categoryVars || categoryVars.length === 0) return null

        return (
          <div key={category}>
            {/* Header da categoria */}
            <div className="sticky top-0 px-3 py-2 bg-gray-100 border-b border-gray-200 text-xs font-semibold text-gray-700">
              {getCategoryIcon(category)} {getCategoryLabel(category)}
            </div>

            {/* Variáveis da categoria */}
            {categoryVars.map(variable => (
              <button
                key={variable.key}
                onClick={() => onSelect(variable.key)}
                className="w-full px-3 py-2 text-left hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                type="button"
              >
                <div className="flex items-start gap-2">
                  <code className="text-sm font-mono text-blue-600 flex-shrink-0">
                    {`{{${variable.key}}}`}
                  </code>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {variable.label}
                    </p>
                    {variable.description && (
                      <p className="text-xs text-gray-500 truncate">
                        {variable.description}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )
      })}

      {/* Footer com dica */}
      <div className="sticky bottom-0 px-3 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
        💡 Digite para filtrar • Enter para selecionar • Esc para fechar
      </div>
    </div>
  )
}
