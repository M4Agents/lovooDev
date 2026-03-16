// =====================================================
// COMPONENT: DELAY NODE
// Data: 13/03/2026
// Objetivo: Nó de delay/espera para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import NodeToolbar from './NodeToolbar'

// =====================================================
// HELPER: Traduzir unidades de tempo
// =====================================================
const getUnitLabel = (unit?: string): string => {
  switch (unit) {
    case 'seconds':
      return 'segundo(s)'
    case 'minutes':
      return 'minuto(s)'
    case 'hours':
      return 'hora(s)'
    case 'days':
      return 'dia(s)'
    default:
      return 'minuto(s)'
  }
}

// =====================================================
// HELPER: Gerar preview dinâmico do delay
// =====================================================
const getDelayPreview = (config: any): string => {
  // Verificar se tem configuração (duration pode ser 0)
  if (!config || (config.duration === undefined && config.duration === null)) {
    return 'Clique para configurar tempo'
  }

  const duration = config.duration ?? 0
  const unit = config.unit || 'minutes'
  
  return `Atraso de ${duration} ${getUnitLabel(unit)}`
}

const DelayNode = ({ data, selected, id }: NodeProps) => {
  const delayPreview = getDelayPreview(data.config)
  const hasConfig = !!(data.config?.duration !== undefined || data.config?.duration === 0)
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
      selected ? 'border-orange-600 ring-2 ring-orange-300' : 'border-gray-200 hover:border-orange-400'
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
      <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-2 py-1 rounded-t relative">
        <Handle
          type="target"
          position={Position.Left}
          className="absolute -left-1 w-2 h-2 rounded-full !bg-orange-600 !border-2 !border-white"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5 text-white" />
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">
              Aguardar
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
      <div className="px-2 py-2 bg-gray-50">
        <div className="text-center">
          <div className="text-xl mb-1">⏱️</div>
          <div className="text-[8px] font-semibold text-gray-700 leading-tight">
            {delayPreview}
          </div>
        </div>
      </div>
      
      {/* Opções de fluxo (estilo Datacraz) */}
      <div className="px-2 py-1 space-y-1 border-t border-gray-200 text-[7px] overflow-visible relative">
        <div className="flex items-center justify-end pr-2">
          <span className="text-gray-600">Próximo passo</span>
          <Handle
            type="source"
            position={Position.Right}
            id="next"
            className="absolute -right-1 w-2 h-2 rounded-full !bg-orange-500 !border-2 !border-white"
            style={{ top: '8px' }}
          />
        </div>
      </div>
      
      {/* Estatísticas */}
      <div className="flex items-center justify-center px-2 py-1 border-t border-gray-200 rounded-b">
        <div className="text-[7px] text-orange-600">
          {data.stats ? `⏳ ${data.stats.waiting || 0}` : '⏳ 0'}
        </div>
      </div>
    </div>
  )
}

export default memo(DelayNode)
