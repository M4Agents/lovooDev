// =====================================================
// COMPONENT: MESSAGE TEXT FORM
// Data: 15/03/2026
// Objetivo: Formulário para mensagem de texto
// =====================================================

import { useState } from 'react'
import { Plus, X } from 'lucide-react'

interface MessageTextFormProps {
  config: {
    message?: string
    buttons?: Array<{ id: string; text: string }>
  }
  onChange: (config: any) => void
}

export default function MessageTextForm({ config, onChange }: MessageTextFormProps) {
  const [message, setMessage] = useState(config.message || '')
  const [buttons, setButtons] = useState(config.buttons || [])

  const handleMessageChange = (value: string) => {
    setMessage(value)
    onChange({ ...config, message: value, buttons })
  }

  const handleAddButton = () => {
    const newButton = {
      id: `btn-${Date.now()}`,
      text: ''
    }
    const newButtons = [...buttons, newButton]
    setButtons(newButtons)
    onChange({ ...config, message, buttons: newButtons })
  }

  const handleButtonChange = (id: string, text: string) => {
    const newButtons = buttons.map(btn => 
      btn.id === id ? { ...btn, text } : btn
    )
    setButtons(newButtons)
    onChange({ ...config, message, buttons: newButtons })
  }

  const handleRemoveButton = (id: string) => {
    const newButtons = buttons.filter(btn => btn.id !== id)
    setButtons(newButtons)
    onChange({ ...config, message, buttons: newButtons })
  }

  return (
    <div className="space-y-4">
      {/* Mensagem */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Mensagem
        </label>
        <textarea
          value={message}
          onChange={(e) => handleMessageChange(e.target.value)}
          placeholder="Digite a mensagem que será enviada..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          rows={4}
        />
        <p className="text-xs text-gray-500 mt-1">
          Use variáveis: {`{{nome_variavel}}`}
        </p>
      </div>

      {/* Botões de Resposta */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Botões de Resposta
        </label>
        <div className="space-y-2">
          {buttons.map((button) => (
            <div key={button.id} className="flex gap-2">
              <input
                type="text"
                value={button.text}
                onChange={(e) => handleButtonChange(button.id, e.target.value)}
                placeholder="Texto do botão"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={() => handleRemoveButton(button.id)}
                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={handleAddButton}
          className="mt-2 w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Adicionar Botão
        </button>
      </div>

      {/* Usar Variáveis */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="use-variables"
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="use-variables" className="text-sm text-gray-700">
          Usar variáveis (ex: {`{{nome}}`})
        </label>
      </div>
    </div>
  )
}
