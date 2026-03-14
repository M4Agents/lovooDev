// =====================================================
// COMPONENT: MESSAGE NODE
// Data: 14/03/2026
// Objetivo: Nó de mensagem para o canvas
// FASE 7.5 - UX Melhorada com preview de conteúdo
// =====================================================

import { Handle, Position, NodeProps } from 'reactflow'
import { MessageSquare, CheckCircle, AlertTriangle } from 'lucide-react'

const MessageNode = ({ data, selected }: NodeProps) => {
  const hasConfig = data.config?.message || data.config?.buttons?.length > 0
  const messagePreview = data.config?.message || 'Clique para configurar mensagem'
  const buttons = data.config?.buttons || []
  
  return (
    <div className={`bg-white rounded-lg shadow-lg border-2 min-w-[280px] max-w-[320px] transition-all ${
      selected ? 'border-purple-600 ring-2 ring-purple-300' : 'border-gray-200 hover:border-purple-400'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-purple-600 !border-2 !border-white"
      />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-4 py-2 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-white" />
            <span className="text-xs font-semibold text-white uppercase tracking-wide">
              Enviar WhatsApp
            </span>
          </div>
          {hasConfig ? (
            <CheckCircle className="w-4 h-4 text-green-300" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-yellow-300" />
          )}
        </div>
        {/* Instância WhatsApp */}
        {data.config?.instanceName && (
          <div className="mt-1 text-xs text-purple-100">
            📱 {data.config.instanceName}
          </div>
        )}
      </div>
      
      {/* Content Preview */}
      <div className="px-4 py-3 bg-gray-50">
        <div className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
          {messagePreview}
        </div>
      </div>
      
      {/* Buttons Preview */}
      {buttons.length > 0 && (
        <div className="px-4 py-2 space-y-1 border-t border-gray-200">
          {buttons.slice(0, 3).map((button: any, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-purple-400" />
              <span className="text-xs text-gray-600 truncate">{button.text}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`button-${index}`}
                className="!w-2 !h-2 !bg-purple-500 !border !border-white !right-[-8px]"
                style={{ top: `${60 + (index * 28)}px` }}
              />
            </div>
          ))}
          {buttons.length > 3 && (
            <div className="text-xs text-gray-400 pl-4">+{buttons.length - 3} mais</div>
          )}
        </div>
      )}
      
      {/* Stats */}
      {data.stats && (
        <div className="px-4 py-2 bg-blue-50 border-t border-gray-200 rounded-b-lg">
          <div className="flex items-center justify-between text-xs text-blue-700">
            <span>📊 Enviado: {data.stats.sent || 0}</span>
            <span>Aberto: {data.stats.opened || 0}</span>
          </div>
        </div>
      )}
      
      {/* Default source handle (when no buttons) */}
      {buttons.length === 0 && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="w-3 h-3 !bg-purple-600 !border-2 !border-white"
        />
      )}
    </div>
  )
}

export default MessageNode
