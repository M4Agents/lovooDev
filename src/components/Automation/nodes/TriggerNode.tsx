// =====================================================
// COMPONENT: TRIGGER NODE
// Data: 13/03/2026
// Objetivo: Nó de gatilho para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Zap, CheckCircle, AlertTriangle, MessageCircle, UserPlus, Calendar } from 'lucide-react'

const TriggerNode = ({ data, selected }: NodeProps) => {
  const hasConfig = data.config?.triggerType
  const triggerType = data.config?.triggerType
  
  const getTriggerIcon = () => {
    switch (triggerType) {
      case 'new_message': return <MessageCircle className="w-4 h-4 text-white" />
      case 'new_lead': return <UserPlus className="w-4 h-4 text-white" />
      case 'schedule': return <Calendar className="w-4 h-4 text-white" />
      default: return <Zap className="w-4 h-4 text-white" />
    }
  }
  
  const getTriggerLabel = () => {
    switch (triggerType) {
      case 'new_message': return 'Nova Mensagem'
      case 'new_lead': return 'Novo Lead'
      case 'schedule': return 'Agendamento'
      default: return 'Gatilho'
    }
  }
  
  const getTriggerPreview = () => {
    if (!hasConfig) return 'Clique para configurar gatilho'
    
    switch (triggerType) {
      case 'new_message':
        return `💬 Quando receber mensagem${data.config.keyword ? `: "${data.config.keyword}"` : ''}`
      case 'new_lead':
        return `👤 Quando novo lead entrar${data.config.source ? ` via ${data.config.source}` : ''}`
      case 'schedule':
        return `📅 ${data.config.schedule || 'Agendamento configurado'}`
      default:
        return 'Gatilho configurado'
    }
  }
  
  return (
    <div className={`bg-white rounded-lg shadow-lg border-2 min-w-[280px] max-w-[320px] transition-all ${
      selected ? 'border-green-600 ring-2 ring-green-300' : 'border-gray-200 hover:border-green-400'
    }`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-green-500 to-green-600 px-4 py-2 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getTriggerIcon()}
            <span className="text-xs font-semibold text-white uppercase tracking-wide">
              {getTriggerLabel()}
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
          {getTriggerPreview()}
        </div>
      </div>
      
      {/* Stats */}
      {data.stats && (
        <div className="px-4 py-2 bg-blue-50 border-t border-gray-200 rounded-b-lg">
          <div className="flex items-center justify-center text-xs text-blue-700">
            <span>📊 Ativado: {data.stats.triggered || 0}x</span>
          </div>
        </div>
      )}
      
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-green-600 !border-2 !border-white"
      />
    </div>
  )
}

export default memo(TriggerNode)
