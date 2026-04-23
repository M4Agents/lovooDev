// =============================================================================
// src/components/Settings/ConsultingTimeEntriesPanel.tsx
//
// Painel de lançamentos de horas consultivas.
//   - Cliente (empresa filha): visualiza seus lançamentos (read-only)
//   - Platform admin: visualiza + pode lançar/excluir horas
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { Clock, AlertCircle, Loader2, Trash2, Plus, RefreshCw } from 'lucide-react'
import {
  fetchTimeEntries,
  deleteTimeEntry,
  type ConsultingTimeEntry,
} from '../../services/consultingApi'
import { ConsultingTimeEntryForm } from './ConsultingTimeEntryForm'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('pt-BR')
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}

const entryTypeLabel: Record<string, string> = {
  implementation: 'Implementação',
  training:       'Treinamento',
  consulting:     'Consultoria',
}

const entryTypeColor: Record<string, string> = {
  implementation: 'text-blue-600 bg-blue-50 border-blue-100',
  training:       'text-emerald-600 bg-emerald-50 border-emerald-100',
  consulting:     'text-violet-600 bg-violet-50 border-violet-100',
}

// ── Painel principal ──────────────────────────────────────────────────────────

interface Props {
  companyId:        string
  canLogHours:      boolean   // true = platform admin (pode lançar e excluir)
}

export function ConsultingTimeEntriesPanel({ companyId, canLogHours }: Props) {
  const [entries, setEntries]       = useState<ConsultingTimeEntry[]>([])
  const [total, setTotal]           = useState(0)
  const [page, setPage]             = useState(1)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [showForm, setShowForm]     = useState(false)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const limit = 20

  const loadEntries = useCallback(async (p = page) => {
    setLoading(true)
    setError(null)
    try {
      const { entries: data, total: t } = await fetchTimeEntries(companyId, p, limit)
      setEntries(data)
      setTotal(t)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar lançamentos')
    } finally {
      setLoading(false)
    }
  }, [companyId, page])

  useEffect(() => { void loadEntries(page) }, [loadEntries, page])

  async function handleDelete(entryId: string) {
    if (!window.confirm('Excluir este lançamento? As horas serão devolvidas ao saldo.')) return
    setDeleting(entryId)
    setDeleteError(null)
    try {
      await deleteTimeEntry(companyId, entryId)
      void loadEntries(page)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao excluir')
    } finally {
      setDeleting(null)
    }
  }

  function handleFormSuccess() {
    setShowForm(false)
    setPage(1)
    void loadEntries(1)
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Clock size={18} />Lançamentos de horas
          {total > 0 && <span className="text-xs text-slate-400 font-normal">({total} no total)</span>}
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => loadEntries(page)} className="text-slate-400 hover:text-slate-600" title="Atualizar">
            <RefreshCw size={16} />
          </button>
          {canLogHours && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
            >
              <Plus size={14} />Lançar horas
            </button>
          )}
        </div>
      </div>

      {showForm && canLogHours && (
        <ConsultingTimeEntryForm
          companyId={companyId}
          onSuccess={handleFormSuccess}
          onCancel={() => setShowForm(false)}
        />
      )}

      {deleteError && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle size={14} />{deleteError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={22} className="animate-spin text-blue-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle size={14} />{error}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Clock size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhum lançamento registrado ainda.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Data</th>
                  <th className="text-left px-4 py-3 font-medium">Horário</th>
                  <th className="text-left px-4 py-3 font-medium">Duração</th>
                  <th className="text-left px-4 py-3 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 font-medium">Descrição</th>
                  {canLogHours && <th className="px-4 py-3 font-medium" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDate(entry.entry_date)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {entry.start_time.slice(0, 5)} – {entry.end_time.slice(0, 5)}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium whitespace-nowrap">
                      {formatMinutes(entry.duration_minutes)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${entryTypeColor[entry.entry_type] ?? 'text-slate-600 bg-slate-50 border-slate-100'}`}>
                        {entryTypeLabel[entry.entry_type] ?? entry.entry_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{entry.description}</td>
                    {canLogHours && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(entry.id)}
                          disabled={deleting === entry.id}
                          className="text-slate-400 hover:text-red-500 transition disabled:opacity-50"
                          title="Excluir lançamento"
                        >
                          {deleting === entry.id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Trash2 size={14} />}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-40 hover:bg-slate-50"
              >
                Anterior
              </button>
              <span className="text-sm text-slate-500">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 disabled:opacity-40 hover:bg-slate-50"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
