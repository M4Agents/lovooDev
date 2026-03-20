import React from 'react'
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow'
import { Shuffle, Settings, CheckCircle, AlertTriangle } from 'lucide-react'
import NodeToolbar from './NodeToolbar'

export default function DistributionNode({ data, selected, id }: NodeProps) {
  const { setNodes, setEdges } = useReactFlow()
  const config = data.config || {}

  const handleDelete = () => {
    setNodes((nodes) => nodes.filter((node) => node.id !== id))
    setEdges((edges) => edges.filter((edge) => edge.source !== id && edge.target !== id))
  }

  const handleDuplicate = () => {
    setNodes((nodes) => {
      const nodeToDuplicate = nodes.find((node) => node.id === id)
      if (!nodeToDuplicate) return nodes

      const newNode = {
        ...nodeToDuplicate,
        id: `${nodeToDuplicate.type}-${Date.now()}`,
        position: {
          x: nodeToDuplicate.position.x + 50,
          y: nodeToDuplicate.position.y + 50
        },
        selected: false
      }

      return [...nodes, newNode]
    })
  }

  const handleOpen = () => {
    if (data.onSelect) {
      data.onSelect()
    }
  }

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
        bg-white rounded shadow-sm border-2 w-36 transition-all overflow-visible relative
        ${selected ? 'border-cyan-500 ring-2 ring-cyan-300' : 'border-gray-200 hover:border-cyan-400'}
      `}
    >
      {/* Toolbar - aparece apenas quando selecionado */}
      {selected && (
        <NodeToolbar
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onOpen={handleOpen}
        />
      )}

      <Handle
        type="target"
        position={Position.Left}
        className="absolute -left-1 w-2 h-2 rounded-full !bg-cyan-500 !border-2 !border-white"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      />

      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-500 to-cyan-600 px-2 py-1 rounded-t relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Shuffle className="w-2.5 h-2.5 text-white" />
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">
              Distribuição
            </span>
          </div>
          {config?.method ? (
            <CheckCircle className="w-2.5 h-2.5 text-green-300" />
          ) : (
            <AlertTriangle className="w-2.5 h-2.5 text-yellow-300" />
          )}
        </div>
      </div>

      {/* Content Preview */}
      <div className="px-2 py-1.5 bg-gray-50">
        <div className="text-[8px] text-gray-700 leading-tight">
          {getPreview()}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="absolute -right-1 w-2 h-2 rounded-full !bg-cyan-500 !border-2 !border-white"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>
  )
}
