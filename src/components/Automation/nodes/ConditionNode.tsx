// =====================================================
// COMPONENT: CONDITION NODE
// Data: 13/03/2026
// Objetivo: Nó de condição para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { GitBranch, CheckCircle, AlertTriangle, Check, X } from 'lucide-react'

const ConditionNode = ({ data, selected }: NodeProps) => {
  const hasConfig = data.config?.field && data.config?.operator
  const conditionPreview = hasConfig 
    ? `Se: ${data.config.field} ${data.config.operator} ${data.config.value || ''}`
    : 'Clique para configurar condição'
  
  return (
    <div className={`bg-white rounded-lg shadow-lg border-2 min-w-[280px] max-w-[320px] transition-all ${
      selected ? 'border-yellow-600 ring-2 ring-yellow-300' : 'border-gray-200 hover:border-yellow-400'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-yellow-600 !border-2 !border-white"
      />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-yellow-500 to-yellow-600 px-4 py-2 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-white" />
            <span className="text-xs font-semibold text-white uppercase tracking-wide">
              Condição
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
      <div className="px-4 py-3 bg-gray-50">
        <div className="text-sm text-gray-700 font-mono">
          {conditionPreview}
        </div>
      </div>
      
      {/* Branches */}
      <div className="px-4 py-2 space-y-2 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-xs font-semibold text-green-700">Verdadeiro</span>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            className="!w-3 !h-3 !bg-green-600 !border-2 !border-white !right-[-12px]"
            style={{ top: '85px' }}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <X className="w-4 h-4 text-red-600" />
            <span className="text-xs font-semibold text-red-700">Falso</span>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            className="!w-3 !h-3 !bg-red-600 !border-2 !border-white !right-[-12px]"
            style={{ top: '115px' }}
          />
        </div>
      </div>
      
      {/* Stats */}
      {data.stats && (
        <div className="px-4 py-2 bg-blue-50 border-t border-gray-200 rounded-b-lg">
          <div className="flex items-center justify-between text-xs text-blue-700">
            <span className="text-green-600">✓ {data.stats.true || 0}</span>
            <span className="text-red-600">✗ {data.stats.false || 0}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(ConditionNode)
