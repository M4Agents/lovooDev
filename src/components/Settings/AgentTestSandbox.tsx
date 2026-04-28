/**
 * AgentTestSandbox
 *
 * Sandbox real do agente: usa o mesmo runtime de produção (companyData,
 * catálogo, knowledge_base, tools) mas em modo completamente isolado.
 *
 * Diferenças do sandbox básico:
 *   - Chama /api/ai/sandbox-run (não /api/ai/sandbox)
 *   - Mantém sandboxMemory entre turnos (estado local, nunca salvo)
 *   - Renderiza tool_events como cards visuais antes da resposta
 *   - Aceita agent_id para usar knowledge_base do agente salvo
 *   - Exibe nota quando RAG não está disponível no sandbox
 */

import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Bot, FlaskConical, Loader2, RotateCcw,
  Save, Send, Zap, AlertCircle, Mic, Square, X,
} from 'lucide-react'
import {
  promptBuilderApi,
  type ChatMessage,
  type FlatPromptConfig,
  type SandboxMemory,
  type SandboxToolEvent,
} from '../../services/promptBuilderApi'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Props {
  companyId:       string
  promptConfig:    FlatPromptConfig
  agentName:       string
  companyName:     string
  agentId?:        string | null   // ID do agente salvo (para knowledge_base)
  onBack?:         () => void      // opcional: oculta botão Voltar quando não fornecido
  onSave?:         () => void
  isSaved?:        boolean
  /** Modo embutido: oculta botões de navegação (Voltar / Salvar agente). */
  compact?:        boolean
  /**
   * Modo avançado: prompt raw completo (substitui prompt_config).
   * Quando presente, o sandbox envia o texto bruto diretamente ao LLM,
   * sem parsing para campos nem injeção do nome do sistema.
   */
  advancedPrompt?: string
}

// Mensagem do chat inclui tool_events opcionais (exibidos antes da resposta)
interface DisplayMessage extends ChatMessage {
  tool_events?: SandboxToolEvent[]
}

// ── Componente ─────────────────────────────────────────────────────────────────

export function AgentTestSandbox({
  companyId, promptConfig, agentName, companyName,
  agentId = null, onBack, onSave, isSaved = false, compact = false,
  advancedPrompt,
}: Props) {
  const greeting = buildGreeting(agentName, companyName)

  const [messages, setMessages]           = useState<DisplayMessage[]>([
    { role: 'assistant', content: greeting },
  ])
  const [input, setInput]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [sandboxMemory, setSandboxMemory] = useState<SandboxMemory | null>(null)
  const [ragNotice, setRagNotice]         = useState<string | null>(null)
  const endRef                            = useRef<HTMLDivElement | null>(null)

  // ── Gravação de áudio inline ────────────────────────────────────────────────
  type AudioStatus = 'idle' | 'recording' | 'sending'
  const [audioStatus, setAudioStatus]     = useState<AudioStatus>('idle')
  const [recSeconds, setRecSeconds]       = useState(0)
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null)
  const audioChunksRef    = useRef<Blob[]>([])
  const audioStreamRef    = useRef<MediaStream | null>(null)
  const recTimerRef       = useRef<number | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: DisplayMessage = { role: 'user', content: text }
    // Histórico sem tool_events (API só recebe role + content)
    const apiMessages: ChatMessage[] = [
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const result = await promptBuilderApi.sandboxRunChat({
        company_id:     companyId,
        messages:       apiMessages,
        // Modo avançado: envia prompt raw — sem parsing e sem injeção do nome do sistema
        ...(advancedPrompt
          ? { prompt: advancedPrompt }
          : { prompt_config: promptConfig, agent_name: agentName || undefined }
        ),
        sandbox_memory: sandboxMemory,
        agent_id:       agentId,
      })

      // Obtém blocos do splitting (mesmo pipeline do WhatsApp real).
      // Fallback: resposta completa como bloco único.
      const blocks =
        result.reply_blocks && result.reply_blocks.length > 0
          ? result.reply_blocks
          : [result.reply]

      // Primeiro bloco — tool_events ficam associados somente ao primeiro
      setMessages(prev => [...prev, {
        role:        'assistant',
        content:     blocks[0],
        tool_events: result.tool_events.length > 0 ? result.tool_events : undefined,
      }])

      // Blocos adicionais — renderizados progressivamente com delay curto.
      // Loading dots continuam visíveis entre blocos (simula "digitando").
      // Delay: min(200ms, 40ms + chars × 0.5ms) — versão reduzida do pipeline real.
      for (let i = 1; i < blocks.length; i++) {
        const delay = Math.min(200, 40 + blocks[i].length * 0.5)
        await new Promise<void>(resolve => setTimeout(resolve, delay))
        setMessages(prev => [...prev, { role: 'assistant', content: blocks[i] }])
      }

      setSandboxMemory(result.updated_sandbox_memory)
      if (result.rag_notice) setRagNotice(result.rag_notice)

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
    setSandboxMemory(null)
    setRagNotice(null)
    stopAudioResources()
    setAudioStatus('idle')
    setRecSeconds(0)
  }

  // ── Helpers de áudio ────────────────────────────────────────────────────────

  function stopAudioResources() {
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop())
      audioStreamRef.current = null
    }
  }

  async function startRecording() {
    if (loading || audioStatus !== 'idle') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current  = stream
      audioChunksRef.current  = []

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/ogg' })
        const file = new File([blob], `audio-${Date.now()}.ogg`, { type: 'audio/ogg' })
        stopAudioResources()
        void sendAudio(file)
      }

      recorder.start()
      setAudioStatus('recording')
      setRecSeconds(0)

      recTimerRef.current = window.setInterval(() => {
        setRecSeconds(s => {
          if (s >= 119) stopRecording() // limite 2 min no sandbox
          return s + 1
        })
      }, 1000)
    } catch {
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
    }
  }

  function stopRecording() {
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  function cancelRecording() {
    audioChunksRef.current = [] // descarta dados para que onstop não envie
    stopAudioResources()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null // evita disparo do sendAudio
      mediaRecorderRef.current.stop()
    }
    setAudioStatus('idle')
    setRecSeconds(0)
  }

  async function sendAudio(file: File) {
    setAudioStatus('sending')
    setLoading(true)
    setError(null)

    // Histórico enviado para o backend (sem a mensagem de áudio — o backend a adiciona)
    const apiMessages: ChatMessage[] = messages.map(m => ({ role: m.role, content: m.content }))

    // Exibe placeholder visual de áudio no chat (sem transcrição)
    setMessages(prev => [...prev, { role: 'user', content: '🎤 Áudio' }])

    try {
      const result = await promptBuilderApi.sandboxAudioRun({
        company_id:     companyId,
        audio:          file,
        messages:       apiMessages,
        // Modo avançado: envia prompt raw — sem parsing e sem injeção do nome do sistema
        ...(advancedPrompt
          ? { prompt: advancedPrompt }
          : { prompt_config: promptConfig, agent_name: agentName || undefined }
        ),
        sandbox_memory: sandboxMemory,
        agent_id:       agentId,
      })

      const blocks =
        result.reply_blocks && result.reply_blocks.length > 0
          ? result.reply_blocks
          : [result.reply]

      setMessages(prev => [...prev, {
        role:        'assistant',
        content:     blocks[0],
        tool_events: result.tool_events.length > 0 ? result.tool_events : undefined,
      }])

      for (let i = 1; i < blocks.length; i++) {
        const delay = Math.min(200, 40 + blocks[i].length * 0.5)
        await new Promise<void>(resolve => setTimeout(resolve, delay))
        setMessages(prev => [...prev, { role: 'assistant', content: blocks[i] }])
      }

      setSandboxMemory(result.updated_sandbox_memory)
      if (result.rag_notice) setRagNotice(result.rag_notice)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Não consegui processar o áudio. Tente novamente.')
    } finally {
      setLoading(false)
      setAudioStatus('idle')
      setRecSeconds(0)
    }
  }

  function fmtSecs(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // Limite visual de memória: exibe até 8 turnos, mas mantém objeto completo internamente
  const MAX_DISPLAY_TURNS = 8
  const displayedTurns = sandboxMemory?.interaction_count
    ? Math.min(sandboxMemory.interaction_count, MAX_DISPLAY_TURNS)
    : 0
  const hasMemory = displayedTurns > 0

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
              <span className="text-xs bg-violet-600 text-white px-2 py-0.5 rounded-full font-medium
                               whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" />
                Simulação avançada
              </span>
            </div>
            <p className="text-xs text-gray-500 truncate">
              Runtime completo — catálogo, ferramentas e memória ativos
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
          {/* Voltar e Salvar ocultos no modo compacto (embutido no Step 4) */}
          {!compact && onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600
                         bg-white border border-gray-200 rounded-lg hover:bg-gray-50
                         transition-colors font-medium"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar
            </button>
          )}
          {!compact && !isSaved && onSave && (
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

      {/* ── Barra de contexto ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-100 bg-white text-xs text-gray-500
                      flex-shrink-0">
        <span className="flex items-center gap-1">
          <Bot className="w-3.5 h-3.5 text-violet-500" />
          <span className="font-medium text-gray-700">{agentName || '—'}</span>
        </span>
        {companyName && (
          <span className="flex items-center gap-1">
            🏢 {companyName}
          </span>
        )}

        {/* Indicador de memória acumulada (limitado visualmente a 8 turnos) */}
        {hasMemory && (
          <span className="flex items-center gap-1 text-violet-600 font-medium">
            🧠 Últimos {displayedTurns} turno{displayedTurns !== 1 ? 's' : ''} considerados
          </span>
        )}

        <span className="ml-auto text-gray-400 italic">
          Simulação isolada — nada é salvo
        </span>
      </div>

      {/* ── Aviso de RAG não disponível (quando aplicável) ──────────────── */}
      {ragNotice && (
        <div className="flex items-center gap-2 px-5 py-2 bg-amber-50 border-b border-amber-100
                        text-xs text-amber-700 flex-shrink-0">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {ragNotice}
        </div>
      )}

      {/* ── Mensagens ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-gray-50/50 min-h-0">
        {messages.map((msg, i) => (
          <div key={i}>
            {/* Bloco de tools simuladas (antes da resposta do agente) */}
            {msg.role === 'assistant' && msg.tool_events && msg.tool_events.length > 0 && (
              <div className="mb-2">
                {/* Cabeçalho de agrupamento quando há múltiplas tools no turno */}
                {msg.tool_events.length > 1 && (
                  <p className="ml-8 mb-1 text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                    Ações do agente neste turno
                  </p>
                )}
                <div className="space-y-1.5">
                  {msg.tool_events.map((ev, j) => (
                    <SandboxToolCard key={j} event={ev} />
                  ))}
                </div>
              </div>
            )}

            {/* Bolha da mensagem */}
            <div className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 bg-violet-100 rounded-full flex items-center justify-center
                                flex-shrink-0 mb-0.5">
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
          </div>
        ))}

        {/* Loading */}
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

        {/* Erro — com botão para limpar e tentar novamente */}
        {error && !loading && (
          <div className="flex justify-center">
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 text-xs text-red-700
                            flex items-center gap-3 max-w-sm">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                className="underline whitespace-nowrap text-red-500 hover:text-red-700
                           transition-colors font-medium"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── Input ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-200 px-4 py-3 bg-white flex-shrink-0">

        {/* Estado: gravando */}
        {audioStatus === 'recording' && (
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            <span className="text-sm font-medium text-gray-700 flex-1">
              Gravando… <span className="font-mono text-red-600">{fmtSecs(recSeconds)}</span>
            </span>
            <button
              onClick={cancelRecording}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300
                         rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
            >
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
            <button
              onClick={stopRecording}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-600 text-white
                         rounded-lg hover:bg-red-700 transition-colors"
            >
              <Square className="w-3.5 h-3.5" /> Parar
            </button>
          </div>
        )}

        {/* Estado: enviando / normal */}
        {audioStatus !== 'recording' && (
          <div className="flex gap-2">
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

            {/* Botão microfone */}
            <button
              onClick={() => void startRecording()}
              disabled={loading}
              title="Gravar áudio"
              className="w-10 h-10 flex items-center justify-center border border-gray-200
                         rounded-xl hover:bg-gray-50 disabled:opacity-40 transition-colors
                         flex-shrink-0 text-gray-500"
            >
              {audioStatus === 'sending'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Mic className="w-4 h-4" />}
            </button>

            {/* Botão enviar texto */}
            <button
              onClick={() => void handleSend()}
              disabled={loading || !input.trim()}
              className="w-10 h-10 flex items-center justify-center bg-violet-600 text-white
                         rounded-xl hover:bg-violet-700 disabled:opacity-40 transition-colors flex-shrink-0"
            >
              {loading && audioStatus === 'idle'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Card de tool simulada ──────────────────────────────────────────────────────

function SandboxToolCard({ event }: { event: SandboxToolEvent }) {
  const iconMap: Record<string, string> = {
    request_handoff:    '🔁',
    add_note:           '📝',
    add_tag:            '🏷️',
    remove_tag:         '🏷️',
    update_lead:        '👤',
    create_activity:    '📅',
    move_opportunity:   '📊',
    update_opportunity: '📊',
    schedule_contact:   '⏰',
    send_media:         '🖼️',
  }

  const colorMap: Record<string, string> = {
    request_handoff:    'bg-amber-50 border-amber-200 text-amber-800',
    add_note:           'bg-blue-50 border-blue-200 text-blue-800',
    add_tag:            'bg-purple-50 border-purple-200 text-purple-800',
    remove_tag:         'bg-gray-50 border-gray-200 text-gray-700',
    update_lead:        'bg-teal-50 border-teal-200 text-teal-800',
    create_activity:    'bg-indigo-50 border-indigo-200 text-indigo-800',
    move_opportunity:   'bg-green-50 border-green-200 text-green-800',
    update_opportunity: 'bg-green-50 border-green-200 text-green-800',
    schedule_contact:   'bg-orange-50 border-orange-200 text-orange-800',
    send_media:         'bg-pink-50 border-pink-200 text-pink-800',
  }

  const icon  = iconMap[event.tool]  ?? '⚙️'
  const color = colorMap[event.tool] ?? 'bg-gray-50 border-gray-200 text-gray-700'

  // Campos de mídia enriquecidos pelo backend (send_media apenas)
  const mediaUrl  = event.tool === 'send_media' ? (event.args.media_url as string | undefined) : undefined
  const mediaType = (event.args.media_type as string | undefined) ?? 'image'
  const isVideo   = mediaType === 'video'

  return (
    <div className={`ml-8 rounded-lg border text-xs overflow-hidden ${color}`}>
      {/* Linha de label (igual ao design original) */}
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="flex-shrink-0 mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{event.label}</p>
          {/* Fallback: sem URL e sem vídeo → indica que não há prévia disponível */}
          {event.tool === 'send_media' && !mediaUrl && (
            <p className="mt-0.5 opacity-60 text-[10px]">
              Nenhuma mídia encontrada para este tipo no catálogo
            </p>
          )}
        </div>
        <span className="ml-auto flex-shrink-0 text-[10px] opacity-60 font-medium uppercase tracking-wide">
          Simulado
        </span>
      </div>

      {/* Preview de imagem real da empresa (send_media com URL, não vídeo) */}
      {mediaUrl && !isVideo && (
        <img
          src={mediaUrl}
          alt="Prévia da mídia que seria enviada pelo agente"
          className="w-full max-h-48 object-cover border-t border-pink-200"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}

      {/* Fallback textual para vídeos (sem preview) */}
      {mediaUrl && isVideo && (
        <p className="px-3 pb-2 pt-1 text-[10px] opacity-60 border-t border-pink-200">
          Vídeo disponível (não pré-visualizado aqui)
        </p>
      )}
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
