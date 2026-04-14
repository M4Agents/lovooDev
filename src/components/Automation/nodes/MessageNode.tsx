// =====================================================
// COMPONENT: MESSAGE NODE
// Data: 14/03/2026
// Objetivo: Nó de mensagem para o canvas
// FASE 7.5 - UX Melhorada com preview de conteúdo
// =====================================================

import { Handle, Position, NodeProps } from 'reactflow'
import { MessageSquare, MessageCircle, CheckCircle, AlertTriangle, AlignLeft, Clock, Mic, Paperclip, Link } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import NodeToolbar from './NodeToolbar'
import NodeDebugBadge from './NodeDebugBadge'

// =====================================================
// HELPER: Traduzir unidades de tempo
// =====================================================
const getUnitLabel = (unit?: string): string => {
  switch (unit) {
    case 'seconds':
      return 'segundos'
    case 'minutes':
      return 'minutos'
    case 'hours':
      return 'horas'
    case 'days':
      return 'dias'
    default:
      return 'minutos'
  }
}

// =====================================================
// HELPER: Gerar preview dinâmico baseado no tipo
// =====================================================
const getMessagePreview = (config: any) => {
  if (!config || !config.messageType) {
    return {
      icon: <MessageSquare className="w-2.5 h-2.5 text-white" />,
      title: 'WhatsApp',
      preview: 'Clique para configurar mensagem',
      hasConfig: false
    }
  }

  switch (config.messageType) {
    case 'text':
      return {
        icon: <MessageCircle className="w-2.5 h-2.5 text-white" />,
        title: 'Mensagem de texto',
        preview: config.message || 'Clique para configurar mensagem',
        hasConfig: !!config.message
      }
    
    case 'user_input':
      return {
        icon: <MessageSquare className="w-2.5 h-2.5 text-white" />,
        title: 'Entrada do usuário',
        preview: config.question || 'Aguardando resposta do usuário',
        hasConfig: !!config.question
      }
    
    case 'delay':
      return {
        icon: <Clock className="w-2.5 h-2.5 text-white" />,
        title: 'Atraso de tempo',
        preview: `Atraso de ${config.duration ?? 0} ${getUnitLabel(config.unit)}`,
        hasConfig: (config.duration !== undefined && config.duration !== null)
      }
    
    case 'audio':
      return {
        icon: <Mic className="w-2.5 h-2.5 text-white" />,
        title: 'Mensagem de áudio',
        preview: (config.audioFile || config.audioUrl) ? '🎤 Áudio configurado' : '✕ Áudio ausente',
        hasConfig: !!(config.audioFile || config.audioUrl)
      }
    
    case 'file':
      const fileTypeLabel = config.fileType === 'image' ? 'Imagem' : config.fileType === 'video' ? 'Vídeo' : 'Documento'
      return {
        icon: <Paperclip className="w-2.5 h-2.5 text-white" />,
        title: 'Arquivo anexo',
        preview: (config.file || config.fileUrl) ? `📎 ${fileTypeLabel} configurado` : '✕ Arquivo ausente',
        hasConfig: !!(config.file || config.fileUrl),
        thumbnailUrl: (config.fileType === 'image' || config.fileType === 'video') ? config.fileUrl : null,
        fileType: config.fileType
      }
    
    case 'dynamic_url':
      return {
        icon: <Link className="w-2.5 h-2.5 text-white" />,
        title: 'Arquivo URL Dinâmica',
        preview: config.url || '🔗 URL não configurada',
        hasConfig: !!config.url
      }
    
    default:
      return {
        icon: <MessageSquare className="w-2.5 h-2.5 text-white" />,
        title: 'WhatsApp',
        preview: 'Tipo desconhecido',
        hasConfig: false
      }
  }
}

const MessageNode = ({ data, selected, id }: NodeProps) => {
  
  const preview = getMessagePreview(data.config)
  const buttons = data.config?.buttons || []
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
    // Trigger node selection to open config panel
    if (data.onSelect) {
      data.onSelect()
    }
  }
  
  return (
    <div className={`bg-white rounded shadow-sm border-2 w-36 transition-all overflow-visible relative ${
      selected ? 'border-purple-600 ring-2 ring-purple-300' : 'border-gray-200 hover:border-purple-400'
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
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-2 py-1 rounded-t relative">
        <Handle
          type="target"
          position={Position.Left}
          className="absolute -left-1 w-2 h-2 rounded-full !bg-purple-600 !border-2 !border-white"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {preview.icon}
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">
              {preview.title}
            </span>
          </div>
          {preview.hasConfig ? (
            <CheckCircle className="w-2.5 h-2.5 text-green-300" />
          ) : (
            <AlertTriangle className="w-2.5 h-2.5 text-yellow-300" />
          )}
        </div>
      </div>
      
      {/* Content Preview */}
      <div className="px-2 py-1.5 bg-gray-50">
        {preview.thumbnailUrl ? (
          <div className="space-y-1">
            {preview.fileType === 'video' ? (
              <video 
                src={preview.thumbnailUrl} 
                className="w-full h-16 object-cover rounded border border-gray-200"
                muted
                preload="metadata"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  const parent = e.currentTarget.parentElement
                  if (parent) {
                    parent.innerHTML = `<div class="flex items-start gap-1"><span class="text-[8px] text-gray-700">${preview.preview}</span></div>`
                  }
                }}
              />
            ) : (
              <img 
                src={preview.thumbnailUrl} 
                alt="Preview"
                className="w-full h-16 object-cover rounded border border-gray-200"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  const parent = e.currentTarget.parentElement
                  if (parent) {
                    parent.innerHTML = `<div class="flex items-start gap-1"><span class="text-[8px] text-gray-700">${preview.preview}</span></div>`
                  }
                }}
              />
            )}
            <span className="text-[8px] text-gray-600 line-clamp-1 leading-tight">
              {preview.preview}
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <AlignLeft className="w-2.5 h-2.5 text-gray-400 flex-shrink-0 mt-0.5" />
            <span className="text-[8px] text-gray-700 line-clamp-2 leading-tight">
              {preview.preview}
            </span>
          </div>
        )}
      </div>
      
      {/* Buttons Preview */}
      {buttons.length > 0 && (
        <div className="px-2 py-1 space-y-0.5 border-t border-gray-200">
          {buttons.slice(0, 3).map((button: any, index: number) => (
            <div key={index} className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span className="text-[7px] text-gray-600 truncate">{button.text}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={`button-${index}`}
                className="!w-2 !h-2 !bg-purple-500 !border !border-white !right-[-8px]"
                style={{ top: `${40 + (index * 20)}px` }}
              />
            </div>
          ))}
          {buttons.length > 3 && (
            <div className="text-xs text-gray-400 pl-4">+{buttons.length - 3} mais</div>
          )}
        </div>
      )}
      
      {/* Opções de fluxo (estilo Datacraz) */}
      <div className="px-2 py-1 space-y-1 border-t border-gray-200 text-[7px] overflow-visible relative">
        <div className="flex items-center justify-end pr-2">
          <span className="text-gray-600">Caso ocorrer erro no envio</span>
          <Handle
            type="source"
            position={Position.Right}
            id="error"
            className="absolute -right-1 w-2 h-2 rounded-full !bg-red-500 !border-2 !border-white"
            style={{ top: '8px' }}
          />
        </div>
        <div className="flex items-center justify-end pr-2">
          <span className="text-gray-600">Próximo passo</span>
          <Handle
            type="source"
            position={Position.Right}
            id="next"
            className="absolute -right-1 w-2 h-2 rounded-full !bg-blue-500 !border-2 !border-white"
            style={{ top: '22px' }}
          />
        </div>
      </div>
      
      {/* Estatísticas */}
      <div className="flex items-center justify-between px-2 py-1 border-t border-gray-200 rounded-b">
        <div className="text-center flex-1">
          <div className="text-[10px] font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Sucessos</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-[10px] font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Alertas</div>
        </div>
        <div className="text-center flex-1">
          <div className="text-[10px] font-semibold text-gray-900">0</div>
          <div className="text-[7px] text-blue-600">Erros</div>
        </div>
      </div>
    </div>
  )
}

export default MessageNode
