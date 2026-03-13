// =====================================================
// COMPONENT: END NODE
// Data: 13/03/2026
// Objetivo: Nó de finalização para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Flag, CheckCircle } from 'lucide-react'

const EndNode = ({ data, selected }: NodeProps) => {
  return (
    <div className={`bg-white rounded-lg shadow-lg border-2 min-w-[280px] max-w-[320px] transition-all ${
      selected ? 'border-red-600 ring-2 ring-red-300' : 'border-gray-200 hover:border-red-400'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-red-600 !border-2 !border-white"
      />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-red-500 to-red-600 px-4 py-2 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-white" />
            <span className="text-xs font-semibold text-white uppercase tracking-wide">
              Fim do Fluxo
            </span>
          </div>
          <CheckCircle className="w-4 h-4 text-green-300" />
        </div>
      </div>
      
      {/* Content Preview */}
      <div className="px-4 py-6 bg-gray-50">
        <div className="text-center">
          <div className="text-3xl mb-2">🏁</div>
          <div className="text-sm text-gray-700 font-medium">
            Automação finalizada
          </div>
        </div>
      </div>
      
      {/* Stats */}
      {data.stats && (
        <div className="px-4 py-2 bg-blue-50 border-t border-gray-200 rounded-b-lg">
          <div className="flex items-center justify-center text-xs text-blue-700">
            <span>📊 Finalizado: {data.stats.completed || 0}x</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(EndNode)
