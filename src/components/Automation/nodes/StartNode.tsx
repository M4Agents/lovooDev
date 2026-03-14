// =====================================================
// COMPONENT: START NODE
// Data: 14/03/2026
// Objetivo: Nó inicial arrastável do fluxo (estilo Datacraz)
// =====================================================

import { Handle, Position } from 'reactflow'
import { Plus } from 'lucide-react'

interface StartNodeProps {
  data: {
    onAddTrigger?: () => void
  }
}

export default function StartNode({ data }: StartNodeProps) {
  return (
    <div className="bg-white rounded-md shadow-sm border border-gray-200 p-3 w-48">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-green-600 text-sm">▷</span>
        <h3 className="text-xs font-semibold text-gray-900">
          Início
        </h3>
      </div>

      {/* Descrição */}
      <p className="text-[10px] text-gray-500 mb-2 leading-snug">
        O gatilho é responsável por acionar a automação. Clique para adicionar um gatilho:
      </p>

      {/* Botão */}
      <button
        onClick={data.onAddTrigger}
        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-white border border-dashed border-blue-400 text-blue-600 rounded hover:bg-blue-50 transition-colors font-medium text-[10px] mb-2"
      >
        <Plus className="w-3 h-3" />
        Adicionar gatilho
      </button>

      {/* Info adicional */}
      <div className="flex items-center justify-center gap-0.5 text-[9px] text-gray-400 mb-2">
        <span>Quando o evento ocorrer, então</span>
        <span className="inline-block w-2 h-2 border border-gray-300 rounded-full"></span>
      </div>

      {/* Estatísticas */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div className="text-center flex-1">
          <div className="text-sm font-semibold text-gray-900">0</div>
          <div className="text-[9px] text-blue-600">Sucessos</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-sm font-semibold text-gray-900">0</div>
          <div className="text-[9px] text-blue-600">Alertas</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-sm font-semibold text-gray-900">0</div>
          <div className="text-[9px] text-blue-600">Erros</div>
        </div>
      </div>

      {/* Handle de saída (para conectar ao próximo nó) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2.5 h-2.5 !bg-green-600 !border-2 !border-white"
      />
    </div>
  )
}
