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
import NodeDebugBadge from './NodeDebugBadge'

// =====================================================
// HELPER: Gerar preview dinâmico da condição
// Suporta o formato novo (config.type) e o legado (config.field)
// =====================================================
const OP: Record<string, string> = {
  equals: '=', not_equals: '≠', contains: 'contém', not_contains: 'não contém',
  greater_than: '>', less_than: '<', greater_or_equal: '≥', less_or_equal: '≤',
  is_today: 'é hoje', is_yesterday: 'é ontem', is_this_week: 'esta semana',
  is_this_month: 'este mês', is_older_than: 'há mais de', is_newer_than: 'há menos de',
  has_tag: 'tem tag', not_has_tag: 'não tem tag', has_any_tag: 'tem alguma', has_all_tags: 'tem todas',
  is: '=', is_not: '≠', is_in: 'em', is_between: 'entre', is_before: 'antes de', is_after: 'após',
  has_no_owner: 'sem responsável', is_longer_than: 'mais de', is_shorter_than: 'menos de',
  never_interacted: 'nunca interagiu', is_first_day: '1º dia do mês', is_last_day: 'último dia do mês',
  is_empty: 'vazio', is_not_empty: 'preenchido',
}
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const getConditionPreview = (config: any): string => {
  if (!config) return 'Clique para configurar condição'

  const condType = config.type as string | undefined
  const op = OP[config.operator] || config.operator || ''

  if (condType) {
    switch (condType) {
      case 'lead_tags': {
        const tags: string[] = config.tags || []
        if (tags.length === 0) return 'Tag: (nenhuma configurada)'
        return `Tag: ${op} ${tags.length === 1 ? tags[0] : `${tags.length} tags`}`
      }
      case 'lead_field':
        if (!config.field) return 'Campo: (não configurado)'
        return `Se ${config.field} ${op} ${config.value ?? ''}`
      case 'lead_source':
        return `Origem ${op} ${config.value || '(vazia)'}`
      case 'lead_created_date':
        return `Data criação: ${op}${config.value ? ` ${config.value}` : ''}`
      case 'last_interaction':
        if (config.operator === 'never_interacted') return 'Nunca interagiu'
        return `Últ. interação: ${op} ${config.value || ''}`
      case 'lead_score':
        return `Score ${op} ${config.value ?? ''}`
      case 'opportunity_stage':
        return `Etapa ${op} ${config.value || ''}`
      case 'opportunity_value':
        return `Valor ${op} ${config.value ?? ''}`
      case 'opportunity_owner':
        if (config.operator === 'has_no_owner') return 'Sem responsável'
        return `Responsável ${op} ${config.value || ''}`
      case 'opportunity_stage_duration':
        return `Tempo na etapa ${op} ${config.value || ''}`
      case 'day_of_week': {
        const dayLabel = typeof config.value === 'number' ? DAYS[config.value] : config.value
        return `Dia ${op} ${dayLabel || ''}`
      }
      case 'time_of_day':
        if (config.operator === 'is_between' && config.value)
          return `Hora entre ${config.value.start || '?'}–${config.value.end || '?'}`
        return `Hora ${op} ${config.value || ''}`
      case 'day_of_month':
        if (config.operator === 'is_first_day') return '1º dia do mês'
        if (config.operator === 'is_last_day') return 'Último dia do mês'
        if (config.operator === 'is_between' && config.value)
          return `Dia entre ${config.value.start || '?'}–${config.value.end || '?'}`
        return `Dia ${op} ${config.value || ''}`
      default:
        return `Condição: ${condType}`
    }
  }

  // Formato legado (sem config.type)
  if (!config.field || !config.operator) return 'Clique para configurar condição'
  return `Se: ${config.field} ${op} ${config.value || '(vazio)'}`
}

const ConditionNode = ({ data, selected, id }: NodeProps) => {
  const conditionPreview = getConditionPreview(data.config)
  const hasConfig = !!(
    (data.config?.type && data.config?.operator) ||
    (data.config?.field && data.config?.operator)
  )
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
      <NodeDebugBadge debugStatus={data.debugStatus} />

      {/* Toolbar - aparece apenas quando selecionado */}
      {selected && (
        <NodeToolbar
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onOpen={handleOpen}
        />
      )}
      
      {/* Header */}
      <div className="bg-gradient-to-r from-yellow-500 to-yellow-600 px-2 py-1 rounded-t relative">
        <Handle
          type="target"
          position={Position.Left}
          className="absolute -left-1 w-2 h-2 rounded-full !bg-yellow-600 !border-2 !border-white"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
        />
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
