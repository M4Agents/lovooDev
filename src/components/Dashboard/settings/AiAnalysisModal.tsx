// =====================================================
// AiAnalysisModal
//
// Container do modal de IA Analítica sob demanda.
// Orquestra as 9 views definidas em AiAnalysisModalViews.
//
// Estados:
//   selecting, preview, processing, result,
//   insufficient_credits, checkout_pending,
//   ready_to_continue, error, history
// =====================================================

import React from 'react'
import { X, Brain, History } from 'lucide-react'
import {
  StepSelecting, StepPreview, StepProcessing, StepResult,
  StepInsufficientCredits, StepCheckoutPending, StepReadyToContinue,
  StepError, StepHistory,
} from './AiAnalysisModalViews'
import type { AiAnalysisType, AiAnalysisResult, AiAnalysisSummary } from '../../../services/dashboardApi'
import type { AiAnalysisStep, AiCreditInfo } from '../../../hooks/dashboard/useDashboardAiAnalysis'

// ── Props ─────────────────────────────────────────────────────────────────────

interface AiAnalysisModalProps {
  isOpen:             boolean
  step:               AiAnalysisStep
  analysisType:       AiAnalysisType | null
  analysisId:         string | null
  result:             AiAnalysisResult | null
  creditInfo:         AiCreditInfo | null
  error:              string | null
  loading:            boolean
  history:            AiAnalysisSummary[]
  historyLoading:     boolean
  funnelId?:          string | null
  onClose:            () => void
  onSelectType:       (t: AiAnalysisType) => void
  onBack:             () => void
  onExecute:          () => void
  onContinue:         () => void
  onViewAnalysis:     (id: string) => void
  onOpenHistory:      () => void
  onInitiateCheckout: (packageId: string, analysisId: string | null) => void
  onReset:            () => void
}

// ── Componente ────────────────────────────────────────────────────────────────

export const AiAnalysisModal: React.FC<AiAnalysisModalProps> = ({
  isOpen, step, analysisType, analysisId, result, creditInfo, error,
  loading, history, historyLoading, funnelId,
  onClose, onSelectType, onBack, onExecute, onContinue,
  onViewAnalysis, onOpenHistory, onInitiateCheckout, onReset,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Painel */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-indigo-600" />
            <h2 className="text-sm font-semibold text-gray-900">Análise com IA</h2>
          </div>
          <div className="flex items-center gap-2">
            {step !== 'history' && (
              <button
                type="button"
                onClick={onOpenHistory}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded transition-colors"
              >
                <History size={13} /> Histórico
              </button>
            )}
            <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors">
              <X size={16} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'selecting' && (
            <StepSelecting onSelect={onSelectType} />
          )}
          {step === 'preview' && analysisType && (
            <StepPreview type={analysisType} funnelId={funnelId} onBack={onBack} onExecute={onExecute} />
          )}
          {step === 'processing' && (
            <StepProcessing analysisType={analysisType} />
          )}
          {step === 'result' && result && (
            <StepResult result={result} onReset={onReset} />
          )}
          {step === 'insufficient_credits' && (
            <StepInsufficientCredits
              creditInfo={creditInfo}
              error={error}
              analysisId={analysisId}
              onCheckout={onInitiateCheckout}
              onBack={onBack}
            />
          )}
          {step === 'checkout_pending' && (
            <StepCheckoutPending onClose={onClose} />
          )}
          {step === 'ready_to_continue' && (
            <StepReadyToContinue loading={loading} onContinue={onContinue} onReset={onReset} />
          )}
          {step === 'error' && (
            <StepError error={error} onRetry={onBack} onReset={onReset} />
          )}
          {step === 'history' && (
            <StepHistory
              items={history}
              loading={historyLoading}
              onView={onViewAnalysis}
              onReset={onReset}
            />
          )}
        </div>
      </div>
    </div>
  )
}
