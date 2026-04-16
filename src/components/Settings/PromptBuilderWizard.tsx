/**
 * PromptBuilderWizard
 *
 * Fluxo guiado de criação de agente em 5 etapas:
 *   1. Básico          — nome, modelo, idioma
 *   2. Dados detectados — empresa + catálogo (informativo, sem input)
 *   3. Configuração    — 4 campos opcionais + chat de suporte
 *   4. Preview         — revisão editável por bloco + salvar
 *   5. Sucesso         — confirmação com ações pós-criação
 *
 * O usuário NÃO escreve prompt manualmente.
 * A UX evita termos técnicos (sem "prompt", "config", "runtime").
 */

import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Sparkles } from 'lucide-react'
import { supabase, type Company } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { promptBuilderApi, type FlatPromptConfig } from '../../services/promptBuilderApi'
import { companyOwnAgentsApi, type CompanyAgent, type CreateCompanyAgentPayload } from '../../services/companyOwnAgentsApi'
import { PromptBuilderStepper } from './PromptBuilderStepper'
import { PromptBuilderSupportChat } from './PromptBuilderSupportChat'
import {
  StepDetectedData,
  StepUserAnswers,
  StepPreview,
  type CatalogItem,
  type UserAnswers,
} from './PromptBuilderSteps'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Props {
  companyId:     string
  onSaved:       (agent: CompanyAgent) => void
  onAdvanced:    () => void
  onCancel:      () => void
  /** Quando `true`, remove o card externo e o header interno (usados pelo AgentCreationModal). */
  insideModal?:  boolean
  /** Notifica o pai sempre que o step muda (usado pelo modal para stepper e confirmação). */
  onStepChange?: (step: number) => void
  /**
   * Callback para abrir o sandbox.
   * Recebe (promptConfig, finalAgentName, companyName) — tudo necessário para o sandbox.
   * Se ausente, o botão "Testar agente" não é exibido.
   */
  onTest?: (config: FlatPromptConfig, agentName: string, companyName: string) => void
}

const AVAILABLE_MODELS = [
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (recomendado)' },
  { value: 'gpt-4.1',      label: 'GPT-4.1' },
  { value: 'gpt-4o-mini',  label: 'GPT-4o Mini' },
  { value: 'gpt-4o',       label: 'GPT-4o' },
]

const AVAILABLE_LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'es',    label: 'Español' },
]

// ── Etapa 1 — Básico ──────────────────────────────────────────────────────────

function StepBasic({
  name, setName,
  assistantName, setAssistantName,
  model, setModel,
  language, setLanguage,
  onContinue, onAdvanced, onCancel,
}: {
  name:           string; setName:           (v: string) => void
  assistantName:  string; setAssistantName:  (v: string) => void
  model:          string; setModel:          (v: string) => void
  language:       string; setLanguage:       (v: string) => void
  onContinue:     () => void
  onAdvanced:     () => void
  onCancel:       () => void
}) {
  const canContinue = name.trim().length >= 2

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Nome do agente <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          placeholder="Ex: Assistente de Vendas, Bia, Atendente Virtual..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <p className="text-xs text-gray-400 mt-1">
          Esse é o nome interno do agente. Pode ser alterado depois.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Como o assistente vai se chamar?{' '}
          <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <input
          type="text"
          value={assistantName}
          onChange={e => setAssistantName(e.target.value)}
          placeholder="Ex: Maia, Ana, Carlos, Atendimento..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <p className="text-xs text-gray-400 mt-1">
          Nome que o assistente usará ao se apresentar para clientes. Se vazio, usamos um padrão automático.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Modelo de IA</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          >
            {AVAILABLE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Idioma</label>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          >
            {AVAILABLE_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        <button onClick={onAdvanced} className="underline text-blue-600 hover:text-blue-800">
          Prefere a configuração avançada?
        </button>
        {' '}Você pode escrever o prompt manualmente.
      </p>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">
          Cancelar
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white
                     text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          Continuar →
        </button>
      </div>
    </div>
  )
}

// ── Etapa 5 — Sucesso ─────────────────────────────────────────────────────────

function StepSuccess({
  agentName, onView, onReset, onTest,
}: {
  agentName: string
  onView:    () => void
  onReset:   () => void
  onTest?:   () => void
}) {
  return (
    <div className="flex flex-col items-center text-center py-8 gap-6">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
        <Check className="w-8 h-8 text-green-600" />
      </div>

      <div className="space-y-2">
        <h4 className="text-lg font-semibold text-gray-900">
          Agente criado com sucesso!
        </h4>
        <p className="text-sm font-medium text-gray-600">
          <span className="text-gray-900 font-semibold">{agentName}</span> já está pronto
          para conversar com seus clientes 🎉
        </p>
        <p className="text-xs text-gray-400 max-w-xs mx-auto leading-relaxed">
          Conecte ao WhatsApp nas configurações de integração para começar a receber mensagens.
        </p>
      </div>

      <div className="flex flex-col gap-2.5 w-full max-w-xs">
        <button
          onClick={onView}
          className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg
                     hover:bg-blue-700 transition-colors font-semibold shadow-sm"
        >
          Ver agente
        </button>
        {onTest ? (
          <button
            onClick={onTest}
            className="w-full px-4 py-2.5 bg-violet-50 text-violet-700 border border-violet-200
                       text-sm rounded-lg hover:bg-violet-100 transition-colors font-medium
                       flex items-center justify-center gap-2"
          >
            🧪 Testar agente agora
          </button>
        ) : (
          <button
            disabled
            title="Em breve"
            className="w-full px-4 py-2.5 bg-white border border-gray-200 text-gray-400
                       text-sm rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
          >
            Testar agente agora
            <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">
              Em breve
            </span>
          </button>
        )}
        <button
          onClick={onReset}
          className="w-full px-4 py-2 text-gray-500 text-sm hover:text-gray-700 transition-colors"
        >
          Criar outro agente
        </button>
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

export function PromptBuilderWizard({ companyId, onSaved, onAdvanced, onCancel, insideModal, onStepChange, onTest }: Props) {
  const { company }                     = useAuth()

  // Etapas: 1=Básico, 2=Dados, 3=Config, 4=Preview, 5=Sucesso
  const [step, setStep]                 = useState<1|2|3|4|5>(1)

  // Referência estável para onStepChange (evita re-registrar o effect a cada render)
  const onStepChangeRef = useRef(onStepChange)
  useEffect(() => { onStepChangeRef.current = onStepChange }, [onStepChange])

  // Notifica o modal pai sempre que o step muda
  useEffect(() => { onStepChangeRef.current?.(step) }, [step])

  // Etapa 1 — nome interno
  const [agentName, setAgentName]       = useState('')
  // Etapa 1 — nome persona do assistente (opcional, não salvo diretamente)
  const [assistantName, setAssistantName] = useState('')
  const [model, setModel]               = useState('gpt-4.1-mini')
  const [language, setLanguage]         = useState('pt-BR')

  // Catálogo (carregado na montagem)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [loadingCatalog, setLoading]    = useState(true)

  // Etapa 3
  const [answers, setAnswers]           = useState<UserAnswers>({
    objective: '', communication_style: '', commercial_rules: '', custom_notes: '',
  })

  // Etapa 4
  const [promptConfig, setPromptConfig] = useState<FlatPromptConfig | null>(null)

  // Estados globais
  const [generating, setGenerating]     = useState(false)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [savedAgent, setSavedAgent]     = useState<CompanyAgent | null>(null)

  // Carrega catálogo uma vez
  useEffect(() => {
    async function load() {
      try {
        const [{ data: products }, { data: services }] = await Promise.all([
          supabase.from('products').select('id, name').eq('company_id', companyId).eq('is_active', true).limit(10),
          supabase.from('services').select('id, name').eq('company_id', companyId).eq('is_active', true).limit(10),
        ])
        setCatalogItems([...(products ?? []), ...(services ?? [])] as CatalogItem[])
      } catch { /* ignorar */ }
      finally { setLoading(false) }
    }
    void load()
  }, [companyId])

  async function handleGenerate() {
    setError(null)
    setGenerating(true)
    try {
      const result = await promptBuilderApi.generate({
        company_id:  companyId,
        userAnswers: {
          objective:           answers.objective.trim()           || undefined,
          communication_style: answers.communication_style.trim() || undefined,
          commercial_rules:    answers.commercial_rules.trim()    || undefined,
          custom_notes:        answers.custom_notes.trim()        || undefined,
          language,
        },
      })

      // Enriquecer a identidade com o nome do assistente (client-side, sem alterar backend)
      const config = { ...result.prompt_config }
      const name   = assistantName.trim()
      if (name && config.identity && !config.identity.toLowerCase().includes(name.toLowerCase())) {
        config.identity = `Você se chama ${name}. ${config.identity}`
      }
      setPromptConfig(config)
      setStep(4)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Não conseguimos gerar a configuração. Tente novamente.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave() {
    if (!promptConfig) return
    setError(null)
    setSaving(true)
    try {
      const payload: CreateCompanyAgentPayload = {
        company_id:    companyId,
        name:          agentName.trim(),
        model,
        prompt_config: promptConfig,
      }
      const saved = await companyOwnAgentsApi.create(payload)
      setSavedAgent(saved)
      setStep(5)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar agente. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setStep(1)
    setAgentName('')
    setAssistantName('')
    setModel('gpt-4.1-mini')
    setLanguage('pt-BR')
    setAnswers({ objective: '', communication_style: '', commercial_rules: '', custom_notes: '' })
    setPromptConfig(null)
    setError(null)
    setSavedAgent(null)
  }

  const companyName    = (company?.nome_fantasia ?? company?.name) as string ?? ''
  // Nome que o assistente usa ao se apresentar; fallback automático se vazio
  const finalAgentName = assistantName.trim() || (companyName ? `Atendimento ${companyName}` : 'Assistente')

  // ── Conteúdo interno (compartilhado entre modo inline e modal) ────────────

  const contextBar = step >= 2 && step <= 4 && (
    <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-100 bg-white text-xs text-gray-500">
      <span className="flex items-center gap-1">
        <Bot className="w-3.5 h-3.5 text-blue-500" />
        {agentName}
      </span>
      {companyName && (
        <span className="flex items-center gap-1">
          🏢 {companyName}
        </span>
      )}
      {catalogItems.length > 0 && (
        <span>📦 {catalogItems.length} {catalogItems.length === 1 ? 'item' : 'itens'}</span>
      )}
    </div>
  )

  // ── Bloco de steps — reutilizado nos dois modos de renderização ──────────
  const stepsContent = (
    <>
      {step === 1 && (
        <StepBasic
          name={agentName}          setName={setAgentName}
          assistantName={assistantName} setAssistantName={setAssistantName}
          model={model}             setModel={setModel}
          language={language}       setLanguage={setLanguage}
          onContinue={() => setStep(2)}
          onAdvanced={onAdvanced}
          onCancel={onCancel}
        />
      )}

      {step === 2 && (
        <StepDetectedData
          company={company as Company | null}
          catalogItems={catalogItems}
          loadingCatalog={loadingCatalog}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <StepUserAnswers
          answers={answers}
          setAnswers={setAnswers}
          onBack={() => { setError(null); setStep(2) }}
          onGenerate={() => void handleGenerate()}
          generating={generating}
          error={error}
        />
      )}

      {step === 4 && promptConfig && (
        <StepPreview
          config={promptConfig}
          setConfig={setPromptConfig}
          catalogCount={catalogItems.length}
          companyName={companyName}
          agentName={finalAgentName}
          onBack={() => { setError(null); setStep(3) }}
          onSave={() => void handleSave()}
          onTest={onTest ? () => onTest(promptConfig, finalAgentName, companyName) : undefined}
          saving={saving}
          error={error}
        />
      )}

      {step === 5 && savedAgent && (
        <StepSuccess
          agentName={savedAgent.name}
          onView={() => onSaved(savedAgent)}
          onReset={handleReset}
          onTest={onTest && promptConfig
            ? () => onTest(promptConfig, finalAgentName, companyName)
            : undefined
          }
        />
      )}
    </>
  )

  // ── Modo dentro do modal — sem card externo e sem header interno ───────────
  // O AgentCreationModal fornece: container, header, stepper e drawer de suporte.
  if (insideModal) {
    return (
      <div>
        {contextBar}
        <div className="p-5 min-h-[440px]">
          {stepsContent}
        </div>
        {/* Support chat não é renderizado aqui no modo modal —
            AgentCreationModal gerencia o drawer diretamente */}
      </div>
    )
  }

  // ── Modo inline (painel sem modal) ────────────────────────────────────────

  return (
    <div className="border border-blue-100 rounded-xl bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
            {step === 5 ? <Check className="w-4 h-4 text-green-600" /> : <Sparkles className="w-4 h-4 text-blue-600" />}
          </div>
          <div>
            <span className="text-sm font-semibold text-gray-900">
              {step === 5 ? 'Agente criado!' : 'Criar agente'}
            </span>
            {step < 5 && (
              <span className="text-xs text-gray-400 ml-2">guiado, sem escrever texto técnico</span>
            )}
          </div>
        </div>
        <PromptBuilderStepper current={step} />
      </div>

      {contextBar}

      {/* Conteúdo das etapas */}
      <div className="p-5">
        {stepsContent}
      </div>

      {/* Chat de suporte (visível a partir da etapa 3) */}
      {step >= 3 && step <= 4 && (
        <PromptBuilderSupportChat companyId={companyId} />
      )}
    </div>
  )
}
