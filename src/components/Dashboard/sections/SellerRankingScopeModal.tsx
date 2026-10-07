import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, Settings2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../../contexts/AuthContext'
import { dashboardApi } from '../../../services/dashboardApi'
import { funnelApi } from '../../../services/funnelApi'
import type { RankingScopeSettings } from '../../../types/dashboard'
import type { FunnelStage, SalesFunnel } from '../../../types/sales-funnel'

interface Props {
  onClose: () => void
  onSaved: () => void
}

export function SellerRankingScopeModal({ onClose, onSaved }: Props) {
  const { company } = useAuth()
  const companyId = company?.id ?? null
  const [mode, setMode] = useState<'all' | 'custom'>('all')
  const [funnelIds, setFunnelIds] = useState<string[]>([])
  const [stageIds, setStageIds] = useState<string[]>([])
  const [funnels, setFunnels] = useState<SalesFunnel[]>([])
  const [stagesByFunnel, setStagesByFunnel] = useState<Record<string, FunnelStage[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const loadStages = useCallback(async (funnelId: string) => {
    if (stagesByFunnel[funnelId]) return
    try {
      const stages = await funnelApi.getStages(funnelId)
      setStagesByFunnel(prev => ({ ...prev, [funnelId]: stages }))
    } catch {
      setStagesByFunnel(prev => ({ ...prev, [funnelId]: [] }))
    }
  }, [stagesByFunnel])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const [scopeRes, funnelList] = await Promise.all([
          dashboardApi.getRankingScope(companyId),
          funnelApi.getFunnels(companyId),
        ])
        if (cancelled) return
        setFunnels(funnelList)
        const scope = scopeRes.data
        setMode(scope.mode === 'custom' ? 'custom' : 'all')
        setFunnelIds(scope.funnel_ids ?? [])
        setStageIds(scope.stage_ids ?? [])
        await Promise.all((scope.funnel_ids ?? []).map(id => funnelApi.getStages(id)))
          .then(groups => {
            if (cancelled) return
            const next: Record<string, FunnelStage[]> = {}
            ;(scope.funnel_ids ?? []).forEach((id, index) => {
              next[id] = groups[index] ?? []
            })
            setStagesByFunnel(prev => ({ ...prev, ...next }))
          })
          .catch(() => undefined)
      } catch (err: unknown) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Erro ao carregar o escopo')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId])

  function toggleFunnel(funnelId: string) {
    setFunnelIds(prev => {
      if (prev.includes(funnelId)) {
        const stages = stagesByFunnel[funnelId] ?? []
        const drop = new Set(stages.map(stage => stage.id))
        setStageIds(current => current.filter(id => !drop.has(id)))
        return prev.filter(id => id !== funnelId)
      }
      return [...prev, funnelId]
    })
  }

  function toggleStage(stageId: string, funnelId: string) {
    setFunnelIds(prev => prev.includes(funnelId) ? prev : [...prev, funnelId])
    setStageIds(prev => prev.includes(stageId) ? prev.filter(id => id !== stageId) : [...prev, stageId])
  }

  function selectActiveStages(funnelId: string, stages: FunnelStage[]) {
    const activeIds = stages.filter(stage => stage.stage_type === 'active').map(stage => stage.id)
    setFunnelIds(prev => prev.includes(funnelId) ? prev : [...prev, funnelId])
    setStageIds(prev => {
      const rest = prev.filter(id => !activeIds.includes(id) && !stages.some(stage => stage.id === id && stage.stage_type === 'active'))
      const allOn = activeIds.every(id => prev.includes(id))
      return allOn ? rest : [...new Set([...rest, ...activeIds])]
    })
  }

  async function save() {
    if (!companyId) return
    const payload: RankingScopeSettings = mode === 'all'
      ? { mode: 'all' }
      : { mode: 'custom', funnel_ids: funnelIds, stage_ids: stageIds }
    if (mode === 'custom' && (funnelIds.length === 0 || stageIds.length === 0)) {
      toast.error('Selecione ao menos um funil e uma etapa ativa')
      return
    }
    setSaving(true)
    try {
      await dashboardApi.saveRankingScope(companyId, payload)
      toast.success('Escopo do ranking salvo')
      onSaved()
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ranking-scope-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
              <Settings2 className="w-4 h-4 text-gray-600" />
            </div>
            <div>
              <h3 id="ranking-scope-title" className="text-base font-bold text-gray-900">Escopo do ranking</h3>
              <p className="text-xs text-gray-500">Funis e etapas que entram nas métricas</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Leads, Atend., T. Resp. e SLA usam as etapas ativas marcadas. Ganhou e Perdeu ficam de fora dessas colunas e continuam em Conversão e Receita, nos funis incluídos.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('all')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium border ${mode === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              Todos os funis
            </button>
            <button
              type="button"
              onClick={() => setMode('custom')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium border ${mode === 'custom' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              Personalizado
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando funis...
            </div>
          )}

          {!loading && mode === 'custom' && funnels.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-6">Nenhum funil encontrado para esta empresa.</p>
          )}

          {!loading && mode === 'custom' && funnels.map(funnel => {
            const stages = stagesByFunnel[funnel.id] ?? []
            const active = stages.filter(stage => stage.stage_type === 'active')
            const fixed = stages.filter(stage => stage.stage_type === 'won' || stage.stage_type === 'lost')
            const open = expanded === funnel.id
            const selectedActive = active.filter(stage => stageIds.includes(stage.id)).length
            return (
              <div key={funnel.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50"
                  onClick={() => {
                    const next = open ? null : funnel.id
                    setExpanded(next)
                    if (next) void loadStages(funnel.id)
                  }}
                >
                  <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={funnelIds.includes(funnel.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleFunnel(funnel.id)}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    {funnel.name}
                    {selectedActive > 0 && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{selectedActive} etapas</span>
                    )}
                  </span>
                  {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                </button>
                {open && (
                  <div className="bg-gray-50 px-3 pb-3 pt-1 space-y-1">
                    {active.length > 0 && (
                      <div className="flex justify-end">
                        <button type="button" onClick={() => selectActiveStages(funnel.id, stages)} className="text-xs text-indigo-600">
                          {active.every(stage => stageIds.includes(stage.id)) ? 'Limpar etapas' : 'Selecionar etapas ativas'}
                        </button>
                      </div>
                    )}
                    {active.map(stage => (
                      <label key={stage.id} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={stageIds.includes(stage.id)}
                          onChange={() => toggleStage(stage.id, funnel.id)}
                          className="rounded border-gray-300 text-indigo-600"
                        />
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.name}{stage.is_hidden ? ' (oculta)' : ''}
                      </label>
                    ))}
                    {fixed.map(stage => (
                      <label key={stage.id} className="flex items-center gap-2 py-1 text-sm text-gray-400">
                        <input type="checkbox" checked={false} disabled className="rounded border-gray-300" />
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.name}
                        <span className="text-[10px]">Fixa</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
