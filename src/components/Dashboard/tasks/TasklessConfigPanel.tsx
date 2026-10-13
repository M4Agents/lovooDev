import { useEffect, useState } from 'react'
import { fetchTasklessConfig, saveTasklessConfig, type TasklessFunnel } from '../../../services/tasklessLeadsApi'

interface Props {
  companyId: string
  onClose: () => void
  onSaved: () => void
}

export function TasklessConfigPanel({ companyId, onClose, onSaved }: Props) {
  const [funnels, setFunnels] = useState<TasklessFunnel[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchTasklessConfig(companyId)
      .then(config => {
        if (cancelled) return
        setFunnels(config.funnels)
        setSelected(new Set(config.stage_ids))
        setCanEdit(config.can_edit)
        setError(null)
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Erro ao carregar as etapas')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [companyId])

  const toggle = (stageId: string) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveTasklessConfig(companyId, [...selected])
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao salvar as etapas')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Etapas sem tarefa</h2>
          <p className="mt-1 text-sm text-gray-500">
            Leads nestas etapas aparecem na coluna quando não têm tarefa pendente.
          </p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-gray-500">Carregando funis...</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && funnels.length === 0 && (
            <p className="text-sm text-gray-500">Esta empresa não tem funis de vendas.</p>
          )}
          {funnels.map(funnel => (
            <fieldset key={funnel.id} className="space-y-2">
              <legend className="text-sm font-medium text-gray-800">
                {funnel.name}{funnel.is_active ? '' : ' (inativo)'}
              </legend>
              {funnel.stages.map(stage => (
                <label key={stage.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selected.has(stage.id)}
                    disabled={!canEdit || saving}
                    onChange={() => toggle(stage.id)}
                  />
                  <span>{stage.name}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Fechar
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
