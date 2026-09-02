// =====================================================
// Stage Transition Questions Section
// Data: 02/09/2026 - Etapa F
//
// Seção administrativa para gerenciar perguntas de transição por etapa do funil
// =====================================================

import React, { useState, useEffect } from 'react'
import { HelpCircle, Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAccessControl } from '../../hooks/useAccessControl'
import { isStageTransitionQuestionsFeatureEnabled } from '../../hooks/dashboard/useFeatureFlags'
import { supabase } from '../../lib/supabase'
import { StageTransitionQuestionsPanel } from './StageTransitionQuestionsPanel'

interface FunnelStage {
  id: string
  name: string
  funnel_id: string
  position: number
}

export const StageTransitionQuestionsSection: React.FC = () => {
  const { company } = useAuth()
  const { canManageContactCycles } = useAccessControl() // Reusing same permission as contact cycles
  const featureEnabled = isStageTransitionQuestionsFeatureEnabled()

  const [stages, setStages] = useState<FunnelStage[]>([])
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load stages
  useEffect(() => {
    if (!featureEnabled || !company?.id) {
      setLoading(false)
      return
    }

    loadStages()
  }, [company?.id, featureEnabled])

  async function loadStages() {
    try {
      setLoading(true)
      setError(null)

      const { data: funnels, error: funnelsError } = await supabase
        .from('funnels')
        .select('id')
        .eq('company_id', company!.id)
        .order('created_at', { ascending: true })

      if (funnelsError) throw funnelsError
      if (!funnels || funnels.length === 0) {
        setStages([])
        setLoading(false)
        return
      }

      // Get all stages from all funnels
      const funnelIds = funnels.map(f => f.id)
      const { data: stagesData, error: stagesError } = await supabase
        .from('funnel_stages')
        .select('id, name, funnel_id, position')
        .in('funnel_id', funnelIds)
        .order('funnel_id', { ascending: true })
        .order('position', { ascending: true })

      if (stagesError) throw stagesError

      setStages(stagesData || [])
      
      // Auto-select first stage
      if (stagesData && stagesData.length > 0 && !selectedStageId) {
        setSelectedStageId(stagesData[0].id)
      }
    } catch (err) {
      console.error('Error loading stages:', err)
      setError('Erro ao carregar etapas')
    } finally {
      setLoading(false)
    }
  }

  // Feature disabled
  if (!featureEnabled) {
    return null
  }

  // Guard - no permission
  if (!canManageContactCycles || !company?.id) {
    return null
  }

  const selectedStage = stages.find(s => s.id === selectedStageId)

  return (
    <div className="border-t border-gray-200 pt-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HelpCircle className="w-6 h-6 text-purple-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Perguntas de Transição de Etapa
            </h3>
            <p className="text-sm text-gray-500">
              Configure perguntas personalizadas para cada etapa do funil de vendas.
            </p>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          <span className="ml-2 text-sm text-gray-600">Carregando etapas...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-red-800">{error}</span>
        </div>
      )}

      {/* No stages */}
      {!loading && !error && stages.length === 0 && (
        <div className="p-8 text-center border border-gray-200 rounded-lg bg-gray-50">
          <p className="text-sm text-gray-600">
            Nenhuma etapa encontrada. Crie etapas no funil de vendas primeiro.
          </p>
        </div>
      )}

      {/* Stage selector + Panel */}
      {!loading && !error && stages.length > 0 && (
        <div className="space-y-4">
          {/* Stage selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Selecione uma etapa:
            </label>
            <select
              value={selectedStageId || ''}
              onChange={e => setSelectedStageId(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {stages.map(stage => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>

          {/* Panel */}
          {selectedStage && (
            <div className="border border-gray-200 rounded-lg p-6 bg-white">
              <StageTransitionQuestionsPanel
                stageId={selectedStage.id}
                stageName={selectedStage.name}
                canManage={canManageContactCycles}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
