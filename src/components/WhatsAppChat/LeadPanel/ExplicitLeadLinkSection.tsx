// Vínculo explícito de um lead já existente à conversa do canal.
// A confirmação dispara um único POST. Troca de contexto desmonta a seção.

import { useRef, useState } from 'react'
import type {
  ExplicitLeadSearchHit,
  ExplicitLinkResult,
} from '../../../types/channel-crm-adapter'

interface ExplicitLeadLinkSectionProps {
  searchLeads: (query: string) => Promise<ExplicitLeadSearchHit[]>
  linkLead: (
    input: { leadId: number; expectedLeadId: number | null },
    isStillCurrent: () => boolean,
  ) => Promise<ExplicitLinkResult>
  expectedLeadId: number | null
  getContextEpoch: () => number
  onLinked: () => void
  onNotice: (message: string) => void
}

const FAILURE_TEXT: Record<'forbidden' | 'not_found' | 'error' | 'conflict', string> = {
  conflict: 'Esta conversa já foi vinculada. Os dados foram atualizados.',
  forbidden: 'Você não tem permissão para vincular este lead.',
  not_found: 'O registro não está disponível.',
  error: 'Não foi possível vincular o lead.',
}

export function ExplicitLeadLinkSection({
  searchLeads,
  linkLead,
  expectedLeadId,
  getContextEpoch,
  onLinked,
  onNotice,
}: ExplicitLeadLinkSectionProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ExplicitLeadSearchHit[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const pendingRef = useRef(false)

  const selected = results.find((item) => item.id === selectedId) ?? null
  const trimmed = query.trim()
  const canSearch = trimmed.length >= 2 && trimmed.length <= 80 && !searching && !confirming

  async function handleSearch() {
    if (!canSearch) return
    const epoch = getContextEpoch()
    setSearching(true)
    setSearchError(null)
    setSelectedId(null)
    setLinkError(null)
    try {
      const found = await searchLeads(trimmed)
      if (getContextEpoch() !== epoch) return
      setResults(found)
      setSearched(true)
    } catch {
      if (getContextEpoch() !== epoch) return
      setResults([])
      setSearchError('Não foi possível buscar leads.')
    } finally {
      if (getContextEpoch() === epoch) setSearching(false)
    }
  }

  async function handleConfirm() {
    if (!selected || pendingRef.current || confirming) return
    if (expectedLeadId !== null) return
    const epoch = getContextEpoch()
    if (getContextEpoch() !== epoch) return

    pendingRef.current = true
    setConfirming(true)
    setLinkError(null)
    const stillCurrent = () => getContextEpoch() === epoch
    try {
      const result = await linkLead(
        { leadId: selected.id, expectedLeadId },
        stillCurrent,
      )
      if (!stillCurrent()) return
      if (result.status === 'linked' || result.status === 'already_linked') {
        onLinked()
        return
      }
      if (result.status === 'aborted') return
      const message = FAILURE_TEXT[result.status]
      setLinkError(message)
      if (result.status === 'conflict') {
        onNotice(message)
        onLinked()
      }
    } finally {
      pendingRef.current = false
      if (stillCurrent()) setConfirming(false)
    }
  }

  if (!open) {
    return (
      <div className="px-4 pt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          Vincular lead
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3 px-4 pt-4">
      <p className="text-xs text-gray-500">
        Busque um lead já existente. A conversa só é vinculada depois da confirmação.
      </p>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedId(null)
            setSearched(false)
          }}
          placeholder="Nome, telefone ou e-mail"
          maxLength={80}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
          aria-label="busca-lead"
        />
        <button
          type="button"
          onClick={() => { void handleSearch() }}
          disabled={!canSearch}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Buscar
        </button>
      </div>
      {searchError && <p className="text-xs text-red-600">{searchError}</p>}
      {searched && results.length === 0 && !searchError && !searching && (
        <p className="text-xs text-gray-400">Nenhum lead encontrado.</p>
      )}
      <ul className="space-y-1">
        {results.map((lead) => (
          <li key={lead.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedId(lead.id)
                setLinkError(null)
              }}
              className={`w-full rounded-lg border px-2 py-1.5 text-left text-sm ${
                selectedId === lead.id
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="font-medium">{lead.name || 'Lead sem nome'}</span>
              {lead.phone && <span className="mt-0.5 block text-xs text-gray-500">{lead.phone}</span>}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs text-amber-800">
            Vincular &quot;{selected.name || 'Lead sem nome'}&quot; a esta conversa?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { void handleConfirm() }}
              disabled={confirming || expectedLeadId !== null}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {confirming ? 'Vinculando...' : 'Confirmar vínculo'}
            </button>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              disabled={confirming}
              className="rounded-lg px-3 py-1.5 text-xs text-gray-600 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {linkError && <p className="text-xs text-red-600">{linkError}</p>}
    </div>
  )
}
