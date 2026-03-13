// =====================================================
// COMPONENT: ACTION NODE
// Data: 13/03/2026
// Objetivo: Nó de ação para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Target, CheckCircle, AlertTriangle, Tag, UserPlus, Trash2 } from 'lucide-react'

const ActionNode = ({ data, selected }: NodeProps) => {
  const hasConfig = data.config?.actionType
  const actionType = data.config?.actionType
  
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
    <div className={`bg-white rounded-lg shadow-lg border-2 min-w-[280px] max-w-[320px] transition-all ${
      selected ? 'border-blue-600 ring-2 ring-blue-300' : 'border-gray-200 hover:border-blue-400'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-blue-600 !border-2 !border-white"
      />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getActionIcon()}
            <span className="text-xs font-semibold text-white uppercase tracking-wide">
              {getActionLabel()}
            </span>
          </div>
          {hasConfig ? (
            <CheckCircle className="w-4 h-4 text-green-300" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-yellow-300" />
          )}
        </div>
      </div>
      
      {/* Content Preview */}
      <div className="px-4 py-4 bg-gray-50">
        <div className="text-sm text-gray-700">
          {getActionPreview()}
        </div>
      </div>
      
      {/* Stats */}
      {data.stats && (
        <div className="px-4 py-2 bg-blue-50 border-t border-gray-200 rounded-b-lg">
          <div className="flex items-center justify-center text-xs text-blue-700">
            <span>📊 Executado: {data.stats.executed || 0}</span>
          </div>
        </div>
      )}
      
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-blue-600 !border-2 !border-white"
      />
    </div>
  )
}

export default memo(ActionNode)
