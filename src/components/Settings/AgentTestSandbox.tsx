/**
 * AgentTestSandbox
 *
 * Chat interativo para testar o agente em modo sandbox — sem salvar dados,
 * sem criar conversas reais, sem dependência do banco além da autenticação.
 *
 * Usa a configuração atual em memória (prompt_config) para simular como
 * o agente vai se comportar quando for publicado.
 */

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bot, FlaskConical, Loader2, RotateCcw, Save, Send } from 'lucide-react'
import { promptBuilderApi, type ChatMessage, type FlatPromptConfig } from '../../services/promptBuilderApi'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Props {
  companyId:    string
  promptConfig: FlatPromptConfig
  agentName:    string
  companyName:  string
  onBack:       () => void
  onSave?:      () => void
  isSaved?:     boolean
}

// ── Componente ─────────────────────────────────────────────────────────────────

export function AgentTestSandbox({
  companyId, promptConfig, agentName, companyName,
  onBack, onSave, isSaved = false,
}: Props) {
  const greeting = buildGreeting(agentName, companyName)

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: greeting },
  ])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const endRef                  = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const nextMessages = [...messages, userMsg]

    setMessages(nextMessages)
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const reply = await promptBuilderApi.sandboxChat({
        company_id:    companyId,
        messages:      nextMessages,
        prompt_config: promptConfig,
        agent_name:    agentName,
      })
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Não consegui responder. Tente novamente.')
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

  function handleReset() {
    setMessages([{ role: 'assistant', content: greeting }])
    setInput('')
    setError(null)
  }

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100
                      bg-gradient-to-r from-violet-50 to-indigo-50 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <FlaskConical className="w-4 h-4 text-violet-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900 truncate">
                Teste do agente
              </p>
              <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium
                               whitespace-nowrap flex-shrink-0">
                Modo simulação
              </span>
            </div>
            <p className="text-xs text-gray-500 truncate">
              Converse com <span className="font-medium">{agentName || 'seu agente'}</span> antes de salvar
            </p>
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleReset}
            title="Recomeçar conversa"
            className="w-8 h-8 flex items-center justify-center rounded-full
                       text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600
                       bg-white border border-gray-200 rounded-lg hover:bg-gray-50
                       transition-colors font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar
          </button>
          {!isSaved && onSave && (
            <button
              onClick={onSave}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white
                         bg-green-600 rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              <Save className="w-3.5 h-3.5" />
              Salvar agente
            </button>
          )}
        </div>
      </div>

      {/* ── Contexto do agente ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-100 bg-white text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Bot className="w-3.5 h-3.5 text-violet-500" />
          <span className="font-medium text-gray-700">{agentName || '—'}</span>
        </span>
        {companyName && (
          <span className="flex items-center gap-1">
            🏢 {companyName}
          </span>
        )}
        <span className="ml-auto text-gray-400 italic">
          Simulação isolada — nada é salvo
        </span>
      </div>

      {/* ── Mensagens ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-gray-50/50">
        {messages.map((msg, i) => (
          <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 bg-violet-100 rounded-full flex items-center justify-center flex-shrink-0 mb-0.5">
                <Bot className="w-3.5 h-3.5 text-violet-600" />
              </div>
            )}
            <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-sm'
                : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex items-end gap-2 justify-start">
            <div className="w-6 h-6 bg-violet-100 rounded-full flex items-center justify-center flex-shrink-0">
              <Bot className="w-3.5 h-3.5 text-violet-600" />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
              </div>
            </div>
          </div>
        )}

        {/* Erro */}
        {error && !loading && (
          <div className="flex justify-center">
            <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-2 text-xs text-red-600">
              {error}
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── Input ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-200 px-4 py-3 bg-white flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
          placeholder={`Escreva como um cliente para testar ${agentName || 'o agente'}...`}
          className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5
                     focus:outline-none focus:ring-2 focus:ring-violet-400
                     disabled:opacity-50 bg-gray-50 focus:bg-white transition-colors"
          autoFocus
        />
        <button
          onClick={() => void handleSend()}
          disabled={loading || !input.trim()}
          className="w-10 h-10 flex items-center justify-center bg-violet-600 text-white
                     rounded-xl hover:bg-violet-700 disabled:opacity-40 transition-colors flex-shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildGreeting(agentName: string, companyName: string): string {
  if (agentName && companyName) {
    return `Oi! 😊 Sou ${agentName}, da ${companyName}. Como posso te ajudar?`
  }
  if (agentName) {
    return `Oi! 😊 Sou ${agentName}. Como posso te ajudar?`
  }
  if (companyName) {
    return `Oi! 😊 Sou o assistente da ${companyName}. Como posso te ajudar?`
  }
  return 'Oi! 😊 Como posso te ajudar hoje?'
}
