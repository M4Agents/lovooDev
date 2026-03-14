// =====================================================
// COMPONENT: TRIGGER NODE
// Data: 13/03/2026
// Objetivo: Nó de gatilho para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Zap, CheckCircle, AlertTriangle, MessageCircle, UserPlus, Calendar, Tag, TrendingUp } from 'lucide-react'

const TriggerNode = ({ data, selected }: NodeProps) => {
  const hasConfig = data.config?.triggerType
  const triggerType = data.config?.triggerType
  
  const getTriggerIcon = () => {
    switch (triggerType) {
      case 'message.received': return <MessageCircle className="w-4 h-4 text-white" />
      case 'message.sent': return <MessageCircle className="w-4 h-4 text-white" />
      case 'lead.created': return <UserPlus className="w-4 h-4 text-white" />
      case 'tag.added':
      case 'tag.removed': return <Tag className="w-4 h-4 text-white" />
      case 'deal.created':
      case 'deal.moved':
      case 'deal.won':
      case 'deal.lost': return <TrendingUp className="w-4 h-4 text-white" />
      case 'schedule.time': return <Calendar className="w-4 h-4 text-white" />
      // Compatibilidade com tipos antigos
      case 'new_message': return <MessageCircle className="w-4 h-4 text-white" />
      case 'new_lead': return <UserPlus className="w-4 h-4 text-white" />
      case 'schedule': return <Calendar className="w-4 h-4 text-white" />
      default: return <Zap className="w-4 h-4 text-white" />
    }
  }
  
  const getTriggerLabel = () => {
    switch (triggerType) {
      case 'message.received': return 'Mensagem Recebida'
      case 'message.sent': return 'Mensagem Enviada'
      case 'lead.created': return 'Lead Criado'
      case 'tag.added': return 'Tag Adicionada'
      case 'tag.removed': return 'Tag Removida'
      case 'deal.created': return 'Negócio Criado'
      case 'deal.moved': return 'Negócio Movido'
      case 'deal.won': return 'Negócio Ganho'
      case 'deal.lost': return 'Negócio Perdido'
      case 'schedule.time': return 'Agendamento'
      // Compatibilidade com tipos antigos
      case 'new_message': return 'Nova Mensagem'
      case 'new_lead': return 'Novo Lead'
      case 'schedule': return 'Agendamento'
      default: return 'Gatilho'
    }
  }
  
  const getComparisonLabel = (type: string) => {
    const labels: Record<string, string> = {
      'contains': 'Contém',
      'equals': 'É igual',
      'starts_with': 'Começa com',
      'ends_with': 'Termina com',
      'regex': 'Regex',
      'not_contains': 'Não contém',
      'not_equals': 'Diferente de'
    }
    return labels[type] || type
  }
  
  const getTriggerPreview = () => {
    if (!hasConfig) return 'Clique para configurar gatilho'
    
    switch (triggerType) {
      case 'message.received':
        const keywords = data.config.keywords || []
        const comparisonType = data.config.comparisonType || 'contains'
        const instanceName = data.config.instanceName
        
        let preview = '📥 Quando receber mensagem'
        if (keywords.length > 0) {
          const keywordText = keywords.slice(0, 2).map((k: string) => `"${k}"`).join(', ')
          const moreText = keywords.length > 2 ? ` +${keywords.length - 2}` : ''
          preview += `\n🔑 ${getComparisonLabel(comparisonType)}: ${keywordText}${moreText}`
        }
        if (instanceName) {
          preview += `\n📱 ${instanceName}`
        }
        return preview
        
      case 'lead.created':
        return `👤 Quando novo lead for criado`
        
      case 'tag.added':
        const tagName = data.config.tagName
        return `🏷️ Quando tag for adicionada${tagName ? `: ${tagName}` : ''}`
        
      case 'deal.created':
        return `💼 Quando negócio for criado`
        
      case 'deal.moved':
        return `➡️ Quando negócio mudar de etapa`
        
      // Compatibilidade com tipos antigos
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
    <div className={`bg-white rounded-md shadow-md border-2 min-w-[140px] max-w-[170px] transition-all ${
      selected ? 'border-green-600 ring-2 ring-green-300' : 'border-gray-200 hover:border-green-400'
    }`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-green-500 to-green-600 px-2 py-1 rounded-t-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {getTriggerIcon()}
            <span className="text-[9px] font-semibold text-white uppercase tracking-tight">
              {getTriggerLabel()}
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
        <div className="text-[10px] text-gray-700 whitespace-pre-line leading-tight">
          {getTriggerPreview()}
        </div>
      </div>
      
      {/* Stats */}
      {data.stats && (
        <div className="px-2 py-1 bg-blue-50 border-t border-gray-200 rounded-b-md">
          <div className="flex items-center justify-center text-[9px] text-blue-700">
            <span>📊 {data.stats.triggered || 0}x</span>
          </div>
        </div>
      )}
      
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2 h-2 !bg-green-600 !border-2 !border-white"
      />
    </div>
  )
}

export default memo(TriggerNode)
