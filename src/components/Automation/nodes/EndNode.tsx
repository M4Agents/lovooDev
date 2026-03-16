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
    <div className={`bg-white rounded shadow-sm border-2 w-36 transition-all ${
      selected ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200 hover:border-red-300'
    }`}>
      
      {/* Header compacto */}
      <div className="bg-red-500 px-2 py-1 rounded-t relative">
        <Handle
          type="target"
          position={Position.Left}
          className="absolute -left-1 w-2 h-2 rounded-full !bg-red-500 !border-2 !border-white"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
        />
        <div className="flex items-center gap-1">
          <Flag className="w-2.5 h-2.5 text-white" />
          <span className="text-[10px] font-semibold text-white uppercase tracking-wider">
            Fim
          </span>
        </div>
      </div>
      
      {/* Content minimalista */}
      <div className="px-2 py-2 bg-gradient-to-b from-gray-50 to-white">
        <div className="text-center">
          <div className="text-lg mb-0.5">🏁</div>
          <div className="text-[10px] text-gray-500 font-medium">
            Finalizado
          </div>
        </div>
      </div>
      
      {/* Stats clean */}
      <div className="px-2 py-1 bg-white border-t border-gray-100 rounded-b">
        <div className="flex justify-between items-center text-[10px]">
          <span className="text-blue-600 font-semibold">{data.stats?.completed || 0}</span>
          <span className="text-gray-400">Sucessos</span>
        </div>
      </div>
    </div>
  )
}

export default memo(EndNode)
