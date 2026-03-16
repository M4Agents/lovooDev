// =====================================================
// COMPONENT: ACTION NODE
// Data: 13/03/2026
// Objetivo: Nó de ação para o canvas
// =====================================================

import { Handle, Position, NodeProps } from 'reactflow'
import { Target, CheckCircle, AlertTriangle, Tag, UserPlus, Trash2 } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import NodeToolbar from './NodeToolbar'

const ActionNode = ({ data, selected, id }: NodeProps) => {
  // FASE 7.5 - Novo design implementado em 14/03/2026
  const hasConfig = data.config?.actionType
  const actionType = data.config?.actionType
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
  
  const getActionIcon = () => {
    switch (actionType) {
      case 'add_tag': return <Tag className="w-4 h-4 text-white" />
      case 'remove_tag': return <Trash2 className="w-4 h-4 text-white" />
      case 'update_lead': return <UserPlus className="w-4 h-4 text-white" />
      default: return <Target className="w-4 h-4 text-white" />
    }
  }
  
  const getActionLabel = () => {
    switch (actionType) {
      case 'add_tag': return 'Adicionar Tag'
      case 'remove_tag': return 'Remover Tag'
      case 'update_lead': return 'Atualizar Lead'
      default: return 'Ação CRM'
    }
  }
  
  const getActionPreview = () => {
    if (!hasConfig) return 'Clique para configurar ação'
    
    switch (actionType) {
      case 'add_tag':
        return `🏷️ Adicionar: ${data.config.tagName || '(tag)'}`
      case 'remove_tag':
        return `🗑️ Remover: ${data.config.tagName || '(tag)'}`
      case 'update_lead':
        return `👤 Atualizar: ${data.config.field || '(campo)'}`
      default:
        return 'Ação configurada'
    }
  }
  
  return (
    <div className={`bg-white rounded shadow-sm border-2 w-36 transition-all overflow-visible relative ${
      selected ? 'border-blue-600 ring-2 ring-blue-300' : 'border-gray-200 hover:border-blue-400'
    }`}>
      {/* Toolbar - aparece apenas quando selecionado */}
      {selected && (
        <NodeToolbar
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onOpen={handleOpen}
        />
      )}
      
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-2 py-1 rounded-t relative">
        <Handle
          type="target"
          position={Position.Left}
          className="absolute -left-1 w-2 h-2 rounded-full !bg-blue-600 !border-2 !border-white"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 text-white">{getActionIcon()}</div>
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">
              Ação
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
          {getActionPreview()}
        </div>
      </div>
      
      {/* Opções de fluxo (estilo Datacraz) */}
      <div className="px-2 py-1 space-y-1 border-t border-gray-200 text-[7px] overflow-visible relative">
        <div className="flex items-center justify-end pr-2">
          <span className="text-gray-600">Caso ocorrer erro no envio</span>
          <Handle
            type="source"
            position={Position.Right}
            id="error"
            className="absolute -right-1 w-2 h-2 rounded-full !bg-red-500 !border-2 !border-white"
            style={{ top: '8px' }}
          />
        </div>
        <div className="flex items-center justify-end pr-2">
          <span className="text-gray-600">Próximo passo</span>
          <Handle
            type="source"
            position={Position.Right}
            id="next"
            className="absolute -right-1 w-2 h-2 rounded-full !bg-blue-500 !border-2 !border-white"
            style={{ top: '22px' }}
          />
        </div>
      </div>
      
      {/* Estatísticas */}
      <div className="flex items-center justify-between px-2 py-1 border-t border-gray-200 rounded-b">
        <div className="text-center flex-1">
          <div className="text-[10px] font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Sucessos</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-[10px] font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Alertas</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-[10px] font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Erros</div>
        </div>
      </div>
    </div>
  )
}

// Temporariamente sem memo() para forçar re-renderização
export default ActionNode
