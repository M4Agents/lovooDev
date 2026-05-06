// =====================================================
// SuggestionPanel
//
// Painel de sugestões de resposta geradas por IA.
// Exibe 3 botões de modo e 3 cards de sugestão.
//
// Regras:
// - company_id NÃO é enviado ao backend
// - Clique na sugestão preenche o input (onSelect) e fecha o painel
// - Nunca envia mensagem automaticamente
// - Loading lock: impede chamadas duplicadas durante o carregamento
// =====================================================

import { useState } from 'react'
import { supabase } from '../../../lib/supabase'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type SuggestionMode = 'sales' | 'consultative' | 'support'

interface SuggestionPanelProps {
  conversationId: string
  onSelect: (text: string) => void
  onClose: () => void
}

// ─── Configuração dos modos ───────────────────────────────────────────────────

const MODES: { id: SuggestionMode; label: string; title: string }[] = [
  { id: 'sales',        label: 'Venda',      title: 'Tom persuasivo — avançar a venda'     },
  { id: 'consultative', label: 'Consultivo', title: 'Tom consultivo — entender necessidade' },
  { id: 'support',      label: 'Suporte',    title: 'Tom empático — resolver problema'      },
]

// ─── Componente ───────────────────────────────────────────────────────────────

export function SuggestionPanel({ conversationId, onSelect, onClose }: SuggestionPanelProps) {
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeMode, setActiveMode]   = useState<SuggestionMode | null>(null)

  const handleModeClick = async (mode: SuggestionMode) => {
    if (loading) return          // loading lock — impede chamada duplicada

    setLoading(true)
    setError(null)
    setSuggestions([])
    setActiveMode(mode)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sessão inválida')

      const response = await fetch('/api/chat/suggest-reply', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        // company_id NÃO é enviado — derivado no backend
        body: JSON.stringify({ conversation_id: conversationId, mode }),
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Erro ao gerar sugestões')
      }

      if (!Array.isArray(result.suggestions) || result.suggestions.length === 0) {
        throw new Error('Resposta inválida do servidor')
      }

      setSuggestions(result.suggestions.slice(0, 3))
    } catch (err: any) {
      setError(err?.message || 'Erro ao gerar sugestões. Tente novamente.')
      setActiveMode(null)
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (text: string) => {
    onSelect(text)
    onClose()
  }

  return (
    <div className="border border-purple-200 rounded-lg bg-purple-50 p-3 flex flex-col gap-2.5">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span className="text-xs font-semibold text-purple-700">Sugerir resposta</span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 text-purple-400 hover:text-purple-600 rounded transition-colors"
          title="Fechar"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Botões de modo */}
      <div className="flex gap-1.5">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => handleModeClick(m.id)}
            disabled={loading}
            title={m.title}
            className={[
              'flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              activeMode === m.id && !loading
                ? 'bg-purple-600 text-white border-purple-600'
                : 'text-purple-700 bg-white border-purple-200 hover:bg-purple-100',
            ].join(' ')}
          >
            {loading && activeMode === m.id ? (
              <span className="flex items-center justify-center gap-1">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Gerando...
              </span>
            ) : m.label}
          </button>
        ))}
      </div>

      {/* Erro */}
      {error && (
        <p className="text-xs text-red-600 text-center">{error}</p>
      )}

      {/* Cards de sugestão */}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] text-purple-500 font-medium uppercase tracking-wide">
            Clique para usar
          </p>
          {suggestions.map((text, i) => (
            <button
              key={i}
              onClick={() => handleSelect(text)}
              className="w-full text-left px-3 py-2 text-sm text-gray-800 bg-white border border-purple-100 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors leading-snug"
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default SuggestionPanel
