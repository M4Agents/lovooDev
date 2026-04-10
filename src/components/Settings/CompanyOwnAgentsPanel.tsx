/**
 * CompanyOwnAgentsPanel
 *
 * Permite que admins de empresa criem e gerenciem seus próprios agentes
 * conversacionais, sem depender da empresa-pai.
 *
 * Modos de edição de prompt:
 *   - structured: agente com prompt_config !== null → AgentPromptBuilder
 *   - legacy:     agente com prompt_config === null → PromptEditor
 *
 * Novos agentes sempre iniciam em modo structured.
 * Agentes legados continuam usando PromptEditor sem alteração.
 *
 * Concorrência:
 *   - Updates structured enviam prompt_version (optimistic lock)
 *   - 409 exibe mensagem de conflito com opção de recarregar
 */

import { useEffect, useState } from 'react'
import { Bot, ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Save, X } from 'lucide-react'
import {
  companyOwnAgentsApi,
  ConflictError,
  type CompanyAgent,
  type CreateCompanyAgentPayload,
  type UpdateCompanyAgentPayload
} from '../../services/companyOwnAgentsApi'
import { api } from '../../services/api'
import { PromptEditor } from '../ui/PromptEditor'
import { AgentPromptBuilder, createEmptyPromptConfig } from '../ui/AgentPromptBuilder'
import { customFieldsToVariables, type PromptConfig, type PromptVariable } from '../../lib/promptVariables'

// ── Constantes ────────────────────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (recomendado)' },
  { value: 'gpt-4.1',      label: 'GPT-4.1' },
  { value: 'gpt-4o-mini',  label: 'GPT-4o Mini' },
  { value: 'gpt-4o',       label: 'GPT-4o' }
]

const DEFAULT_MODEL = 'gpt-4.1-mini'

// ── Tipos internos ────────────────────────────────────────────────────────────

type FormMeta = {
  name:           string
  description:    string
  model:          string
  knowledge_mode: 'none' | 'inline'
  is_active:      boolean
}

function emptyMeta(): FormMeta {
  return { name: '', description: '', model: DEFAULT_MODEL, knowledge_mode: 'none', is_active: true }
}

function agentToMeta(agent: CompanyAgent): FormMeta {
  return {
    name:           agent.name,
    description:    agent.description ?? '',
    model:          agent.model,
    knowledge_mode: agent.knowledge_mode === 'inline' ? 'inline' : 'none',
    is_active:      agent.is_active
  }
}

// ── Sub-componente: formulário de criação/edição ──────────────────────────────

type AgentFormProps = {
  companyId:            string
  agent?:               CompanyAgent
  customFieldVariables: PromptVariable[]
  onSaved:              (agent: CompanyAgent) => void
  onCancel:             () => void
}

function AgentForm({ companyId, agent, customFieldVariables, onSaved, onCancel }: AgentFormProps) {
  const isEdit = Boolean(agent)

  // Determinar modo baseado no agente existente.
  // Novos agentes sempre iniciam em structured.
  const isStructured = !isEdit || agent!.prompt_config !== null

  const [meta, setMeta]       = useState<FormMeta>(isEdit ? agentToMeta(agent!) : emptyMeta())
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  // Estado de prompt — modo legacy
  const [legacyPrompt, setLegacyPrompt] = useState<string>(
    (!isStructured && agent) ? agent.prompt : ''
  )

  // Estado de prompt — modo structured
  const [promptConfig, setPromptConfig] = useState<PromptConfig>(
    (isStructured && agent?.prompt_config)
      ? agent.prompt_config
      : createEmptyPromptConfig()
  )

  function updateMeta(partial: Partial<FormMeta>) {
    setMeta(prev => ({ ...prev, ...partial }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setConflict(false)

    const name = meta.name.trim()
    if (!name) { setError('Nome é obrigatório.'); return }

    // Validação de conteúdo de prompt
    if (!isStructured) {
      if (!legacyPrompt.trim()) { setError('Prompt é obrigatório.'); return }
    } else {
      const hasActiveSection = Object.values(promptConfig.sections).some(
        s => s?.enabled && s.content.trim().length > 0
      )
      if (!hasActiveSection) { setError('Ative e preencha ao menos uma seção do prompt.'); return }
    }

    setSaving(true)
    try {
      let saved: CompanyAgent

      if (isEdit && agent) {
        // ── UPDATE ───────────────────────────────────────────────────────────
        const payload: UpdateCompanyAgentPayload = {
          company_id:     companyId,
          agent_id:       agent.id,
          name,
          description:    meta.description.trim() || undefined,
          model:          meta.model,
          knowledge_mode: meta.knowledge_mode,
          is_active:      meta.is_active,
        }

        if (isStructured) {
          payload.prompt_config  = promptConfig
          payload.prompt_version = agent.prompt_version
        } else {
          payload.prompt = legacyPrompt.trim()
        }

        saved = await companyOwnAgentsApi.update(payload)
      } else {
        // ── CREATE ───────────────────────────────────────────────────────────
        const payload: CreateCompanyAgentPayload = {
          company_id:     companyId,
          name,
          description:    meta.description.trim() || undefined,
          model:          meta.model,
          knowledge_mode: meta.knowledge_mode,
          is_active:      meta.is_active,
        }

        if (isStructured) {
          payload.prompt_config = promptConfig
        } else {
          payload.prompt = legacyPrompt.trim()
        }

        saved = await companyOwnAgentsApi.create(payload)
      }

      onSaved(saved)
    } catch (err: unknown) {
      if (err instanceof ConflictError) {
        setConflict(true)
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao salvar agente.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (conflict) {
    return (
      <div className="border border-amber-200 rounded-lg bg-amber-50 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <RefreshCw className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Conflito de edição</p>
            <p className="text-sm text-amber-700 mt-1">
              Este agente foi modificado por outra sessão enquanto você editava.
              Feche este formulário e recarregue para ver a versão mais recente.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-amber-300 rounded-md text-amber-700
                       hover:bg-amber-100 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="border border-blue-200 rounded-lg bg-blue-50 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-blue-800">
            {isEdit ? 'Editar agente' : 'Novo agente conversacional'}
          </h4>
          {isStructured && (
            <p className="text-xs text-blue-600 mt-0.5">Modo builder — prompt montado pelo servidor</p>
          )}
          {!isStructured && (
            <p className="text-xs text-gray-500 mt-0.5">Modo legado — prompt em texto livre</p>
          )}
        </div>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nome */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Nome <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={meta.name}
          onChange={e => updateMeta({ name: e.target.value })}
          placeholder="Ex: Atendente WhatsApp"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {/* Descrição */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Descrição (opcional)</label>
        <input
          type="text"
          value={meta.description}
          onChange={e => updateMeta({ description: e.target.value })}
          placeholder="Breve descrição do papel do agente"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {/* Editor de prompt — modo determinado pelo agente */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {isStructured ? 'Configuração do prompt' : 'Prompt (system)'}
          {!isStructured && <span className="text-red-500 ml-0.5">*</span>}
        </label>

        {isStructured ? (
          <AgentPromptBuilder
            value={promptConfig}
            onChange={setPromptConfig}
            disabled={saving}
            customFieldVariables={customFieldVariables}
          />
        ) : (
          <PromptEditor
            value={legacyPrompt}
            onChange={setLegacyPrompt}
            rows={7}
            disabled={saving}
            customFieldVariables={customFieldVariables}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Modelo */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Modelo</label>
          <select
            value={meta.model}
            onChange={e => updateMeta({ model: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          >
            {AVAILABLE_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Knowledge mode */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Modo de conhecimento</label>
          <select
            value={meta.knowledge_mode}
            onChange={e => updateMeta({ knowledge_mode: e.target.value as 'none' | 'inline' })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          >
            <option value="none">Nenhum</option>
            <option value="inline">Inline (base de texto)</option>
          </select>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <input
          id="is_active_own"
          type="checkbox"
          checked={meta.is_active}
          onChange={e => updateMeta({ is_active: e.target.checked })}
          className="rounded border-gray-300"
        />
        <label htmlFor="is_active_own" className="text-sm text-gray-700">Agente ativo</label>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600
                     hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white
                     rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}

// ── Sub-componente: card de agente ────────────────────────────────────────────

type AgentCardProps = {
  agent:                CompanyAgent
  companyId:            string
  customFieldVariables: PromptVariable[]
  onUpdated:            (agent: CompanyAgent) => void
}

function AgentCard({ agent, companyId, customFieldVariables, onUpdated }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [toggling, setToggling] = useState(false)

  const isStructured = agent.prompt_config !== null

  async function handleToggle() {
    setToggling(true)
    try {
      const updated = await companyOwnAgentsApi.update({
        company_id: companyId,
        agent_id:   agent.id,
        is_active:  !agent.is_active
      })
      onUpdated(updated)
    } catch {
      // silencioso — o card não recarrega se falhar
    } finally {
      setToggling(false)
    }
  }

  if (editing) {
    return (
      <AgentForm
        companyId={companyId}
        agent={agent}
        customFieldVariables={customFieldVariables}
        onSaved={a => { onUpdated(a); setEditing(false) }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${agent.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-800 truncate">{agent.name}</p>
              {isStructured && (
                <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 flex-shrink-0">
                  builder
                </span>
              )}
            </div>
            {agent.description && (
              <p className="text-xs text-gray-500 truncate">{agent.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span className="text-xs text-gray-400">{agent.model}</span>

          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              agent.is_active
                ? 'border-yellow-400 text-yellow-700 hover:bg-yellow-50'
                : 'border-green-400 text-green-700 hover:bg-green-50'
            }`}
          >
            {toggling ? '…' : agent.is_active ? 'Desativar' : 'Ativar'}
          </button>

          <button
            onClick={() => setEditing(true)}
            className="text-xs px-2 py-0.5 rounded-full border border-blue-300
                       text-blue-700 hover:bg-blue-50 transition-colors"
          >
            Editar
          </button>

          <button
            onClick={() => setExpanded(v => !v)}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Expandir prompt"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Prompt expandido */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
          <p className="text-xs font-medium text-gray-500 mb-1">
            Prompt (system){isStructured ? ' — gerado pelo builder' : ''}
          </p>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-48 overflow-y-auto">
            {agent.prompt}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

type Props = {
  companyId: string
}

export function CompanyOwnAgentsPanel({ companyId }: Props) {
  const [agents, setAgents]                        = useState<CompanyAgent[]>([])
  const [loading, setLoading]                      = useState(true)
  const [error, setError]                          = useState<string | null>(null)
  const [showForm, setShowForm]                    = useState(false)
  const [customFieldVariables, setCustomFieldVars] = useState<PromptVariable[]>([])

  useEffect(() => {
    api.getCustomFields(companyId)
      .then(fields => setCustomFieldVars(customFieldsToVariables(fields)))
      .catch(() => setCustomFieldVars([]))
  }, [companyId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await companyOwnAgentsApi.list(companyId)
      setAgents(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar agentes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [companyId])

  function handleCreated(agent: CompanyAgent) {
    setAgents(prev => [...prev, agent])
    setShowForm(false)
  }

  function handleUpdated(updated: CompanyAgent) {
    setAgents(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Meus Agentes</h3>
            <p className="text-xs text-gray-500">Agentes conversacionais desta empresa</p>
          </div>
        </div>

        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600
                       text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo agente
          </button>
        )}
      </div>

      {/* Formulário de criação */}
      {showForm && (
        <AgentForm
          companyId={companyId}
          customFieldVariables={customFieldVariables}
          onSaved={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Estado de carregamento */}
      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        </div>
      )}

      {/* Erro */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
          <button onClick={() => void load()} className="ml-2 underline text-red-600 hover:text-red-800">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Lista de agentes */}
      {!loading && !error && agents.length > 0 && (
        <div className="space-y-3">
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              companyId={companyId}
              customFieldVariables={customFieldVariables}
              onUpdated={handleUpdated}
            />
          ))}
        </div>
      )}

      {/* Estado vazio */}
      {!loading && !error && agents.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <Bot className="w-10 h-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-600">Nenhum agente criado ainda</p>
          <p className="text-xs text-gray-400 max-w-sm">
            Crie seu primeiro agente conversacional para configurar o atendimento automático pelo WhatsApp.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-blue-300
                       text-blue-700 rounded-md hover:bg-blue-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Criar primeiro agente
          </button>
        </div>
      )}
    </div>
  )
}
