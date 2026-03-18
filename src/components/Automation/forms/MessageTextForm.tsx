// =====================================================
// COMPONENT: MESSAGE TEXT FORM
// Data: 15/03/2026
// Objetivo: Formulário para mensagem de texto
// =====================================================

import { useState, useRef, useEffect } from 'react'
import { Plus, X, Bold, Italic, Strikethrough, Code, Link as LinkIcon, Smile } from 'lucide-react'
import { formatWhatsAppText, applyFormatting, insertEmoji, COMMON_EMOJIS } from '../../../utils/whatsappFormatter'
import { useVariables } from '../../../hooks/useVariables'
import VariableAutocomplete from '../VariableAutocomplete'
import { useAuth } from '../../../contexts/AuthContext'

interface MessageTextFormProps {
  config: {
    message?: string
    buttons?: Array<{ id: string; text: string }>
  }
  onChange: (config: any) => void
}

export default function MessageTextForm({ config, onChange }: MessageTextFormProps) {
  const { company } = useAuth()
  const [message, setMessage] = useState(config.message || '')
  const [buttons, setButtons] = useState(config.buttons || [])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showVariableAutocomplete, setShowVariableAutocomplete] = useState(false)
  const [autocompleteFilter, setAutocompleteFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  // Buscar variáveis disponíveis
  const { variables } = useVariables(company?.id || '')
  
  // Debug: log variáveis carregadas
  useEffect(() => {
    console.log('📊 Variáveis carregadas:', variables.length, 'variáveis')
    if (variables.length > 0) {
      console.log('📊 Primeiras 3 variáveis:', variables.slice(0, 3))
    }
  }, [variables])

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart
    
    setMessage(value)
    onChange({ ...config, message: value, buttons })
    
    // Detectar {{ ou [ para abrir autocomplete
    const beforeCursor = value.substring(0, cursorPos)
    const match = beforeCursor.match(/\{\{([^}]*)$/) || beforeCursor.match(/\[([^\]]*)$/)
    
    console.log('🔍 Autocomplete Debug:', {
      beforeCursor,
      match: match ? match[0] : null,
      filter: match ? match[1] : null,
      variablesCount: variables.length,
      showAutocomplete: !!match
    })
    
    if (match) {
      // Abrir autocomplete
      console.log('✅ Abrindo autocomplete com', variables.length, 'variáveis')
      setShowVariableAutocomplete(true)
      setAutocompleteFilter(match[1] || '')
    } else {
      setShowVariableAutocomplete(false)
    }
  }
  
  const handleVariableSelect = (variableKey: string) => {
    if (!textareaRef.current) return
    
    const cursorPos = textareaRef.current.selectionStart
    const beforeCursor = message.substring(0, cursorPos)
    const afterCursor = message.substring(cursorPos)
    
    // Remover {{ ou [ incompleto
    const cleaned = beforeCursor.replace(/\{\{[^}]*$/, '').replace(/\[[^\]]*$/, '')
    
    // Inserir variável completa
    const newText = `${cleaned}{{${variableKey}}}${afterCursor}`
    const newCursorPos = cleaned.length + variableKey.length + 4 // {{ + key + }}
    
    setMessage(newText)
    onChange({ ...config, message: newText, buttons })
    setShowVariableAutocomplete(false)
    
    // Restaurar foco e posição do cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }
  
  // Fechar autocomplete com Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showVariableAutocomplete) {
        setShowVariableAutocomplete(false)
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showVariableAutocomplete])

  const handleFormat = (formatType: 'bold' | 'italic' | 'strikethrough' | 'monospace' | 'link') => {
    if (!textareaRef.current) return

    const start = textareaRef.current.selectionStart
    const end = textareaRef.current.selectionEnd

    const { newText, newCursorPos } = applyFormatting(message, start, end, formatType)
    
    setMessage(newText)
    onChange({ ...config, message: newText, buttons })

    // Restaurar foco e posição do cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const handleEmojiSelect = (emoji: string) => {
    if (!textareaRef.current) return

    const cursorPos = textareaRef.current.selectionStart
    const { newText, newCursorPos } = insertEmoji(message, cursorPos, emoji)
    
    setMessage(newText)
    onChange({ ...config, message: newText, buttons })
    setShowEmojiPicker(false)

    // Restaurar foco e posição do cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
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
        
        {/* Toolbar de Formatação */}
        <div className="flex gap-1 mb-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => handleFormat('bold')}
            className="p-2 hover:bg-gray-200 rounded transition-colors"
            title="Negrito (*texto*)"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('italic')}
            className="p-2 hover:bg-gray-200 rounded transition-colors"
            title="Itálico (_texto_)"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('strikethrough')}
            className="p-2 hover:bg-gray-200 rounded transition-colors"
            title="Riscado (~texto~)"
          >
            <Strikethrough className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('monospace')}
            className="p-2 hover:bg-gray-200 rounded transition-colors"
            title="Monoespaçado (```texto```)"
          >
            <Code className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('link')}
            className="p-2 hover:bg-gray-200 rounded transition-colors"
            title="Inserir link"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-2 hover:bg-gray-200 rounded transition-colors"
              title="Inserir emoji"
            >
              <Smile className="w-4 h-4" />
            </button>
            {showEmojiPicker && (
              <div className="absolute top-full left-0 mt-1 p-2 bg-white border border-gray-300 rounded-lg shadow-lg z-10 w-64">
                <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
                  {COMMON_EMOJIS.map((emoji, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleEmojiSelect(emoji)}
                      className="p-1 hover:bg-gray-100 rounded text-xl"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleMessageChange}
            placeholder="Digite a mensagem que será enviada..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={4}
          />
          
          {/* Autocomplete de variáveis */}
          {showVariableAutocomplete && (
            <VariableAutocomplete
              variables={variables}
              onSelect={handleVariableSelect}
              filter={autocompleteFilter}
            />
          )}
        </div>
        
        {/* Preview WhatsApp */}
        {message && (
          <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-xs font-medium text-green-700 mb-2">📱 Preview WhatsApp:</p>
            <div 
              className="text-sm text-gray-800 whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: formatWhatsAppText(message) }}
            />
          </div>
        )}
        
        <p className="text-xs text-gray-500 mt-1">
          💡 Digite <code className="bg-gray-100 px-1 rounded">{'{{' }</code> ou <code className="bg-gray-100 px-1 rounded">[</code> para inserir variáveis
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
