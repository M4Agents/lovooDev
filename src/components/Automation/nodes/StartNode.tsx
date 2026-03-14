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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 w-80">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-green-600 text-lg">▷</span>
        <h3 className="text-base font-semibold text-gray-900">
          Início
        </h3>
      </div>

      {/* Descrição */}
      <p className="text-sm text-gray-500 mb-4 leading-relaxed">
        O gatilho é responsável por acionar a automação. Clique para adicionar um gatilho:
      </p>

      {/* Botão */}
      <button
        onClick={data.onAddTrigger}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border-2 border-dashed border-blue-400 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium text-sm mb-4"
      >
        <Plus className="w-4 h-4" />
        Adicionar gatilho
      </button>

      {/* Info adicional */}
      <div className="flex items-center justify-center gap-1 text-xs text-gray-400 mb-4">
        <span>Quando o evento ocorrer, então</span>
        <span className="inline-block w-3 h-3 border border-gray-300 rounded-full"></span>
      </div>

      {/* Estatísticas */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="text-center flex-1">
          <div className="text-xl font-semibold text-gray-900">0</div>
          <div className="text-xs text-blue-600">Sucessos</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-xl font-semibold text-gray-900">0</div>
          <div className="text-xs text-blue-600">Alertas</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-xl font-semibold text-gray-900">0</div>
          <div className="text-xs text-blue-600">Erros</div>
        </div>
      </div>

      {/* Handle de saída (para conectar ao próximo nó) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-green-600 !border-2 !border-white"
      />
    </div>
  )
}
