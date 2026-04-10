/**
 * CompanyOwnAgentsPanel
 *
 * Permite que admins de empresa criem e gerenciem seus próprios agentes
 * conversacionais, sem depender da empresa-pai.
 *
 * Escopo MVP:
 *   - listar agentes conversacionais da empresa
 *   - criar novo agente (nome, prompt, modelo, modo de conhecimento, status)
 *   - editar agente existente
 *   - ativar/desativar agente
 *
 * Restrições:
 *   - RAG bloqueado (knowledge_mode: none | inline apenas)
 *   - agent_type sempre 'conversational' — forçado no backend
 *   - campos sensíveis ausentes do formulário
 */

import { useEffect, useState } from 'react'
import { Bot, ChevronDown, ChevronUp, Loader2, Plus, Save, X } from 'lucide-react'
import {
  companyOwnAgentsApi,
  type CompanyAgent,
  type CreateCompanyAgentPayload,
  type UpdateCompanyAgentPayload
} from '../../services/companyOwnAgentsApi'

// ── Constantes ────────────────────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  { value: 'gpt-4.1-mini',  label: 'GPT-4.1 Mini (recomendado)' },
  { value: 'gpt-4.1',       label: 'GPT-4.1' },
  { value: 'gpt-4o-mini',   label: 'GPT-4o Mini' },
  { value: 'gpt-4o',        label: 'GPT-4o' }
]

const DEFAULT_MODEL = 'gpt-4.1-mini'

// ── Tipos internos ────────────────────────────────────────────────────────────

type FormState = {
  name:           string
  description:    string
  prompt:         string
  model:          string
  knowledge_mode: 'none' | 'inline'
  is_active:      boolean
}

function emptyForm(): FormState {
  return {
    name:           '',
    description:    '',
    prompt:         '',
    model:          DEFAULT_MODEL,
    knowledge_mode: 'none',
    is_active:      true
  }
}

function agentToForm(agent: CompanyAgent): FormState {
  return {
    name:           agent.name,
    description:    agent.description ?? '',
    prompt:         agent.prompt,
    model:          agent.model,
    knowledge_mode: agent.knowledge_mode === 'inline' ? 'inline' : 'none',
    is_active:      agent.is_active
  }
}

// ── Sub-componente: formulário de criação/edição ──────────────────────────────

type AgentFormProps = {
  companyId: string
  agent?:    CompanyAgent   // undefined = criação
  onSaved:   (agent: CompanyAgent) => void
  onCancel:  () => void
}

function AgentForm({ companyId, agent, onSaved, onCancel }: AgentFormProps) {
  const isEdit               = Boolean(agent)
  const [form, setForm]      = useState<FormState>(agent ? agentToForm(agent) : emptyForm())
  const [saving, setSaving]  = useState(false)
  const [error, setError]    = useState<string | null>(null)

  function update(partial: Partial<FormState>) {
    setForm(prev => ({ ...prev, ...partial }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const name   = form.name.trim()
    const prompt = form.prompt.trim()

    if (!name)   { setError('Nome é obrigatório.'); return }
    if (!prompt) { setError('Prompt é obrigatório.'); return }

    setSaving(true)
    try {
      let saved: CompanyAgent
      if (isEdit && agent) {
        const payload: UpdateCompanyAgentPayload = {
          company_id:     companyId,
          agent_id:       agent.id,
          name,
          description:    form.description.trim() || undefined,
          prompt,
          model:          form.model,
          knowledge_mode: form.knowledge_mode,
          is_active:      form.is_active
        }
        saved = await companyOwnAgentsApi.update(payload)
      } else {
        const payload: CreateCompanyAgentPayload = {
          company_id:     companyId,
          name,
          description:    form.description.trim() || undefined,
          prompt,
          model:          form.model,
          knowledge_mode: form.knowledge_mode,
          is_active:      form.is_active
        }
        saved = await companyOwnAgentsApi.create(payload)
      }
      onSaved(saved)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar agente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-blue-200 rounded-lg bg-blue-50 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-blue-800">
          {isEdit ? 'Editar agente' : 'Novo agente conversacional'}
        </h4>
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
          value={form.name}
          onChange={e => update({ name: e.target.value })}
          placeholder="Ex: Atendente WhatsApp"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {/* Descrição */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Descrição (opcional)</label>
        <input
          type="text"
          value={form.description}
          onChange={e => update({ description: e.target.value })}
          placeholder="Breve descrição do papel do agente"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {/* Prompt */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Prompt (system) <span className="text-red-500">*</span>
        </label>
        <textarea
          value={form.prompt}
          onChange={e => update({ prompt: e.target.value })}
          rows={6}
          placeholder="Você é um assistente de atendimento da empresa X. Seu objetivo é..."
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Modelo */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Modelo</label>
          <select
            value={form.model}
            onChange={e => update({ model: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
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
            value={form.knowledge_mode}
            onChange={e => update({ knowledge_mode: e.target.value as 'none' | 'inline' })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
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
          checked={form.is_active}
          onChange={e => update({ is_active: e.target.checked })}
          className="rounded border-gray-300"
        />
        <label htmlFor="is_active_own" className="text-sm text-gray-700">
          Agente ativo
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
  agent:     CompanyAgent
  companyId: string
  onUpdated: (agent: CompanyAgent) => void
}

function AgentCard({ agent, companyId, onUpdated }: AgentCardProps) {
  const [expanded, setExpanded]   = useState(false)
  const [editing, setEditing]     = useState(false)
  const [toggling, setToggling]   = useState(false)

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
            <p className="text-sm font-medium text-gray-800 truncate">{agent.name}</p>
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
            className="text-xs px-2 py-0.5 rounded-full border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors"
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
          <p className="text-xs font-medium text-gray-500 mb-1">Prompt (system)</p>
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
  const [agents, setAgents]         = useState<CompanyAgent[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [showForm, setShowForm]     = useState(false)

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

  useEffect(() => { load() }, [companyId])

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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
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
          <button onClick={load} className="ml-2 underline text-red-600 hover:text-red-800">
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-blue-300 text-blue-700 rounded-md hover:bg-blue-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Criar primeiro agente
          </button>
        </div>
      )}
    </div>
  )
}
