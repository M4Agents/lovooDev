// =====================================================
// Stage Transition Questions Toggle
// Data: 02/09/2026 - Etapa F
//
// Toggle isolado para enable_transition_questions
// =====================================================

import React, { useState, useEffect } from 'react'
import { Loader2, AlertCircle, HelpCircle } from 'lucide-react'
import { useStageTransitionQuestions } from '../../hooks/useStageTransitionQuestions'

interface Props {
  stageId: string
  stageName: string
  disabled?: boolean
}

export const StageTransitionQuestionsToggle: React.FC<Props> = ({
  stageId,
  stageName,
  disabled = false
}) => {
  const {
    activeCount,
    enabled,
    loading: hookLoading,
    error: hookError,
    featureEnabled,
    setEnabled
  } = useStageTransitionQuestions(stageId, false)

  const [localEnabled, setLocalEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync local state with hook
  useEffect(() => {
    if (enabled !== null) {
      setLocalEnabled(enabled)
    }
  }, [enabled])

  const handleToggle = async () => {
    const newValue = !localEnabled

    setSaving(true)
    setError(null)

    try {
      await setEnabled(newValue)
      setLocalEnabled(newValue)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar')
    } finally {
      setSaving(false)
    }
  }

  // Feature disabled
  if (!featureEnabled) {
    return null
  }

  const isDisabled = disabled || saving || hookLoading
  const hasActiveQuestions = activeCount > 0
  const showWarning = localEnabled && !hasActiveQuestions

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4 p-3 bg-purple-50 border border-purple-100 rounded-lg">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-purple-900">
            Perguntas de transição
          </p>
          <p className="text-xs text-purple-600 mt-0.5">
            Exibe perguntas personalizadas ao mover oportunidades para esta etapa.
          </p>
          {localEnabled && (
            <p className="text-xs text-purple-700 mt-1 font-medium">
              {hasActiveQuestions
                ? `${activeCount} pergunta(s) ativa(s)`
                : 'Nenhuma pergunta ativa'}
            </p>
          )}
        </div>

        {hookLoading && !saving ? (
          <Loader2 className="w-5 h-5 text-purple-600 animate-spin flex-shrink-0 mt-0.5" />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={localEnabled}
            onClick={handleToggle}
            disabled={isDisabled}
            className={[
              'relative flex-shrink-0 h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-1 disabled:opacity-50',
              localEnabled ? 'bg-purple-600' : 'bg-gray-300'
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-1',
                localEnabled ? 'translate-x-6' : 'translate-x-1'
              ].join(' ')}
            />
          </button>
        )}
      </div>

      {/* Warning: enabled but no questions */}
      {showWarning && (
        <div className="p-2.5 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-800">
            Esta etapa está configurada para perguntas de transição, mas não possui perguntas ativas.
            Configure perguntas nas configurações avançadas da etapa.
          </p>
        </div>
      )}

      {/* Error */}
      {(error || hookError) && (
        <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-800">{error || hookError}</p>
        </div>
      )}
    </div>
  )
}
