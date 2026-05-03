// =====================================================
// AiAnalyticsPromptsPanel
//
// Painel de configuração de prompts complementares da IA Analítica.
// Localização: Configurações → Agentes Globais → aba "IA Analítica"
//
// Para cada um dos 3 tipos MVP:
//   - Textarea (máx. 1000 chars) com contador
//   - Toggle ativo/inativo
//   - Botão salvar individual
//
// Regra obrigatória exibida ao usuário:
//   "Este texto complementa o prompt base. Não substitui regras de segurança."
// =====================================================

import { useCallback, useEffect, useState } from 'react'
import { Brain, Save, Loader2, CheckCircle2, AlertCircle, TrendingDown, Thermometer, LayoutList } from 'lucide-react'
import { dashboardApi } from '../../services/dashboardApi'
import type { AiAnalysisType, AiPromptItem } from '../../services/dashboardApi'

// ── Metadados dos tipos ───────────────────────────────────────────────────────

const TYPE_META: Record<AiAnalysisType, { label: string; description: string; icon: React.ReactNode; placeholder: string }> = {
  cooling_opportunities: {
    label:       'Oportunidades esfriando',
    description: 'Leads parados sem interação recente.',
    icon:        <Thermometer size={15} className="text-orange-500" />,
    placeholder: 'Ex: Nosso ciclo de vendas típico é de 30 dias. Priorize oportunidades com probabilidade acima de 50%.',
  },
  conversion_drop: {
    label:       'Queda de conversão',
    description: 'Gargalos entre etapas do funil.',
    icon:        <TrendingDown size={15} className="text-red-500" />,
    placeholder: 'Ex: A etapa "Proposta" costuma ter baixa conversão no nosso segmento. Sugira ações para qualificação prévia.',
  },
  funnel_overview: {
    label:       'Visão geral do funil',
    description: 'Saúde geral do pipeline.',
    icon:        <LayoutList size={15} className="text-indigo-500" />,
    placeholder: 'Ex: Nosso foco atual é aumentar o ticket médio. Considere esse contexto nas recomendações estratégicas.',
  },
}

const MAX_CHARS = 1000

// ── Tipos internos ────────────────────────────────────────────────────────────

interface PromptFormState {
  custom_prompt: string
  is_active:     boolean
  saving:        boolean
  saved:          boolean
  error:         string | null
}

// ── Componente ────────────────────────────────────────────────────────────────

interface Props {
  companyId: string
}

export function AiAnalyticsPromptsPanel({ companyId }: Props) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Estado local por tipo
  const [forms, setForms] = useState<Record<AiAnalysisType, PromptFormState>>({
    cooling_opportunities: { custom_prompt: '', is_active: false, saving: false, saved: false, error: null },
    conversion_drop:       { custom_prompt: '', is_active: false, saving: false, saved: false, error: null },
    funnel_overview:       { custom_prompt: '', is_active: false, saving: false, saved: false, error: null },
  })

  // ── Carregamento ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await dashboardApi.getAiPrompts(companyId)
      const next = { ...forms }
      for (const item of res.data as AiPromptItem[]) {
        const type = item.analysis_type as AiAnalysisType
        if (next[type] !== undefined) {
          next[type] = {
            custom_prompt: item.custom_prompt ?? '',
            is_active:     item.is_active,
            saving:        false,
            saved:         false,
            error:         null,
          }
        }
      }
      setForms(next)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar prompts')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  useEffect(() => { void load() }, [load])

  // ── Salvar ──────────────────────────────────────────────────────────────────

  const handleSave = async (type: AiAnalysisType) => {
    const form = forms[type]
    if (form.custom_prompt.length > MAX_CHARS) return

    setForms(prev => ({ ...prev, [type]: { ...prev[type], saving: true, error: null, saved: false } }))
    try {
      await dashboardApi.saveAiPrompt(companyId, {
        analysis_type: type,
        custom_prompt: form.custom_prompt,
        is_active:     form.is_active,
      })
      setForms(prev => ({ ...prev, [type]: { ...prev[type], saving: false, saved: true } }))
      setTimeout(() => setForms(prev => ({ ...prev, [type]: { ...prev[type], saved: false } })), 3000)
    } catch (err) {
      setForms(prev => ({
        ...prev,
        [type]: {
          ...prev[type],
          saving: false,
          error: err instanceof Error ? err.message : 'Erro ao salvar',
        },
      }))
    }
  }

  const patch = (type: AiAnalysisType, update: Partial<PromptFormState>) => {
    setForms(prev => ({ ...prev, [type]: { ...prev[type], ...update, saved: false, error: null } }))
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={24} className="animate-spin text-violet-400" />
    </div>
  )

  if (loadError) return (
    <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center gap-2">
      <AlertCircle size={15} className="flex-shrink-0" />
      {loadError}
    </div>
  )

  return (
    <div className="space-y-5">

      {/* Aviso obrigatório */}
      <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
        <Brain size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700 leading-relaxed">
          <strong>Como funciona:</strong> Este texto <em>complementa</em> o prompt base da IA.
          Ele é inserido após as instruções de análise e antes dos dados.
          Não substitui as regras de segurança, o schema JSON ou a instrução de tipo.
          Use para ajustar tom, profundidade ou foco estratégico das recomendações.
        </p>
      </div>

      {/* Cards por tipo */}
      {(Object.entries(TYPE_META) as [AiAnalysisType, typeof TYPE_META[AiAnalysisType]][]).map(([type, meta]) => {
        const form  = forms[type]
        const chars = form.custom_prompt.length
        const over  = chars > MAX_CHARS

        return (
          <div key={type} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">

            {/* Cabeçalho do tipo */}
            <div className="flex items-center gap-2">
              {meta.icon}
              <div>
                <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                <p className="text-xs text-slate-400">{meta.description}</p>
              </div>
            </div>

            {/* Textarea */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Complemento de instrução (opcional)
              </label>
              <textarea
                rows={4}
                value={form.custom_prompt}
                onChange={(e) => patch(type, { custom_prompt: e.target.value })}
                placeholder={meta.placeholder}
                className={`w-full px-3 py-2 border rounded-lg text-sm resize-y font-mono focus:ring-2 focus:ring-violet-400 focus:border-violet-400 transition-colors ${
                  over ? 'border-red-300 bg-red-50' : 'border-slate-200'
                }`}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-slate-400">
                  Insira contexto comercial: tom, foco, segmento, prioridades da equipe.
                </p>
                <span className={`text-xs font-medium ${over ? 'text-red-600' : 'text-slate-400'}`}>
                  {chars}/{MAX_CHARS}
                </span>
              </div>
            </div>

            {/* Toggle ativo */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Complemento ativo</p>
                <p className="text-xs text-slate-400">Se inativo, apenas o prompt base é usado</p>
              </div>
              <button
                type="button"
                onClick={() => patch(type, { is_active: !form.is_active })}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  form.is_active ? 'bg-violet-600' : 'bg-slate-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    form.is_active ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Feedback de erro */}
            {form.error && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle size={12} /> {form.error}
              </p>
            )}

            {/* Botão salvar */}
            <div className="flex items-center justify-end gap-2">
              {form.saved && (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 size={12} /> Salvo
                </span>
              )}
              <button
                type="button"
                onClick={() => handleSave(type)}
                disabled={form.saving || over}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
              >
                {form.saving
                  ? <><Loader2 size={13} className="animate-spin" /> Salvando...</>
                  : <><Save size={13} /> Salvar</>
                }
              </button>
            </div>

          </div>
        )
      })}
    </div>
  )
}
