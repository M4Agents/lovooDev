// =====================================================
// COMPONENT: TRIGGER NODE
// Data: 13/03/2026
// @deprecated — Nó legado. O motor backend usa apenas o nó "start".
//   Mantido apenas para compatibilidade com flows antigos.
//   Não adicionar novos nodes deste tipo.
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
      case 'opportunity.created':
      case 'opportunity.stage_changed':
      case 'opportunity.won':
      case 'opportunity.lost':
      case 'opportunity.owner_assigned':
      case 'opportunity.owner_removed':
      case 'opportunity.restored': return <TrendingUp className="w-4 h-4 text-white" />
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
      case 'opportunity.created': return 'Oportunidade Criada'
      case 'opportunity.stage_changed': return 'Oportunidade Movida'
      case 'opportunity.won': return 'Oportunidade Ganha'
      case 'opportunity.lost': return 'Oportunidade Perdida'
      case 'opportunity.owner_assigned': return 'Vendedor Atribuído'
      case 'opportunity.owner_removed': return 'Vendedor Removido'
      case 'opportunity.restored': return 'Oportunidade Restaurada'
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
        
      // Gatilhos de Oportunidades
      case 'opportunity.created':
        let oppCreatedPreview = '💼 Quando oportunidade for criada'
        if (data.config.funnelName) {
          oppCreatedPreview += `\n📊 Funil: ${data.config.funnelName}`
        }
        if (data.config.initialStageName) {
          oppCreatedPreview += `\n📍 Etapa: ${data.config.initialStageName}`
        }
        if (data.config.minValue || data.config.maxValue) {
          const min = data.config.minValue ? `R$ ${data.config.minValue}` : '0'
          const max = data.config.maxValue ? `R$ ${data.config.maxValue}` : '∞'
          oppCreatedPreview += `\n💰 Valor: ${min} - ${max}`
        }
        return oppCreatedPreview
        
      case 'opportunity.stage_changed':
        let oppMovedPreview = '➡️ Quando oportunidade mudar de etapa'
        if (data.config.funnelName) {
          oppMovedPreview += `\n📊 Funil: ${data.config.funnelName}`
        }
        if (data.config.fromStageName && data.config.toStageName) {
          oppMovedPreview += `\n📍 De: ${data.config.fromStageName}`
          oppMovedPreview += `\n� Para: ${data.config.toStageName}`
        } else if (data.config.toStageName) {
          oppMovedPreview += `\n📍 Para: ${data.config.toStageName}`
        }
        if (data.config.minValue || data.config.maxValue) {
          const min = data.config.minValue ? `R$ ${data.config.minValue}` : '0'
          const max = data.config.maxValue ? `R$ ${data.config.maxValue}` : '∞'
          oppMovedPreview += `\n💰 ${min} - ${max}`
        }
        return oppMovedPreview
        
      case 'opportunity.won':
        let oppWonPreview = '🎉 Quando oportunidade for ganha'
        if (data.config.funnelName) {
          oppWonPreview += `\n📊 Funil: ${data.config.funnelName}`
        }
        if (data.config.minValue || data.config.maxValue) {
          const min = data.config.minValue ? `R$ ${data.config.minValue}` : '0'
          const max = data.config.maxValue ? `R$ ${data.config.maxValue}` : '∞'
          oppWonPreview += `\n💰 Valor: ${min} - ${max}`
        }
        return oppWonPreview
        
      case 'opportunity.lost':
        let oppLostPreview = '😔 Quando oportunidade for perdida'
        if (data.config.funnelName) {
          oppLostPreview += `\n📊 Funil: ${data.config.funnelName}`
        }
        if (data.config.lostReason) {
          const reasons: Record<string, string> = {
            'price': '💰 Preço',
            'timing': '⏰ Timing',
            'competitor': '🏆 Concorrente',
            'no_interest': '❌ Sem Interesse',
            'other': '📝 Outro'
          }
          oppLostPreview += `\n${reasons[data.config.lostReason] || data.config.lostReason}`
        }
        if (data.config.stageName) {
          oppLostPreview += `\n📍 Etapa: ${data.config.stageName}`
        }
        return oppLostPreview
        
      case 'opportunity.owner_assigned':
        let oppOwnerPreview = '👤 Quando vendedor for atribuído'
        if (data.config.funnelName) {
          oppOwnerPreview += `\n📊 Funil: ${data.config.funnelName}`
        }
        return oppOwnerPreview
        
      case 'opportunity.owner_removed':
        let oppOwnerRemovedPreview = '👤 Quando vendedor for removido'
        if (data.config.funnelName) {
          oppOwnerRemovedPreview += `\n📊 Funil: ${data.config.funnelName}`
        }
        return oppOwnerRemovedPreview
        
      case 'opportunity.restored':
        let oppRestoredPreview = '🔄 Quando oportunidade for restaurada'
        if (data.config.previousStatus) {
          const status = data.config.previousStatus === 'won' ? '🎉 Ganha' : '😔 Perdida'
          oppRestoredPreview += `\n📊 Status anterior: ${status}`
        }
        if (data.config.funnelName) {
          oppRestoredPreview += `\n📊 Funil: ${data.config.funnelName}`
        }
        return oppRestoredPreview
        
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
      selected ? 'border-amber-500 ring-2 ring-amber-200' : 'border-amber-300 hover:border-amber-400'
    }`}>
      {/* Badge de depreciação */}
      <div className="bg-amber-50 border-b border-amber-200 px-2 py-0.5 rounded-t-md flex items-center gap-1">
        <span className="text-[8px] font-semibold text-amber-700 uppercase tracking-wide">
          ⚠ Nó legado — não dispara
        </span>
      </div>
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-400 to-gray-500 px-2 py-1">
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
