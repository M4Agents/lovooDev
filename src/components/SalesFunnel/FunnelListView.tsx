// =====================================================
// Visão em lista do funil — carga explícita, sem DnD.
// Bulk: somente tags aditivas e responsável do lead.
// =====================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { BulkAssignModal } from '../BulkAssignModal'
import { BulkTagModal } from '../BulkTagModal'
import { OpportunityDetailModal } from './OpportunityDetailModal'
import { FunnelListTable, type FunnelListGroup } from './FunnelListTable'
import { FunnelListBulkBar } from './FunnelListBulkBar'
import { useFunnelListPositions } from './useFunnelListPositions'
import { useFunnelStages } from '../../hooks/useFunnelStages'
import { useStageCounts } from '../../hooks/useStageCounts'
import { useFunnelRealtime } from '../../hooks/useFunnelRealtime'
import { useAvailableTags } from '../../hooks/useAvailableTags'
import { useAccessControl } from '../../hooks/useAccessControl'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../services/api'
import { supabase } from '../../lib/supabase'
import { funnelApi } from '../../services/funnelApi'
import type {
  DateField,
  LeadPositionFilter,
  Opportunity,
  SortOption,
} from '../../types/sales-funnel'
import type { PeriodFilter } from '../../types/analytics'
import type { ContactAttemptsState } from '../../types/contact-cycles'
import { toAssigneeFilter } from '../../utils/funnelAssigneeFilter'

const FUNNEL_REALTIME_ENABLED = true
const MAX_BULK_LEADS = 200

interface SelectedOpportunity {
  leadId: number
  opportunityId: string
  stageId: string
}

interface FunnelListViewProps {
  funnelId: string
  onLeadClick?: (leadId: number) => void
  searchTerm?: string
  selectedOrigin?: string
  selectedPeriod?: PeriodFilter | null
  selectedDateField?: DateField
  selectedTags?: string[]
  selectedTagsMode?: 'or' | 'and'
  globalSort?: SortOption
  selectedOwner?: string
  selectedCycleState?: ContactAttemptsState | null
  showCycleColumn?: boolean
}

export function FunnelListView({
  funnelId,
  onLeadClick,
  searchTerm = '',
  selectedOrigin = '',
  selectedPeriod = null,
  selectedDateField = 'created_at',
  selectedTags = [],
  selectedTagsMode = 'or',
  globalSort,
  selectedOwner,
  selectedCycleState = null,
  showCycleColumn = false,
}: FunnelListViewProps) {
  const { t } = useTranslation('funnel')
  const { company } = useAuth()
  const companyId = company?.id
  const { canSelectOpportunities, canBulkAssignLeads, canBulkTagLeads } = useAccessControl()
  const { tags: availableTags } = useAvailableTags(companyId)
  const { stages, loading: stagesLoading, error: stagesError } = useFunnelStages(funnelId)

  const [assignableUsers, setAssignableUsers] = useState<{ user_id: string; display_name: string }[]>([])
  const [selectedMap, setSelectedMap] = useState<Map<string, SelectedOpportunity>>(new Map())
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false)
  const [bulkAssignLoading, setBulkAssignLoading] = useState(false)
  const [showBulkTagModal, setShowBulkTagModal] = useState(false)
  const [bulkTagLoading, setBulkTagLoading] = useState(false)
  const [detailOpportunityId, setDetailOpportunityId] = useState<string | null>(null)
  const [detailOpportunityFetched, setDetailOpportunityFetched] = useState<Opportunity | null>(null)

  const filter = useMemo<LeadPositionFilter>(() => ({
    funnel_id: funnelId,
    search: searchTerm || undefined,
    origin: selectedOrigin || undefined,
    period_start: selectedPeriod?.type !== 'all' ? (selectedPeriod?.startDate?.toISOString() ?? undefined) : undefined,
    period_end: selectedPeriod?.type !== 'all' ? (selectedPeriod?.endDate?.toISOString() ?? undefined) : undefined,
    date_field: selectedDateField,
    tags: selectedTags.length ? selectedTags : undefined,
    tags_mode: selectedTags.length ? selectedTagsMode : undefined,
    sort_by: globalSort,
    ...toAssigneeFilter(selectedOwner),
    contact_attempts_state: selectedCycleState || undefined,
  }), [
    funnelId, searchTerm, selectedOrigin, selectedPeriod, selectedDateField,
    selectedTags, selectedTagsMode, globalSort, selectedOwner, selectedCycleState,
  ])

  const {
    stageMap,
    initialLoading,
    loadMoreStage,
    retryStage,
    refreshStages,
  } = useFunnelListPositions(funnelId, stages, companyId, filter)

  const { counts, loading: countsLoading, refresh: refreshCounts } = useStageCounts(funnelId, companyId, filter)

  useEffect(() => {
    setSelectedMap(new Map())
  }, [funnelId, companyId, filter])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    void (async () => {
      try {
        const { data } = await supabase.rpc('get_assignable_users', { p_company_id: companyId })
        if (!cancelled) setAssignableUsers(data || [])
      } catch {
        if (!cancelled) setAssignableUsers([])
      }
    })()
    return () => { cancelled = true }
  }, [companyId])

  const userById = useMemo(() => {
    const map = new Map<string, { user_id: string; display_name: string }>()
    for (const user of assignableUsers) map.set(user.user_id, user)
    return map
  }, [assignableUsers])

  const recentlyMovedRef = useRef<Map<string, number>>(new Map())
  const pendingStagesRef = useRef<Set<string>>(new Set())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshStagesRef = useRef(refreshStages)
  refreshStagesRef.current = refreshStages
  const refreshCountsRef = useRef(refreshCounts)
  refreshCountsRef.current = refreshCounts

  const flushPendingRefreshes = useCallback(() => {
    const stageIds = Array.from(pendingStagesRef.current)
    pendingStagesRef.current.clear()
    debounceTimerRef.current = null
    if (stageIds.length > 0) refreshStagesRef.current(stageIds)
  }, [])

  const coalescedRealtimeRefresh = useCallback((stageIds: string[]) => {
    stageIds.forEach(id => pendingStagesRef.current.add(id))
    if (!debounceTimerRef.current) {
      debounceTimerRef.current = setTimeout(flushPendingRefreshes, 300)
    }
  }, [flushPendingRefreshes])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      pendingStagesRef.current.clear()
    }
  }, [funnelId, companyId])

  useFunnelRealtime(
    funnelId,
    companyId,
    FUNNEL_REALTIME_ENABLED,
    coalescedRealtimeRefresh,
    () => {
      refreshCountsRef.current()
    },
    recentlyMovedRef,
  )

  const visibleStages = useMemo(
    () => stages.filter(s => !s.is_hidden).sort((a, b) => a.position - b.position),
    [stages],
  )

  const groups: FunnelListGroup[] = useMemo(() => {
    const countsReady = !countsLoading && visibleStages.length > 0 && visibleStages.every(s => counts[s.id] !== undefined)
    return visibleStages.map((stage) => {
      const state = stageMap.get(stage.id)
      return {
        stage,
        positions: state?.positions ?? [],
        loadedCount: state?.positions.length ?? 0,
        totalCount: countsReady ? (counts[stage.id]?.count ?? 0) : null,
        hasMore: state?.hasMore ?? false,
        loading: state?.loading ?? false,
        error: state?.error ?? null,
      }
    })
  }, [visibleStages, stageMap, counts, countsLoading])

  const loadedByPositionId = useMemo(() => {
    const map = new Map<string, SelectedOpportunity>()
    for (const group of groups) {
      for (const position of group.positions) {
        const leadId = position.lead_id || position.opportunity?.lead_id || position.lead?.id
        if (!leadId) continue
        map.set(position.id, {
          leadId,
          opportunityId: position.opportunity_id,
          stageId: position.stage_id,
        })
      }
    }
    return map
  }, [groups])

  const loadedCount = groups.reduce((sum, group) => sum + group.loadedCount, 0)
  const countsReady = !countsLoading && visibleStages.length > 0 && visibleStages.every(s => counts[s.id] !== undefined)
  const totalCount = countsReady
    ? visibleStages.reduce((sum, s) => sum + (counts[s.id]?.count ?? 0), 0)
    : null

  useEffect(() => {
    setSelectedMap((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Map<string, SelectedOpportunity>()
      for (const [id, item] of prev) {
        const current = loadedByPositionId.get(id)
        if (!current) {
          changed = true
          continue
        }
        if (
          current.leadId !== item.leadId
          || current.opportunityId !== item.opportunityId
          || current.stageId !== item.stageId
        ) {
          next.set(id, current)
          changed = true
        } else {
          next.set(id, item)
        }
      }
      return changed ? next : prev
    })
  }, [loadedByPositionId])

  const selectedPositionIds = useMemo(() => new Set(selectedMap.keys()), [selectedMap])
  const selectedLeadIds = useMemo(
    () => [...new Set(Array.from(selectedMap.values()).map(item => item.leadId))],
    [selectedMap],
  )

  const toggleSelect = useCallback((
    positionId: string,
    leadId: number,
    opportunityId: string,
    stageId: string,
  ) => {
    setSelectedMap(prev => {
      const next = new Map(prev)
      if (next.has(positionId)) next.delete(positionId)
      else next.set(positionId, { leadId, opportunityId, stageId })
      return next
    })
  }, [])

  const selectLoaded = useCallback(() => {
    setSelectedMap(new Map(loadedByPositionId))
  }, [loadedByPositionId])

  const clearSelection = useCallback(() => {
    setSelectedMap(new Map())
  }, [])

  const handleLoadMoreStage = useCallback(async (stageId: string) => {
    try {
      await loadMoreStage(stageId)
    } catch {
      toast.error(t('list.loadMoreError'))
    }
  }, [loadMoreStage, t])

  const handleRetryStage = useCallback(async (stageId: string) => {
    try {
      await retryStage(stageId)
    } catch {
      toast.error(t('list.stageError'))
    }
  }, [retryStage, t])

  const refreshAfterMutation = useCallback(() => {
    refreshStages()
    refreshCounts()
  }, [refreshStages, refreshCounts])

  const handleBulkAssign = useCallback(async (responsibleUserId: string | null) => {
    if (!companyId) return
    const leadIds = selectedLeadIds
    if (leadIds.length === 0) return
    if (leadIds.length > MAX_BULK_LEADS) {
      toast.error(t('list.bulkLimit'))
      return
    }

    setBulkAssignLoading(true)
    try {
      const result = await api.bulkAssignLeads(leadIds, responsibleUserId, companyId)
      if (result.updated === result.requested) {
        toast.success(
          `${result.updated} lead${result.updated !== 1 ? 's' : ''} atualizado${result.updated !== 1 ? 's' : ''}.`,
        )
      } else if (result.updated > 0) {
        toast(`${result.updated} de ${result.requested} leads atualizados.`, { icon: '⚠️' })
      } else {
        toast.error('Nenhum lead foi atualizado. Verifique suas permissões.')
      }
      setShowBulkAssignModal(false)
      clearSelection()
      refreshAfterMutation()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : undefined
      toast.error(message ?? 'Erro ao atribuir responsável. Tente novamente.')
    } finally {
      setBulkAssignLoading(false)
    }
  }, [companyId, selectedLeadIds, clearSelection, refreshAfterMutation, t])

  const handleOpenBulkTagModal = useCallback(() => {
    if (selectedLeadIds.length === 0) return
    if (selectedLeadIds.length > MAX_BULK_LEADS) {
      toast.error(t('list.bulkLimit'))
      return
    }
    setShowBulkTagModal(true)
  }, [selectedLeadIds, t])

  const handleBulkTagAssign = useCallback(async (tagIds: string[]) => {
    if (selectedLeadIds.length === 0) return
    if (selectedLeadIds.length > MAX_BULK_LEADS) {
      toast.error(t('list.bulkLimit'))
      return
    }

    setBulkTagLoading(true)
    try {
      await api.bulkTagLeads(selectedLeadIds, tagIds)
      setShowBulkTagModal(false)
      clearSelection()
      refreshAfterMutation()
      toast.success(
        `Tags atribuídas a ${selectedLeadIds.length} lead${selectedLeadIds.length !== 1 ? 's' : ''}.`,
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : undefined
      toast.error(message ?? 'Erro ao atribuir tags. Tente novamente.')
    } finally {
      setBulkTagLoading(false)
    }
  }, [selectedLeadIds, clearSelection, refreshAfterMutation])

  const detailOpportunityFromMap = useMemo((): Opportunity | null => {
    if (!detailOpportunityId) return null
    for (const state of stageMap.values()) {
      const pos = state.positions.find(p => p.opportunity_id === detailOpportunityId)
      if (pos?.opportunity) return pos.opportunity
    }
    return null
  }, [detailOpportunityId, stageMap])

  useEffect(() => {
    if (!detailOpportunityId) {
      setDetailOpportunityFetched(null)
      return
    }
    if (detailOpportunityFromMap) {
      setDetailOpportunityFetched(null)
      return
    }
    let cancelled = false
    funnelApi
      .getOpportunityById(detailOpportunityId)
      .then((opportunity) => {
        if (!cancelled) setDetailOpportunityFetched(opportunity)
      })
      .catch(() => {
        if (!cancelled) setDetailOpportunityFetched(null)
      })
    return () => {
      cancelled = true
    }
  }, [detailOpportunityId, detailOpportunityFromMap])

  const detailOpportunity = detailOpportunityFromMap ?? detailOpportunityFetched

  const handleOpportunityUpdate = useCallback((updated: Opportunity) => {
    setDetailOpportunityFetched(prev => (prev?.id === updated.id ? updated : prev))
    refreshAfterMutation()
  }, [refreshAfterMutation])

  if (stagesLoading || (stages.length > 0 && initialLoading)) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-500">
        {t('list.loading')}
      </div>
    )
  }

  if (stagesError) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-600">
        {t('list.error')}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center px-4 py-2 border-b border-gray-100">
        <p className="text-sm text-gray-600">
          {totalCount != null
            ? t('list.loadedOfTotal', { loaded: loadedCount, total: totalCount })
            : t('list.loadedCount', { loaded: loadedCount })}
        </p>
      </div>

      <div className="flex-1 overflow-hidden">
        <FunnelListTable
          groups={groups}
          canSelect={canSelectOpportunities}
          selectedPositionIds={selectedPositionIds}
          onToggleSelect={toggleSelect}
          onSelectLoaded={selectLoaded}
          onClearSelection={clearSelection}
          onRowClick={setDetailOpportunityId}
          onChatClick={onLeadClick}
          onLoadMoreStage={(stageId) => { void handleLoadMoreStage(stageId) }}
          onRetryStage={(stageId) => { void handleRetryStage(stageId) }}
          userById={userById}
          showCycleColumn={showCycleColumn}
        />
      </div>

      {canSelectOpportunities && selectedMap.size > 0 && (
        <FunnelListBulkBar
          opportunityCount={selectedMap.size}
          leadCount={selectedLeadIds.length}
          canBulkAssign={canBulkAssignLeads}
          canBulkTag={canBulkTagLeads}
          onAssign={() => {
            if (selectedLeadIds.length > MAX_BULK_LEADS) {
              toast.error(t('list.bulkLimit'))
              return
            }
            setShowBulkAssignModal(true)
          }}
          onTag={handleOpenBulkTagModal}
          onClear={clearSelection}
        />
      )}

      {detailOpportunity && companyId && (
        <OpportunityDetailModal
          isOpen={true}
          onClose={() => {
            setDetailOpportunityId(null)
            setDetailOpportunityFetched(null)
          }}
          opportunity={detailOpportunity}
          companyId={companyId}
          initialTab="journey"
          onUpdate={handleOpportunityUpdate}
        />
      )}

      {canBulkAssignLeads && (
        <BulkAssignModal
          isOpen={showBulkAssignModal}
          onClose={() => setShowBulkAssignModal(false)}
          onConfirm={handleBulkAssign}
          selectedCount={selectedLeadIds.length}
          companyUsers={assignableUsers}
          loading={bulkAssignLoading}
        />
      )}

      {canBulkTagLeads && (
        <BulkTagModal
          isOpen={showBulkTagModal}
          onClose={() => setShowBulkTagModal(false)}
          onConfirm={handleBulkTagAssign}
          selectedCount={selectedLeadIds.length}
          availableTags={availableTags.filter(tag => tag.is_active)}
          loading={bulkTagLoading}
        />
      )}
    </div>
  )
}
