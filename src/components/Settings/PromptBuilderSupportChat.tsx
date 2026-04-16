/**
 * PromptBuilderSupportChat
 *
 * Chat lateral simples para o Agente de Suporte durante a criação de agentes.
 * Exibe um botão flutuante que abre um painel de chat.
 */

import { useRef, useState, useEffect } from 'react'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'
import { promptBuilderApi, type ChatMessage } from '../../services/promptBuilderApi'

interface Props {
  companyId: string
}

export function PromptBuilderSupportChat({ companyId }: Props) {
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role:    'assistant',
      content: 'Olá! Posso te ajudar a configurar seu agente. Tire suas dúvidas aqui 😊',
    },
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const endRef                = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const reply = await promptBuilderApi.runSupportAgent(companyId, text)
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Não consegui responder agora. Tente novamente em instantes.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Painel do chat */}
      {open && (
        <div className="w-80 flex flex-col bg-white border border-gray-200 rounded-xl shadow-xl
                        overflow-hidden" style={{ height: '420px' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-blue-600">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-white" />
              <span className="text-sm font-semibold text-white">Assistente de configuração</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-blue-200 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-xl rounded-bl-sm px-3 py-2">
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-200 px-3 py-2 flex gap-2 bg-white">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={loading}
              placeholder="Escreva sua dúvida..."
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5
                         focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
            <button
              onClick={() => void handleSend()}
              disabled={loading || !input.trim()}
              className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                         disabled:opacity-40 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Botão flutuante */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white
                   rounded-full shadow-lg hover:bg-blue-700 transition-colors text-sm font-medium"
      >
        <MessageCircle className="w-4 h-4" />
        Precisa de ajuda?
      </button>
    </div>
  )
}
