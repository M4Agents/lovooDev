// =====================================================
// InstagramSuggestionPanel
// =====================================================
// Painel de sugestão de resposta por IA para Instagram Direct.
// Reutiliza o agente chat:reply_suggestion:whatsapp via
// /api/instagram/suggest-reply.
// Isolado do WhatsApp — não altera nenhum componente de WA.
// =====================================================

import React, { useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

// =====================================================
// TIPOS
// =====================================================

type SuggestionMode = 'sales' | 'consultative' | 'support'

interface InstagramSuggestionPanelProps {
  conversationId: string
  onApply: (text: string) => void
  onClose: () => void
}

// =====================================================
// CONSTANTES
// =====================================================

const MODES: Array<{ id: SuggestionMode; label: string; icon: string }> = [
  { id: 'sales',        label: 'Vendas',      icon: '🚀' },
  { id: 'consultative', label: 'Consultivo',  icon: '💡' },
  { id: 'support',      label: 'Suporte',     icon: '🛠' },
]

// =====================================================
// COMPONENTE
// =====================================================

export const InstagramSuggestionPanel: React.FC<InstagramSuggestionPanelProps> = ({
  conversationId,
  onApply,
  onClose,
}) => {
  const [mode, setMode]           = useState<SuggestionMode>('consultative')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSuggestions([])
    try {
      const session = await supabase.auth.getSession()
      const token   = session.data.session?.access_token ?? ''

      const res = await fetch('/api/instagram/suggest-reply', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversation_id: conversationId, mode }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? 'Erro ao gerar sugestões')
        return
      }

      setSuggestions(data.suggestions ?? [])
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [conversationId, mode])

  return (
    <div className="border border-pink-200 rounded-xl bg-pink-50/60 backdrop-blur-sm shadow-lg p-3 mb-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <span className="text-xs font-semibold text-pink-700">Sugestão de resposta IA</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          title="Fechar"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Mode selector */}
      <div className="flex gap-1.5 mb-3">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => { setMode(m.id); setSuggestions([]) }}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mode === m.id
                ? 'bg-pink-500 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-pink-300'
            }`}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* Generate button */}
      {suggestions.length === 0 && !loading && (
        <button
          onClick={generate}
          disabled={loading}
          className="w-full py-2 bg-gradient-to-r from-pink-500 to-pink-600 text-white text-xs font-medium rounded-lg hover:from-pink-600 hover:to-pink-700 disabled:opacity-50 transition-all shadow-sm"
        >
          Gerar sugestões
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-3">
          <svg className="w-4 h-4 animate-spin text-pink-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-slate-500">Gerando sugestões…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 mt-1">
          <p className="text-xs text-red-600 flex-1">{error}</p>
          <button
            onClick={generate}
            className="text-xs text-pink-600 underline font-medium"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-2 mt-1">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => { onApply(s); onClose() }}
              className="w-full text-left px-3 py-2 bg-white rounded-lg border border-slate-200 text-xs text-slate-700 hover:border-pink-400 hover:bg-pink-50 transition-all shadow-sm"
            >
              {s}
            </button>
          ))}
          <button
            onClick={generate}
            className="w-full text-xs text-pink-600 py-1 hover:underline transition-colors"
          >
            Gerar outras sugestões
          </button>
        </div>
      )}
    </div>
  )
}

export default InstagramSuggestionPanel
