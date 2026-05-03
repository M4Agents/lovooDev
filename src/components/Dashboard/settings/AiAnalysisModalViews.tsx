// =====================================================
// AiAnalysisModalViews
//
// Sub-views renderizadas por estado no AiAnalysisModal.
// Cada função corresponde a um dos 9 estados da state machine.
// =====================================================

import React, { useEffect, useState } from 'react'
import {
  Brain, TrendingDown, Thermometer, LayoutList,
  AlertCircle, CheckCircle2, Loader2, ChevronRight,
  RotateCcw, ShoppingCart, Zap,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { AiAnalysisType, AiAnalysisResult, AiAnalysisSummary } from '../../../services/dashboardApi'
import type { AiCreditInfo } from '../../../hooks/dashboard/useDashboardAiAnalysis'

// ── Constantes exportadas ─────────────────────────────────────────────────────

export const ANALYSIS_TYPES: Record<AiAnalysisType, { label: string; description: string; icon: React.ReactNode; estimatedCredits: number }> = {
  cooling_opportunities: {
    label:            'Oportunidades esfriando',
    description:      'Identifica leads que perderam engajamento e sugere ações para reativação.',
    icon:             <Thermometer size={18} />,
    estimatedCredits: 1200,
  },
  conversion_drop: {
    label:            'Queda de conversão',
    description:      'Detecta gargalos entre etapas do funil e indica onde estão as perdas.',
    icon:             <TrendingDown size={18} />,
    estimatedCredits: 1500,
  },
  funnel_overview: {
    label:            'Visão geral do funil',
    description:      'Análise completa de saúde do pipeline com diagnóstico e plano de ação.',
    icon:             <LayoutList size={18} />,
    estimatedCredits: 1800,
  },
}

const IMPACT_COLORS = { high: 'text-red-600', medium: 'text-yellow-600', low: 'text-blue-600' }

export const STATUS_LABELS: Record<string, string> = {
  completed:        'Concluída',
  failed:           'Falhou',
  processing:       'Processando',
  awaiting_credits: 'Aguardando créditos',
  credit_failed:    'Crédito falhou',
  pending:          'Pendente',
}

interface CreditPackage { id: string; name: string; credits: number; price: number }

function formatCredits(n: number): string { return n.toLocaleString('pt-BR') }
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// ── StepSelecting ─────────────────────────────────────────────────────────────

export function StepSelecting({ onSelect }: { onSelect: (t: AiAnalysisType) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 mb-4">Selecione o tipo de análise que deseja gerar:</p>
      {(Object.entries(ANALYSIS_TYPES) as [AiAnalysisType, typeof ANALYSIS_TYPES[AiAnalysisType]][]).map(([key, cfg]) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          className="w-full flex items-start gap-3 p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-left transition-colors"
        >
          <span className="mt-0.5 text-indigo-600 flex-shrink-0">{cfg.icon}</span>
          <div>
            <p className="text-sm font-medium text-gray-900">{cfg.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{cfg.description}</p>
            <p className="text-xs text-indigo-600 font-medium mt-1.5">
              ~{formatCredits(cfg.estimatedCredits)} créditos
            </p>
          </div>
          <ChevronRight size={16} className="ml-auto mt-1 text-gray-400 flex-shrink-0" />
        </button>
      ))}
    </div>
  )
}

// ── StepPreview ───────────────────────────────────────────────────────────────

export function StepPreview({ type, funnelId, onBack, onExecute }: {
  type: AiAnalysisType; funnelId?: string | null; onBack: () => void; onExecute: () => void
}) {
  const cfg = ANALYSIS_TYPES[type]
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-indigo-600">
        {cfg.icon}
        <h3 className="text-sm font-semibold">{cfg.label}</h3>
      </div>
      <p className="text-sm text-gray-600">{cfg.description}</p>
      <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-3 space-y-1.5">
        <p className="text-xs text-gray-500 font-medium">O que será analisado:</p>
        <ul className="text-xs text-gray-700 list-disc list-inside space-y-1">
          <li>Últimos 30 dias de dados</li>
          {funnelId ? <li>Funil selecionado</li> : <li>Todos os funis</li>}
          <li>Histórico de interações e movimentações</li>
        </ul>
      </div>
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 flex items-center justify-between">
        <span className="text-xs text-gray-500">Custo estimado</span>
        <span className="text-sm font-bold text-indigo-700">~{formatCredits(cfg.estimatedCredits)} créditos</span>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onBack} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Voltar
        </button>
        <button type="button" onClick={onExecute} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
          Confirmar e analisar
        </button>
      </div>
    </div>
  )
}

// ── StepProcessing ────────────────────────────────────────────────────────────

export function StepProcessing({ analysisType }: { analysisType: AiAnalysisType | null }) {
  const label = analysisType ? ANALYSIS_TYPES[analysisType]?.label : 'análise'
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4">
      <Loader2 size={36} className="text-indigo-500 animate-spin" />
      <p className="text-sm font-medium text-gray-800">Analisando {label}...</p>
      <p className="text-xs text-gray-400 text-center max-w-xs">
        A IA está processando seus dados. Isso pode levar alguns segundos.
      </p>
    </div>
  )
}

// ── StepResult ────────────────────────────────────────────────────────────────

export function StepResult({ result, onReset }: { result: AiAnalysisResult; onReset: () => void }) {
  const output = result.output
  if (!output) return <p className="text-sm text-gray-500">Resultado não disponível.</p>
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-gray-900">{output.title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{output.summary}</p>
      </div>
      {output.findings.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Achados</p>
          <ul className="space-y-1.5">
            {output.findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                <span className="mt-0.5 text-indigo-400 flex-shrink-0">•</span>{f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {output.recommended_actions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Ações recomendadas</p>
          <ul className="space-y-1.5">
            {output.recommended_actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                <CheckCircle2 size={12} className="mt-0.5 text-green-500 flex-shrink-0" />{a}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(output.next_best_actions?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Próximas ações</p>
          <div className="space-y-2">
            {output.next_best_actions.map((nba, i) => (
              <div key={i} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-800">{nba.title}</p>
                  <span className={`text-xs font-medium ${IMPACT_COLORS[nba.impact] ?? 'text-gray-500'}`}>
                    {nba.impact === 'high' ? 'Alto impacto' : nba.impact === 'medium' ? 'Médio impacto' : 'Baixo impacto'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{nba.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {(output.limitations?.length ?? 0) > 0 && (
        <div className="rounded-md bg-yellow-50 border border-yellow-100 px-3 py-2">
          <p className="text-xs text-yellow-700 font-medium mb-1">Limitações</p>
          {output.limitations.map((l, i) => (
            <p key={i} className="text-xs text-yellow-600">{l}</p>
          ))}
        </div>
      )}
      <div className="flex justify-between items-center pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          {result.credits_used != null && `${formatCredits(result.credits_used)} créditos`}
          {result.completed_at && ` · ${formatDate(result.completed_at)}`}
        </p>
        <button type="button" onClick={onReset} className="text-xs text-indigo-600 hover:underline">
          Nova análise
        </button>
      </div>
    </div>
  )
}

// ── StepInsufficientCredits ───────────────────────────────────────────────────

export function StepInsufficientCredits({ creditInfo, error, analysisId, onCheckout, onBack }: {
  creditInfo:  AiCreditInfo | null
  error:       string | null
  analysisId:  string | null
  onCheckout:  (pkg: string, aid: string | null) => void
  onBack:      () => void
}) {
  const [packages, setPackages] = useState<CreditPackage[]>([])

  useEffect(() => {
    supabase
      .from('credit_packages')
      .select('id, name, credits, price')
      .eq('is_active', true)
      .eq('is_available_for_sale', true)
      .order('credits', { ascending: true })
      .then(({ data }) => setPackages((data ?? []) as CreditPackage[]))
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg bg-orange-50 border border-orange-200 px-4 py-3">
        <AlertCircle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-orange-800">Saldo insuficiente</p>
          {creditInfo && (
            <p className="text-xs text-orange-700 mt-0.5">
              Você tem <strong>{formatCredits(creditInfo.balance)}</strong> créditos e precisa de{' '}
              <strong>~{formatCredits(creditInfo.required || creditInfo.estimated)}</strong>.
              Faltam <strong>{formatCredits(creditInfo.missing)}</strong>.
            </p>
          )}
          {error && <p className="text-xs text-orange-700 mt-1">{error}</p>}
        </div>
      </div>
      {packages.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Comprar créditos</p>
          {packages.map(pkg => (
            <button
              key={pkg.id}
              type="button"
              onClick={() => onCheckout(pkg.id, analysisId)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
            >
              <div className="flex items-center gap-2 text-left">
                <Zap size={14} className="text-indigo-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-800">{pkg.name}</p>
                  <p className="text-xs text-gray-500">{formatCredits(pkg.credits)} créditos</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">
                  {pkg.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
                <ShoppingCart size={14} className="text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-center text-gray-400 py-2">Carregando pacotes...</p>
      )}
      <button type="button" onClick={onBack} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
        Cancelar
      </button>
    </div>
  )
}

// ── StepCheckoutPending ───────────────────────────────────────────────────────

export function StepCheckoutPending({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
      <ShoppingCart size={36} className="text-indigo-400" />
      <p className="text-sm font-semibold text-gray-800">Checkout aberto em nova aba</p>
      <p className="text-xs text-gray-500 max-w-xs">
        Finalize o pagamento. Após a confirmação, volte ao dashboard para retomar a análise.
      </p>
      <button type="button" onClick={onClose} className="mt-2 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
        Fechar e aguardar
      </button>
    </div>
  )
}

// ── StepReadyToContinue ───────────────────────────────────────────────────────

export function StepReadyToContinue({ loading, onContinue, onReset }: {
  loading: boolean; onContinue: () => void; onReset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
      <CheckCircle2 size={36} className="text-green-500" />
      <p className="text-sm font-semibold text-gray-800">Créditos adicionados!</p>
      <p className="text-xs text-gray-500 max-w-xs">
        Seu saldo foi atualizado. Clique abaixo para retomar a análise.
      </p>
      <button
        type="button"
        onClick={onContinue}
        disabled={loading}
        className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
        Continuar análise
      </button>
      <button type="button" onClick={onReset} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
        Iniciar nova análise
      </button>
    </div>
  )
}

// ── StepError ─────────────────────────────────────────────────────────────────

export function StepError({ error, onRetry, onReset }: { error: string | null; onRetry: () => void; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
      <AlertCircle size={36} className="text-red-400" />
      <p className="text-sm font-semibold text-gray-800">Algo deu errado</p>
      <p className="text-xs text-gray-500 max-w-xs">{error ?? 'Erro inesperado. Tente novamente.'}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onRetry} className="flex items-center gap-1.5 px-4 py-2 text-sm text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
          <RotateCcw size={13} /> Tentar novamente
        </button>
        <button type="button" onClick={onReset} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Nova análise
        </button>
      </div>
    </div>
  )
}

// ── StepHistory ───────────────────────────────────────────────────────────────

export function StepHistory({ items, loading, onView, onReset }: {
  items: AiAnalysisSummary[]; loading: boolean; onView: (id: string) => void; onReset: () => void
}) {
  if (loading) return (
    <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-indigo-400" /></div>
  )
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Histórico de análises</p>
        <button type="button" onClick={onReset} className="text-xs text-indigo-600 hover:underline">Nova análise</button>
      </div>
      {items.length === 0 && (
        <div className="rounded-lg bg-gray-50 border border-dashed border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-400">Nenhuma análise encontrada.</p>
        </div>
      )}
      {items.map(item => {
        const cfg = ANALYSIS_TYPES[item.analysis_type]
        const canView = item.status === 'completed'
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => canView && onView(item.id)}
            disabled={!canView}
            className="w-full flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-indigo-200 hover:bg-gray-50 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="mt-0.5 text-indigo-500 flex-shrink-0">{cfg?.icon ?? <Brain size={16} />}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{item.title ?? cfg?.label ?? item.analysis_type}</p>
              <p className="text-xs text-gray-400 mt-0.5">{formatDate(item.created_at)}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
              item.status === 'completed'  ? 'bg-green-100 text-green-700' :
              ['failed', 'credit_failed'].includes(item.status) ? 'bg-red-100 text-red-600' :
              'bg-gray-100 text-gray-500'
            }`}>
              {STATUS_LABELS[item.status] ?? item.status}
            </span>
          </button>
        )
      })}
    </div>
  )
}
