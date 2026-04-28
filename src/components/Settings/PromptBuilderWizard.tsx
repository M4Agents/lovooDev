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
import { companyOwnAgentsApi, type CompanyAgent, type CreateCompanyAgentPayload, type UpdateCompanyAgentPayload } from '../../services/companyOwnAgentsApi'
import { PromptBuilderStepper } from './PromptBuilderStepper'
import { PromptBuilderSupportChat } from './PromptBuilderSupportChat'
import {
  StepDetectedData,
  StepUserAnswers,
  StepPreview,
  buildAdvancedText,
  parseAdvancedText,
  type CatalogItem,
  type UserAnswers,
} from './PromptBuilderSteps'
import { ConversationImportStep } from './ConversationImportStep'
import type { ConversationAnalysis } from '../../services/promptBuilderApi'

// ── Helpers de merge do assembler ─────────────────────────────────────────────
//
// Após o generate.js retornar (LLM usa empresa + catálogo para identity/objective),
// os campos comportamentais vindos do assembler de conversas (commercial_rules,
// custom_notes) são preservados integralmente — P4-P9 com dados reais das conversas.
// O merge só ocorre no fluxo automático (dentro de handleGenerate), nunca sobrescreve
// edições manuais posteriores do usuário.

/** Padrões de dados operacionais a remover antes de salvar campos do assembler. */
const ASSEMBLER_STRIP_PATTERNS: RegExp[] = [
  /\(\d{2}\)\s*\d{4,5}-?\d{4}/g,                               // telefones BR
  /\+?\d{1,3}[\s-]?\(?\d{2,3}\)?[\s-]?\d{4,5}[\s-]?\d{4}/g,  // telefones internacionais
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,        // emails
  /https?:\/\/[^\s]+/g,                                          // URLs http/https
  /www\.[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}[^\s]*/g,                  // URLs www
]

/** Remove dados operacionais de um campo do assembler antes do merge. */
function sanitizeAssemblerField(value: string): string {
  let result = value
  for (const pattern of ASSEMBLER_STRIP_PATTERNS) {
    result = result.replace(pattern, '')
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Valida um campo do assembler para merge.
 * Retorna o valor trimado ou null se inválido (tipo incorreto, vazio, fora dos limites).
 */
function validateAssemblerField(value: unknown, minLen: number, maxLen: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < minLen || trimmed.length > maxLen) return null
  return trimmed
}

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
  /**
   * Agente existente a ser editado (modo edição).
   * Quando presente, abre no Step 4 com os dados do agente pré-carregados
   * e usa update() em vez de create() ao salvar.
   */
  initialAgent?: CompanyAgent
  /**
   * Notifica o pai quando o contexto relevante do agente muda (tools ou prompt).
   * Usado pelo AgentCreationModal para repassar ao drawer de suporte.
   */
  onContextChange?: (ctx: { allowedTools: string[]; currentPrompt: string }) => void
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
  agentName, onView, onReset, onTest, isEditMode,
}: {
  agentName:   string
  onView:      () => void
  onReset:     () => void
  onTest?:     () => void
  isEditMode?: boolean
}) {
  return (
    <div className="flex flex-col items-center text-center py-8 gap-6">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
        <Check className="w-8 h-8 text-green-600" />
      </div>

      <div className="space-y-2">
        <h4 className="text-lg font-semibold text-gray-900">
          {isEditMode ? 'Agente atualizado com sucesso!' : 'Agente criado com sucesso!'}
        </h4>
        <p className="text-sm font-medium text-gray-600">
          <span className="text-gray-900 font-semibold">{agentName}</span>{' '}
          {isEditMode
            ? 'foi atualizado e já está pronto para conversar com seus clientes 🎉'
            : 'já está pronto para conversar com seus clientes 🎉'
          }
        </p>
        {!isEditMode && (
          <p className="text-xs text-gray-400 max-w-xs mx-auto leading-relaxed">
            Conecte ao WhatsApp nas configurações de integração para começar a receber mensagens.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2.5 w-full max-w-xs">
        <button
          onClick={onView}
          className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg
                     hover:bg-blue-700 transition-colors font-semibold shadow-sm"
        >
          {isEditMode ? 'Fechar' : 'Ver agente'}
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
        {!isEditMode && (
          <button
            onClick={onReset}
            className="w-full px-4 py-2 text-gray-500 text-sm hover:text-gray-700 transition-colors"
          >
            Criar outro agente
          </button>
        )}
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

// Extrai o nome do assistente do campo identity se foi inserido como "Você se chama X. ..."
function extractAssistantName(identity: string): string {
  const match = identity.match(/^Você se chama ([^.]+)\./i)
  return match ? match[1].trim() : ''
}

export function PromptBuilderWizard({ companyId, onSaved, onAdvanced, onCancel, insideModal, onStepChange, onTest, initialAgent, onContextChange }: Props) {
  const { company }                     = useAuth()
  const isEditMode                      = Boolean(initialAgent)

  // Em modo edição, iniciar direto no Step 4 (Preview com dados existentes)
  const [step, setStep]                 = useState<0|1|2|3|4|5>(isEditMode ? 4 : 0)

  // Referência estável para onStepChange (evita re-registrar o effect a cada render)
  const onStepChangeRef = useRef(onStepChange)
  useEffect(() => { onStepChangeRef.current = onStepChange }, [onStepChange])

  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '57d61d' },
      body: JSON.stringify({
        sessionId: '57d61d', location: 'PromptBuilderWizard.tsx:mount', message: 'wizard mount state',
        data: {
          isEditMode,
          initialStep: isEditMode ? 4 : 0,
          agentId: initialAgent?.id ?? null,
          hasPromptConfig: initialAgent?.prompt_config != null,
          editing_mode: (initialAgent?.model_config as Record<string,unknown> | undefined)?.editing_mode ?? null,
          promptRawLength: initialAgent?.prompt?.length ?? 0,
        },
        timestamp: Date.now(),
        hypothesisId: 'H1',
      })
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // #endregion

  // Notifica o modal pai sempre que o step muda
  useEffect(() => { onStepChangeRef.current?.(step) }, [step])

  // Referência estável para onContextChange
  const onContextChangeRef = useRef(onContextChange)
  useEffect(() => { onContextChangeRef.current = onContextChange }, [onContextChange])

  // Etapa 1 — nome interno (pré-preenchido em modo edição)
  const [agentName, setAgentName]       = useState(initialAgent?.name ?? '')
  // Etapa 1 — nome persona do assistente (extraído do identity em modo edição)
  const [assistantName, setAssistantName] = useState(
    initialAgent?.prompt_config
      ? extractAssistantName(String((initialAgent.prompt_config as Record<string,unknown>).identity ?? ''))
      : ''
  )
  const [model, setModel]               = useState(initialAgent?.model ?? 'gpt-4.1-mini')
  const [language, setLanguage]         = useState('pt-BR')

  // Catálogo (carregado na montagem)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [loadingCatalog, setLoading]    = useState(true)

  // Etapa 0 — análise de conversas importadas
  const [conversationAnalysis, setConversationAnalysis] = useState<ConversationAnalysis | null>(null)

  // Etapa 3
  const [answers, setAnswers]           = useState<UserAnswers>({
    objective: '', communication_style: '', commercial_rules: '', custom_notes: '',
  })

  // Etapa 4 — em modo edição, pré-carregar o prompt_config existente
  const [promptConfig, setPromptConfig] = useState<FlatPromptConfig | null>(() => {
    if (!initialAgent?.prompt_config) return null
    const pc = initialAgent.prompt_config as Record<string, unknown>
    // Aceitar apenas formato flat (criado pelo wizard); sections format não é compatível
    if ('identity' in pc && !('sections' in pc)) {
      return pc as FlatPromptConfig
    }
    return null
  })

  // Base de conhecimento complementar (campo livre, opcional, máx 5000 chars)
  // Persiste em knowledge_base na tabela lovoo_agents.
  // Não faz parte do prompt_config — injetada separadamente no runtime pelo runner.
  const [knowledgeBase, setKnowledgeBase] = useState<string>(
    initialAgent?.knowledge_base ?? ''
  )

  // Ferramentas habilitadas para este agente (function calling OpenAI).
  // Inicializa com o valor existente em modo edição; vazio em modo criação.
  const [allowedTools, setAllowedTools] = useState<string[]>(
    initialAgent?.allowed_tools ?? []
  )

  // Documentos RAG — presença de documentos ativos (status ready | processing).
  // Atualizado pelo AgentDocumentsSection via callback onHasActiveDocsChange.
  // Usado apenas para derivar knowledge_mode no save.
  const [hasActiveDocs, setHasActiveDocs] = useState<boolean>(false)

  // Modo de edição avançada — editável manualmente sem regeneração por IA.
  // Persiste em model_config.editing_mode = 'advanced_manual'.
  // Irreversível por agente: uma vez ativado, nunca volta ao fluxo assistido.
  const [advancedManualActive, setAdvancedManualActive] = useState<boolean>(
    () => initialAgent?.model_config?.editing_mode === 'advanced_manual'
  )

  // Texto livre do modo avançado.
  // Inicializado apenas quando o modo avançado já está ativo ao carregar o agente.
  // Prioridade 1: agent.prompt raw (salvo por saves anteriores em modo avançado — prompt_config = null).
  // Prioridade 2: reconstruir via buildAdvancedText (migração de agentes salvos no modo estruturado).
  const [advancedText, setAdvancedText] = useState<string>(() => {
    const isAdvanced = initialAgent?.model_config?.editing_mode === 'advanced_manual'
    if (!isAdvanced) return ''
    // Se prompt_config já foi limpo (save avançado anterior), usar prompt raw diretamente
    if (!initialAgent?.prompt_config) return initialAgent?.prompt ?? ''
    // Migração: reconstruir texto a partir do flat prompt_config
    const pc = initialAgent.prompt_config as Record<string, unknown>
    if ('identity' in pc && !('sections' in pc)) {
      return buildAdvancedText(pc as FlatPromptConfig)
    }
    return initialAgent?.prompt ?? ''
  })

  // Notifica o pai (AgentCreationModal) sempre que tools ou prompt mudam
  useEffect(() => {
    onContextChangeRef.current?.({ allowedTools, currentPrompt: advancedText })
  }, [allowedTools, advancedText])

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

      // Preservar campos comportamentais do assembler (P4–P9) quando a análise de
      // conversas gerou um suggested_prompt_config válido. O LLM do generate.js é
      // melhor para identity/objective (usa empresa + catálogo); o assembler é melhor
      // para commercial_rules/custom_notes (usa padrões reais das conversas).
      // Validação e sanitização leve antes do merge — evita congelamento de dados
      // operacionais específicos que possam ter chegado via objection_responses.
      const assemblerSpc = conversationAnalysis?.suggested_prompt_config
      if (assemblerSpc) {
        const cleanRules = validateAssemblerField(assemblerSpc.commercial_rules, 10, 800)
        if (cleanRules) {
          config.commercial_rules = sanitizeAssemblerField(cleanRules)
        }
        const cleanNotes = validateAssemblerField(assemblerSpc.custom_notes, 10, 1500)
        if (cleanNotes) {
          config.custom_notes = sanitizeAssemblerField(cleanNotes)
        }
      }

      setPromptConfig(config)
      setAdvancedText(buildAdvancedText(config))
      setAdvancedManualActive(true)
      setStep(4)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Não conseguimos gerar a configuração. Tente novamente.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave() {
    // Modo avançado: salva o texto bruto diretamente como prompt (sem parsing de campos).
    // Isso preserva 100% do conteúdo — seções customizadas, estruturas livres, etc.
    // prompt_config é explicitamente limpo (null) para que o agentExecutor use prompt raw.
    //
    // Modo normal: converte promptConfig estruturado → prompt via backend template engine.

    if (advancedManualActive && !advancedText.trim()) {
      setError('O prompt não pode estar vazio.')
      return
    }
    if (!advancedManualActive && !promptConfig) return

    setError(null)
    setSaving(true)
    try {
      let saved: CompanyAgent

      // model_config: preserva flags existentes e, se advanced, adiciona editing_mode.
      const baseModelConfig = initialAgent?.model_config ?? {}
      const modelConfigPayload: Record<string, unknown> = advancedManualActive
        ? { ...baseModelConfig, editing_mode: 'advanced_manual' }
        : baseModelConfig

      // knowledge_base e knowledge_mode — derivados automaticamente:
      //   KB + docs → 'hybrid' | KB only → 'inline' | docs only → 'rag' | neither → 'none'
      const kbTrimmed    = knowledgeBase.trim()
      const kbPayload    = kbTrimmed || undefined
      const kbModePayload: 'none' | 'inline' | 'rag' | 'hybrid' =
        kbTrimmed && hasActiveDocs ? 'hybrid'
        : kbTrimmed               ? 'inline'
        : hasActiveDocs           ? 'rag'
        : 'none'

      if (isEditMode && initialAgent?.id) {
        // Modo edição — atualiza agente existente
        const payload: UpdateCompanyAgentPayload = {
          company_id:   companyId,
          agent_id:     initialAgent.id,
          name:         agentName.trim() || initialAgent.name,
          model,
          knowledge_base: kbPayload ?? '',
          knowledge_mode: kbModePayload,
          allowed_tools:  allowedTools,
          model_config:   Object.keys(modelConfigPayload).length > 0 ? modelConfigPayload : undefined,
        }

        if (advancedManualActive) {
          // Modo avançado: prompt raw — sem parsing, sem limites por campo, sem perda de seções
          payload.prompt        = advancedText.trim()
          payload.prompt_config = null   // limpa prompt_config → agentExecutor usará prompt diretamente
        } else {
          // Modo estruturado: prompt montado pelo backend a partir do prompt_config
          payload.prompt_config  = promptConfig!
          payload.prompt_version = initialAgent.prompt_version ?? 0
        }

        saved = await companyOwnAgentsApi.update(payload)
      } else {
        // Modo criação — cria novo agente
        const payload: CreateCompanyAgentPayload = {
          company_id:     companyId,
          name:           agentName.trim(),
          model,
          knowledge_base: kbPayload,
          knowledge_mode: kbModePayload,
          allowed_tools:  allowedTools,
          model_config:   Object.keys(modelConfigPayload).length > 0 ? modelConfigPayload : undefined,
        }

        if (advancedManualActive) {
          payload.prompt = advancedText.trim()
        } else {
          payload.prompt_config = promptConfig!
        }

        saved = await companyOwnAgentsApi.create(payload)
      }

      setSavedAgent(saved)
      setStep(5)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar agente. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Ativa o modo de edição avançada para este agente.
   * Irreversível: o flag é salvo em model_config na próxima vez que handleSave rodar.
   * Inicializa advancedText com os 5 campos do promptConfig atual concatenados.
   */
  function activateAdvancedManual() {
    if (promptConfig) setAdvancedText(buildAdvancedText(promptConfig))
    setAdvancedManualActive(true)
  }

  /** Aceita a análise das conversas e pré-preenche os campos do wizard. */
  function handleConversationAnalyzed(analysis: ConversationAnalysis) {
    setConversationAnalysis(analysis)

    const spc = analysis.suggested_prompt_config
    const dp  = analysis.detected_patterns

    setAnswers(prev => {
      if (spc) {
        // Usar suggested_prompt_config diretamente quando disponível
        return {
          objective:           prev.objective           || spc.objective           || '',
          communication_style: prev.communication_style || spc.communication_style || '',
          commercial_rules:    prev.commercial_rules    || spc.commercial_rules    || '',
          custom_notes:        prev.custom_notes        || spc.custom_notes        || '',
        }
      }

      // Fallback: montar campos manualmente a partir de detected_patterns
      const questions  = dp?.frequent_customer_questions?.slice(0, 3).join('; ') ?? ''
      const objections = dp?.objections?.slice(0, 3).join('; ')                  ?? ''

      return {
        objective:           prev.objective           || analysis.analysis_summary || '',
        communication_style: prev.communication_style || dp?.tone                 || '',
        commercial_rules:    prev.commercial_rules    || '',
        custom_notes:        prev.custom_notes        || [
          questions  ? `Perguntas frequentes dos clientes: ${questions}`   : '',
          objections ? `Objeções recorrentes identificadas: ${objections}` : '',
        ].filter(Boolean).join('\n') || '',
      }
    })

    setStep(1)
  }

  function handleReset() {
    setStep(0)
    setAgentName('')
    setAssistantName('')
    setModel('gpt-4.1-mini')
    setLanguage('pt-BR')
    setAnswers({ objective: '', communication_style: '', commercial_rules: '', custom_notes: '' })
    setConversationAnalysis(null)
    setPromptConfig(null)
    setKnowledgeBase('')
    setError(null)
    setSavedAgent(null)
  }

  const companyName    = (company?.nome_fantasia ?? company?.name) as string ?? ''
  // Nome que o assistente usa ao se apresentar; fallback automático se vazio
  const finalAgentName = assistantName.trim() || (companyName ? `Atendimento ${companyName}` : 'Assistente')

  // ── Conteúdo interno (compartilhado entre modo inline e modal) ────────────

  const contextBar = step >= 2 && step <= 4 && (
    <div className="border-b border-gray-100 bg-white">
      <div className="flex items-center gap-4 px-5 py-2 text-xs text-gray-500">
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
      {conversationAnalysis && step === 3 && (
        <div className="flex items-center gap-2 px-5 py-1.5 bg-blue-50 border-t border-blue-100 text-xs text-blue-700">
          <span>💬</span>
          <span>Campos pré-preenchidos com base nas conversas importadas. Revise e ajuste antes de gerar.</span>
        </div>
      )}
    </div>
  )

  // ── Bloco de steps — reutilizado nos dois modos de renderização ──────────
  const stepsContent = (
    <>
      {step === 0 && (
        <ConversationImportStep
          companyId={companyId}
          onAnalyzed={handleConversationAnalyzed}
          onSkip={() => setStep(1)}
        />
      )}

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

      {step === 4 && (() => {
        // #region agent log
        fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '57d61d' },
          body: JSON.stringify({
            sessionId: '57d61d', location: 'PromptBuilderWizard.tsx:step4-condition', message: 'step 4 render gate',
            data: { step, promptConfigIsNull: promptConfig === null, advancedManualActive, willRender: promptConfig !== null || advancedManualActive },
            timestamp: Date.now(), hypothesisId: 'H2',
          })
        }).catch(() => {})
        // #endregion
        return null
      })()}
      {step === 4 && (promptConfig !== null || advancedManualActive) && (
        <StepPreview
          config={promptConfig ?? { identity: '', objective: '', communication_style: '', commercial_rules: '', custom_notes: '' } as FlatPromptConfig}
          setConfig={setPromptConfig}
          catalogCount={catalogItems.length}
          companyName={companyName}
          agentName={finalAgentName}
          onBack={isEditMode ? undefined : () => { setError(null); setStep(3) }}
          onSave={() => void handleSave()}
          onTest={onTest ? () => onTest(promptConfig, finalAgentName, companyName) : undefined}
          saving={saving}
          error={error}
          advancedManualActive={advancedManualActive}
          onActivateAdvancedManual={activateAdvancedManual}
          advancedText={advancedText}
          setAdvancedText={setAdvancedText}
          companyId={companyId}
          agentId={initialAgent?.id ?? null}
          knowledgeBase={knowledgeBase}
          setKnowledgeBase={setKnowledgeBase}
          hasActiveDocs={hasActiveDocs}
          onHasActiveDocsChange={setHasActiveDocs}
          allowedTools={allowedTools}
          setAllowedTools={setAllowedTools}
        />
      )}

      {step === 5 && savedAgent && (
        <StepSuccess
          agentName={savedAgent.name}
          isEditMode={isEditMode}
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
        <PromptBuilderSupportChat
          companyId={companyId}
          allowedTools={allowedTools}
          currentPrompt={advancedText}
        />
      )}
    </div>
  )
}
