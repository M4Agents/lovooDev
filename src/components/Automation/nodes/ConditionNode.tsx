// =====================================================
// COMPONENT: CONDITION NODE
// Data: 13/03/2026
// Objetivo: Nó de condição para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { GitBranch, CheckCircle, AlertTriangle, Check, X } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import NodeToolbar from './NodeToolbar'

// =====================================================
// HELPER: Gerar preview dinâmico da condição
// =====================================================
const getConditionPreview = (config: any): string => {
  if (!config || !config.field || !config.operator) {
    return 'Clique para configurar condição'
  }

  const operatorLabel: { [key: string]: string } = {
    'equals': '=',
    'not_equals': '≠',
    'contains': 'contém',
    'not_contains': 'não contém',
    'greater_than': '>',
    'less_than': '<',
    'greater_or_equal': '≥',
    'less_or_equal': '≤'
  }

  const operator = operatorLabel[config.operator] || config.operator
  const value = config.value || '(vazio)'
  
  return `Se: ${config.field} ${operator} ${value}`
}

const ConditionNode = ({ data, selected, id }: NodeProps) => {
  const conditionPreview = getConditionPreview(data.config)
  const hasConfig = !!(data.config?.field && data.config?.operator)
  const { setNodes, setEdges } = useReactFlow()

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
  
  return (
    <div className={`bg-white rounded shadow-sm border-2 w-36 transition-all overflow-visible relative ${
      selected ? 'border-yellow-600 ring-2 ring-yellow-300' : 'border-gray-200 hover:border-yellow-400'
    }`}>
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
        position={Position.Top}
        className="w-2 h-2 !bg-yellow-600 !border-2 !border-white"
      />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-yellow-500 to-yellow-600 px-2 py-1 rounded-t">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <GitBranch className="w-2.5 h-2.5 text-white" />
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">
              Condição
            </span>
          </div>
          {hasConfig ? (
            <CheckCircle className="w-2.5 h-2.5 text-green-300" />
          ) : (
            <AlertTriangle className="w-2.5 h-2.5 text-yellow-300" />
          )}
        </div>
      </div>
      
      {/* Content Preview */}
      <div className="px-2 py-1.5 bg-gray-50">
        <div className="text-[8px] text-gray-700 leading-tight">
          {conditionPreview}
        </div>
      </div>
      
      {/* Branches */}
      <div className="px-2 py-1 space-y-1 border-t border-gray-200 text-[7px] overflow-visible relative">
        <div className="flex items-center justify-between pr-2">
          <div className="flex items-center gap-1">
            <Check className="w-2 h-2 text-green-600" />
            <span className="text-green-700">Sim</span>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            className="absolute -right-1 w-2 h-2 rounded-full !bg-green-600 !border-2 !border-white"
            style={{ top: '8px' }}
          />
        </div>
        <div className="flex items-center justify-between pr-2">
          <div className="flex items-center gap-1">
            <X className="w-2 h-2 text-red-600" />
            <span className="text-red-700">Não</span>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            className="absolute -right-1 w-2 h-2 rounded-full !bg-red-600 !border-2 !border-white"
            style={{ top: '22px' }}
          />
        </div>
      </div>
      
      {/* Estatísticas */}
      <div className="flex items-center justify-between px-2 py-1 border-t border-gray-200 rounded-b">
        <div className="text-center flex-1">
          <div className="text-[7px] text-green-600">✓ {data.stats?.true || 0}</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-[7px] text-red-600">✗ {data.stats?.false || 0}</div>
        </div>
      </div>
    </div>
  )
}

export default memo(ConditionNode)
