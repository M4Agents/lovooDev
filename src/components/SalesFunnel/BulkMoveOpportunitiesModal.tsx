// =====================================================
// COMPONENTE: BulkMoveOpportunitiesModal
// Permite mover oportunidades de uma etapa para outra
// (mesmo funil ou funil diferente).
//
// Fluxo:
//   1. Usuário seleciona funil destino
//   2. Usuário seleciona etapa destino
//   3. Modal consulta /api/funnel/bulk-move-opportunities/count
//      com os filtros ativos (snapshot do momento do clique)
//   4. Backend calcula elegíveis — NÃO depende de IDs do frontend
//   5. Se eligible_count > 200, bloqueia com mensagem
//   6. Usuário confirma → dispara /api/funnel/bulk-move-opportunities
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { X, AlertTriangle, ArrowRight, Loader2, Filter, CheckCircle2, Ban } from 'lucide-react'
import { funnelApi } from '../../services/funnelApi'
import { supabase } from '../../lib/supabase'
import type { SalesFunnel, FunnelStage } from '../../types/sales-funnel'

interface BulkMoveOpportunitiesModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (movedCount: number) => void

  /** Contexto da etapa de origem */
  companyId: string
  fromFunnelId: string
  fromFunnelName: string
  fromStageId: string
  fromStageName: string
  fromStageType: 'active' | 'won' | 'lost'

  /**
   * Snapshot dos filtros ativos no momento em que o usuário abriu o modal.
   * undefined = sem filtros (move todas as oportunidades da etapa).
   */
  filters?: { search?: string; origin?: string; period_days?: number }
}

const STAGE_TYPE_LABEL: Record<string, string> = {
  active: 'Em andamento',
  won:    'Ganho',
  lost:   'Perdido',
}

const MAX_OPPORTUNITIES = 200

export function BulkMoveOpportunitiesModal({
  isOpen,
  onClose,
  onSuccess,
  companyId,
  fromFunnelId,
  fromFunnelName,
  fromStageId,
  fromStageName,
  fromStageType,
  filters,
}: BulkMoveOpportunitiesModalProps) {
  const [funnels, setFunnels]               = useState<SalesFunnel[]>([])
  const [stages, setStages]                 = useState<FunnelStage[]>([])
  const [selectedFunnelId, setSelectedFunnelId] = useState<string>(fromFunnelId)
  const [selectedStageId, setSelectedStageId]   = useState<string>('')

  const [loadingFunnels, setLoadingFunnels] = useState(false)
  const [loadingStages, setLoadingStages]   = useState(false)
  const [loadingCount, setLoadingCount]     = useState(false)
  const [submitting, setSubmitting]         = useState(false)

  const [eligibleCount, setEligibleCount]   = useState<number | null>(null)
  const [exceedsLimit, setExceedsLimit]     = useState(false)
  const [countError, setCountError]         = useState<string | null>(null)
  const [submitError, setSubmitError]       = useState<string | null>(null)

  // Derivado do snapshot de filtros — não do estado global atual
  const hasActiveFilters = !!(filters?.search || filters?.origin || filters?.period_days)

  // ── Carregar funis da empresa ──────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    setLoadingFunnels(true)
    funnelApi.getFunnels(companyId, { is_active: true })
      .then(data => setFunnels(data))
      .catch(() => setFunnels([]))
      .finally(() => setLoadingFunnels(false))
  }, [isOpen, companyId])

  // ── Carregar etapas do funil selecionado ───────────────────────────────
  useEffect(() => {
    if (!selectedFunnelId) return
    setStages([])
    setSelectedStageId('')
    setEligibleCount(null)
    setExceedsLimit(false)
    setLoadingStages(true)
    funnelApi.getStages(selectedFunnelId)
      .then(data => setStages(data.filter(s => !s.is_hidden)))
      .catch(() => setStages([]))
      .finally(() => setLoadingStages(false))
  }, [selectedFunnelId])

  // ── Consultar contagem real ao selecionar destino ──────────────────────
  const fetchCount = useCallback(async (toStageId: string) => {
    if (!toStageId) return
    setLoadingCount(true)
    setCountError(null)
    setEligibleCount(null)
    setExceedsLimit(false)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Sem sessão')

      const resp = await fetch('/api/funnel/bulk-move-opportunities/count', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_id:    companyId,
          from_funnel_id: fromFunnelId,
          from_stage_id:  fromStageId,
          search:        filters?.search      ?? null,
          origin:        filters?.origin      ?? null,
          period_days:   filters?.period_days ?? null,
        }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Erro ao calcular oportunidades elegíveis')
      setEligibleCount(json.eligible_count ?? 0)
      setExceedsLimit(json.exceeds_limit ?? false)
    } catch (err) {
      setCountError(err instanceof Error ? err.message : 'Erro ao buscar contagem')
    } finally {
      setLoadingCount(false)
    }
  }, [companyId, fromFunnelId, fromStageId, filters])

  useEffect(() => {
    if (selectedStageId) {
      fetchCount(selectedStageId)
    } else {
      setEligibleCount(null)
      setExceedsLimit(false)
    }
  }, [selectedStageId, fetchCount])

  // ── Reset ao fechar ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setSelectedFunnelId(fromFunnelId)
      setSelectedStageId('')
      setEligibleCount(null)
      setExceedsLimit(false)
      setCountError(null)
      setSubmitError(null)
    }
  }, [isOpen, fromFunnelId])

  // ── Executar bulk move ─────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!selectedStageId || eligibleCount === null || eligibleCount === 0 || exceedsLimit || submitting) return

    setSubmitting(true)
    setSubmitError(null)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Sem sessão')

      const resp = await fetch('/api/funnel/bulk-move-opportunities', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_id:    companyId,
          from_funnel_id: fromFunnelId,
          from_stage_id:  fromStageId,
          to_funnel_id:   selectedFunnelId,
          to_stage_id:    selectedStageId,
          search:        filters?.search      ?? null,
          origin:        filters?.origin      ?? null,
          period_days:   filters?.period_days ?? null,
        }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error ?? 'Erro ao mover oportunidades')
      onSuccess(json.moved_count ?? 0)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  const selectedStage    = stages.find(s => s.id === selectedStageId)
  const isSameStage      = selectedStageId === fromStageId && selectedFunnelId === fromFunnelId
  const canConfirm       = !!selectedStageId && !isSameStage && !loadingCount && eligibleCount !== null && eligibleCount > 0 && !exceedsLimit && !submitting
  const statusWillChange = selectedStage && selectedStage.stage_type !== fromStageType

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Mover oportunidades em massa</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Origem */}
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Origem</p>
            <p className="text-sm font-semibold text-gray-800">{fromStageName}</p>
            {fromFunnelName && (
              <p className="text-xs text-gray-500 mt-0.5">Funil: {fromFunnelName}</p>
            )}
          </div>

          {/* Aviso contextual (filtros ativos ou não) */}
          <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 p-3">
            <Filter className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800">
              {hasActiveFilters
                ? 'Todas as oportunidades que correspondem aos filtros atuais serão consideradas, independentemente da paginação.'
                : 'Todas as oportunidades desta etapa serão consideradas, mesmo que nem todas estejam carregadas na tela.'}
            </p>
          </div>

          {/* Seleção de funil destino */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Funil de destino
            </label>
            {loadingFunnels ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Carregando funis...</span>
              </div>
            ) : (
              <select
                value={selectedFunnelId}
                onChange={e => setSelectedFunnelId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {funnels.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Seleção de etapa destino */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Etapa de destino
            </label>
            {loadingStages ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Carregando etapas...</span>
              </div>
            ) : (
              <select
                value={selectedStageId}
                onChange={e => setSelectedStageId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecione uma etapa...</option>
                {stages.map(s => (
                  <option key={s.id} value={s.id} disabled={s.id === fromStageId && selectedFunnelId === fromFunnelId}>
                    {s.name}{s.id === fromStageId && selectedFunnelId === fromFunnelId ? ' (atual)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Seção de contagem — sempre visível após abrir o modal */}
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
            {loadingCount ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Calculando oportunidades elegíveis...</span>
              </div>
            ) : exceedsLimit ? (
              <div className="flex items-start gap-2">
                <Ban className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 font-medium">
                  {`Esta ação possui limite de ${MAX_OPPORTUNITIES} oportunidades por vez. Aplique filtros para reduzir o volume.`}
                  {eligibleCount !== null && (
                    <span className="block text-xs text-red-500 mt-1 font-normal">
                      {eligibleCount} oportunidades elegíveis encontradas.
                    </span>
                  )}
                </p>
              </div>
            ) : eligibleCount !== null ? (
              <div className="space-y-1">
                {eligibleCount > 0 ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    <p className="text-sm text-gray-800">
                      <span className="font-semibold text-blue-700">{eligibleCount}</span>
                      {' '}
                      {hasActiveFilters ? 'oportunidades filtradas' : 'oportunidades desta etapa'} serão movidas
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-600 font-medium">
                      Nenhuma oportunidade elegível encontrada.
                    </p>
                  </div>
                )}
                {countError && (
                  <p className="text-xs text-red-600">{countError}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">
                Selecione a etapa de destino para calcular as oportunidades elegíveis.
              </p>
            )}
          </div>

          {/* Resumo visual da movimentação */}
          {selectedStageId && !isSameStage && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 space-y-3">
              {/* Origem → Destino */}
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-700">{fromStageName}</span>
                <ArrowRight className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span className="font-medium text-blue-700">{selectedStage?.name}</span>
              </div>

              {/* Alerta de mudança de status */}
              {statusWillChange && selectedStage && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    O status das oportunidades mudará de{' '}
                    <strong>{STAGE_TYPE_LABEL[fromStageType] ?? fromStageType}</strong> para{' '}
                    <strong>{STAGE_TYPE_LABEL[selectedStage.stage_type] ?? selectedStage.stage_type}</strong>.
                    {selectedStage.stage_type === 'won' && ' closed_at será preenchido.'}
                    {selectedStage.stage_type === 'lost' && ' closed_at será preenchido.'}
                    {selectedStage.stage_type === 'active' && ' closed_at e loss_reason serão limpos.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Erro de submissão */}
          {submitError && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{submitError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting
              ? 'Movendo...'
              : eligibleCount !== null && eligibleCount > 0 && !exceedsLimit
                ? `Mover ${eligibleCount} ${eligibleCount === 1 ? 'oportunidade' : 'oportunidades'}`
                : 'Mover oportunidades'}
          </button>
        </div>
      </div>
    </div>
  )
}
