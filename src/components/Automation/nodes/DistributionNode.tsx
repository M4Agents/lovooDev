import React from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Shuffle, Trash2, Copy, Settings } from 'lucide-react'

export default function DistributionNode({ data, selected }: NodeProps) {
  const getMethodLabel = (method: string) => {
    const labels: Record<string, string> = {
      round_robin: 'Rodízio',
      availability: 'Disponibilidade',
      workload: 'Carga de Trabalho',
      region: 'Por Região'
    }
    return labels[method] || method
  }

  const getPreview = () => {
    const config = data.config
    
    if (!config || !config.method) {
      return 'Clique para configurar distribuição'
    }

    const method = getMethodLabel(config.method)
    const userCount = config.users?.length || 0
    
    if (userCount === 0) {
      return `${method} - Nenhum usuário selecionado`
    }

    return `${method} - ${userCount} usuário${userCount > 1 ? 's' : ''}`
  }

  return (
    <div
      className={`
        bg-white rounded-lg shadow-md border-2 transition-all
        ${selected ? 'border-cyan-500 shadow-lg' : 'border-cyan-300'}
        hover:shadow-lg
        min-w-[280px]
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-cyan-500"
      />

      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500 flex items-center justify-center flex-shrink-0">
            <Shuffle className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-cyan-600 uppercase tracking-wide">
              Distribuição
            </div>
            <div className="text-sm font-semibold text-gray-900 truncate">
              {data.label || 'Distribuir Lead'}
            </div>
          </div>
        </div>

        <div className="bg-cyan-50 rounded-md p-3 mb-3">
          <div className="text-xs text-cyan-900 font-medium">
            {getPreview()}
          </div>
        </div>

        {data.stats && (
          <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-200">
            <span>✓ {data.stats.executions || 0} execuções</span>
            <span>⚡ {data.stats.success_rate || 0}% sucesso</span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 px-4 py-2 bg-gray-50 rounded-b-lg flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.(data.id)
            }}
            className="p-1.5 hover:bg-red-100 rounded text-red-600 transition-colors"
            title="Deletar"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              data.onDuplicate?.(data.id)
            }}
            className="p-1.5 hover:bg-gray-200 rounded text-gray-600 transition-colors"
            title="Duplicar"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            data.onOpen?.(data.id)
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-cyan-600 hover:bg-cyan-100 rounded transition-colors"
        >
          <Settings className="w-3 h-3" />
          Configurar
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-cyan-500"
      />
    </div>
  )
}
