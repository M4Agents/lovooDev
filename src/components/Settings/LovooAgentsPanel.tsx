/**
 * Painel Agentes Lovoo — visível apenas para admin/super_admin da empresa pai.
 *
 * Duas seções:
 *   1. Agentes cadastrados (CRUD)
 *   2. Vínculos funcionais (qual agente atua em cada uso do sistema)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot, Plus, Pencil, Trash2, Loader2, AlertCircle, Link2, LinkOff, Info,
} from 'lucide-react'
import { lovooAgentsApi } from '../../services/lovooAgentsApi'
import { fetchOpenAIModels } from '../../services/openaiIntegrationApi'
import type { AgentUseBinding, LovooAgent } from '../../types/lovoo-agents'
import { AGENT_FUNCTIONAL_USES } from '../../types/lovoo-agents'
import { LovooAgentForm } from './LovooAgentForm'

// ── Tipos internos ────────────────────────────────────────────────────────────

type BindingMap = Record<string, string> // use_id → agent_id

// ── Componente principal ──────────────────────────────────────────────────────

type Props = {
  companyId: string
}

export const LovooAgentsPanel: React.FC<Props> = ({ companyId }) => {
  const { t } = useTranslation('agents')

  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [agents, setAgents]         = useState<LovooAgent[]>([])
  const [bindings, setBindings]     = useState<AgentUseBinding[]>([])
  const [modelIds, setModelIds]     = useState<string[]>([])

  const [editingAgent, setEditingAgent] = useState<LovooAgent | null | undefined>(undefined)
  // undefined = form fechado | null = criação | LovooAgent = edição

  const [deletingId, setDeletingId]     = useState<string | null>(null)
  const [bindingLoading, setBindingLoading] = useState<string | null>(null)
  const [bindingMessage, setBindingMessage] = useState<{ useId: string; text: string; type: 'ok' | 'err' } | null>(null)
  const [agentMessage, setAgentMessage]   = useState<{ text: string; type: 'ok' | 'err' } | null>(null)

  // ── Carregamento ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [agentList, bindingList, models] = await Promise.all([
        lovooAgentsApi.listAgents(),
        lovooAgentsApi.listBindings(),
        fetchOpenAIModels().catch(() => [] as string[]),
      ])
      setAgents(agentList)
      setBindings(bindingList)
      setModelIds(models)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  // ── Mapa de bindings use_id → agent_id ──────────────────────────────────────

  const bindingMap = useMemo<BindingMap>(() => {
    const map: BindingMap = {}
    for (const b of bindings) map[b.use_id] = b.agent_id
    return map
  }, [bindings])

  // ── Grupos de usos funcionais ────────────────────────────────────────────────

  const useGroups = useMemo(() => {
    const groups: Record<string, typeof AGENT_FUNCTIONAL_USES> = {}
    for (const use of AGENT_FUNCTIONAL_USES) {
      if (!groups[use.group]) groups[use.group] = []
      groups[use.group].push(use)
    }
    return groups
  }, [])

  // ── Handlers — agentes ───────────────────────────────────────────────────────

  const handleAgentSaved = (saved: LovooAgent) => {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.id === saved.id)
      return idx >= 0
        ? prev.map((a) => (a.id === saved.id ? saved : a))
        : [saved, ...prev]
    })
    setEditingAgent(undefined)
    setAgentMessage({ text: t('messages.agentSaved'), type: 'ok' })
    setTimeout(() => setAgentMessage(null), 3000)
  }

  const handleDeleteAgent = async (agent: LovooAgent) => {
    if (!window.confirm(t('agents.confirmDelete', { name: agent.name }))) return
    setDeletingId(agent.id)
    try {
      await lovooAgentsApi.deleteAgent(agent.id)
      setAgents((prev) => prev.filter((a) => a.id !== agent.id))
      // Remove bindings que apontavam para este agente
      setBindings((prev) => prev.filter((b) => b.agent_id !== agent.id))
      setAgentMessage({ text: t('messages.agentDeleted'), type: 'ok' })
      setTimeout(() => setAgentMessage(null), 3000)
    } catch (err) {
      setAgentMessage({
        text: err instanceof Error ? err.message : t('errors.delete'),
        type: 'err',
      })
    } finally {
      setDeletingId(null)
    }
  }

  // ── Handlers — bindings ─────────────────────────────────────────────────────

  const handleBindingChange = async (useId: string, agentId: string) => {
    // Se estava vinculado a outro agente, confirmar substituição
    const currentAgentId = bindingMap[useId]
    if (currentAgentId && currentAgentId !== agentId) {
      const currentName = agents.find((a) => a.id === currentAgentId)?.name ?? '?'
      const nextName    = agents.find((a) => a.id === agentId)?.name ?? '?'
      if (!window.confirm(t('bindings.confirmReplace', { current: currentName, next: nextName }))) return
    }

    setBindingLoading(useId)
    setBindingMessage(null)
    try {
      const updated = await lovooAgentsApi.upsertBinding(useId, agentId)
      setBindings((prev) => {
        const filtered = prev.filter((b) => b.use_id !== useId)
        return [...filtered, updated]
      })
      setBindingMessage({ useId, text: t('bindings.saved'), type: 'ok' })
      setTimeout(() => setBindingMessage(null), 2500)
    } catch (err) {
      setBindingMessage({
        useId,
        text: err instanceof Error ? err.message : t('errors.bind'),
        type: 'err',
      })
    } finally {
      setBindingLoading(null)
    }
  }

  const handleRemoveBinding = async (useId: string) => {
    setBindingLoading(useId)
    setBindingMessage(null)
    try {
      await lovooAgentsApi.removeBinding(useId)
      setBindings((prev) => prev.filter((b) => b.use_id !== useId))
      setBindingMessage({ useId, text: t('bindings.removed'), type: 'ok' })
      setTimeout(() => setBindingMessage(null), 2500)
    } catch (err) {
      setBindingMessage({
        useId,
        text: err instanceof Error ? err.message : t('errors.unbind'),
        type: 'err',
      })
    } finally {
      setBindingLoading(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        <p className="text-sm">{t('loading')}</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6 flex items-center gap-3 text-red-700 text-sm">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        {loadError}
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Cabeçalho ── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Bot className="w-5 h-5 text-violet-600" />
              {t('title')}
            </h2>
            <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
          </div>
        </div>
      </div>

      {/* ── Seção 1: Agentes ── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{t('agents.title')}</h3>
          <div className="flex items-center gap-2">
            {agentMessage && (
              <span className={`text-xs ${agentMessage.type === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
                {agentMessage.text}
              </span>
            )}
            {editingAgent === undefined && (
              <button
                type="button"
                onClick={() => setEditingAgent(null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
              >
                <Plus className="w-4 h-4" />
                {t('agents.new')}
              </button>
            )}
          </div>
        </div>

        {/* Formulário inline */}
        {editingAgent !== undefined && (
          <LovooAgentForm
            companyId={companyId}
            agent={editingAgent ?? undefined}
            modelIds={modelIds}
            onSaved={handleAgentSaved}
            onCancel={() => setEditingAgent(undefined)}
          />
        )}

        {/* Lista de agentes */}
        {agents.length === 0 && editingAgent === undefined ? (
          <p className="text-sm text-slate-500 text-center py-6">{t('agents.empty')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {agents.map((agent) => (
              <div key={agent.id} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 truncate">{agent.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                        agent.is_active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {agent.is_active ? t('agents.status.active') : t('agents.status.inactive')}
                    </span>
                  </div>
                  {agent.description && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{agent.description}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5">{agent.model}</p>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingAgent(agent)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50"
                    title={t('agents.edit')}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAgent(agent)}
                    disabled={deletingId === agent.id}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                    title={t('agents.delete')}
                  >
                    {deletingId === agent.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Seção 2: Vínculos funcionais ── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{t('bindings.title')}</h3>
          <p className="text-sm text-slate-500 mt-1">{t('bindings.subtitle')}</p>
        </div>

        {agents.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 rounded-lg p-4 border border-slate-100">
            <Info className="w-4 h-4 flex-shrink-0" />
            <span>{t('agents.empty')}</span>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(useGroups).map(([group, uses]) => (
              <div key={group}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {t(`bindings.groups.${group}`, group)}
                </p>
                <div className="space-y-2">
                  {uses.map((use) => {
                    const boundAgentId = bindingMap[use.id]
                    const isBusy = bindingLoading === use.id
                    const msg = bindingMessage?.useId === use.id ? bindingMessage : null

                    return (
                      <div
                        key={use.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-100"
                      >
                        {/* Info do uso */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-slate-800">{use.label}</span>
                            {use.requires_context && (
                              <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 font-medium">
                                {t('bindings.requiresContext')}
                              </span>
                            )}
                            {use.risk_level === 'high' && (
                              <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 font-medium">
                                {t('bindings.riskHigh')}
                              </span>
                            )}
                          </div>
                          {use.description && (
                            <p className="text-xs text-slate-500 mt-0.5">{use.description}</p>
                          )}
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{use.id}</p>
                          {msg && (
                            <p className={`text-xs mt-1 ${msg.type === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
                              {msg.text}
                            </p>
                          )}
                        </div>

                        {/* Seletor de agente */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
                          ) : (
                            <>
                              <select
                                value={boundAgentId ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value
                                  if (val) void handleBindingChange(use.id, val)
                                  else void handleRemoveBinding(use.id)
                                }}
                                className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 min-w-[180px]"
                              >
                                <option value="">{t('bindings.noAgent')}</option>
                                {agents
                                  .filter((a) => a.is_active)
                                  .map((a) => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                  ))
                                }
                              </select>

                              {boundAgentId && (
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveBinding(use.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                                  title={t('bindings.removed')}
                                >
                                  <LinkOff className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {!boundAgentId && (
                                <Link2 className="w-3.5 h-3.5 text-slate-300" />
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
