// =====================================================
// COMPONENT: MESSAGE TYPE SELECTOR
// Data: 15/03/2026
// Objetivo: Seletor de tipos de mensagem (estilo Datacraz)
// =====================================================

import { AlignLeft, MessageSquare, Clock, Mic, Paperclip, Link } from 'lucide-react'

export interface MessageType {
  id: 'text' | 'user_input' | 'delay' | 'audio' | 'file' | 'dynamic_url'
  label: string
  icon: React.ReactNode
  description?: string
  /** Quando true: exibido mas desabilitado — use o nó Delay dedicado no canvas */
  disabled?: boolean
  disabledReason?: string
}

export const MESSAGE_TYPES: MessageType[] = [
  {
    id: 'text',
    label: 'Mensagem de texto',
    icon: <AlignLeft className="w-4 h-4" />,
    description: 'Envie mensagem de texto simples'
  },
  {
    id: 'user_input',
    label: 'Entrada do usuário',
    icon: <MessageSquare className="w-4 h-4" />,
    description: 'Aguarde resposta do usuário'
  },
  {
    id: 'delay',
    label: 'Atraso de tempo',
    icon: <Clock className="w-4 h-4" />,
    description: 'Use o nó "Espera" no canvas',
    disabled: true,
    disabledReason: 'Use o nó Delay'
  },
  {
    id: 'audio',
    label: 'Mensagem de áudio',
    icon: <Mic className="w-4 h-4" />,
    description: 'Envie arquivo de áudio'
  },
  {
    id: 'file',
    label: 'Arquivo anexo',
    icon: <Paperclip className="w-4 h-4" />,
    description: 'Envie documento ou imagem'
  },
  {
    id: 'dynamic_url',
    label: 'Arquivo URL Dinâmica',
    icon: <Link className="w-4 h-4" />,
    description: 'Envie arquivo via URL'
  }
]

interface MessageTypeSelectorProps {
  onSelectType: (typeId: MessageType['id']) => void
}

export default function MessageTypeSelector({ onSelectType }: MessageTypeSelectorProps) {
  return (
    <div className="space-y-1">
      {MESSAGE_TYPES.map((type) => (
        <button
          key={type.id}
          onClick={() => !type.disabled && onSelectType(type.id)}
          disabled={type.disabled}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
            type.disabled
              ? 'opacity-50 cursor-not-allowed bg-gray-50'
              : 'hover:bg-gray-50'
          }`}
        >
          <div className={type.disabled ? 'text-gray-400' : 'text-blue-600'}>
            {type.icon}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${type.disabled ? 'text-gray-400' : 'text-gray-900'}`}>
                {type.label}
              </span>
              {type.disabled && type.disabledReason && (
                <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 leading-none">
                  {type.disabledReason}
                </span>
              )}
            </div>
            {type.description && (
              <div className="text-xs text-gray-400 mt-0.5">{type.description}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
