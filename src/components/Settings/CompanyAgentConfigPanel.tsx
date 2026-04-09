/**
 * Painel de configuração de agentes conversacionais por empresa.
 *
 * Exibe os company_agent_assignments da empresa e as routing rules fallback,
 * permitindo que admins ativem/desativem, troquem o agente vinculado,
 * ajustem capabilities e a política de preços.
 *
 * Gate: canManageConversationalAgents (admin | system_admin | super_admin)
 */

import { useCallback, useEffect, useState } from 'react'
import { Bot, AlertCircle, Loader2, RefreshCw, ToggleLeft, ToggleRight, ChevronDown } from 'lucide-react'
import {
  companyAgentConfigApi,
  type CompanyAgentAssignment,
  type AgentRoutingRuleFallback,
  type AvailableAgent,
  type PriceDisplayPolicy,
  type AgentCapabilities
} from '../../services/companyAgentConfigApi'

// ── Tipos internos ────────────────────────────────────────────────────────────

type Props = {
  companyId: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface AssignmentDraft {
  agent_id:             string
  is_active:            boolean
  capabilities:         AgentCapabilities
  price_display_policy: PriceDisplayPolicy
}

const PRICE_POLICY_LABELS: Record<PriceDisplayPolicy, string> = {
  disabled:      'Nunca informar preço',
  fixed_only:    'Apenas preço fixo',
  range_allowed: 'Permitir faixa de preço',
  consult_only:  'Orientar a consultar humano'
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  web:      'Web',
  email:    'E-mail',
  sms:      'SMS'
}

// ── Componente: Card de Assignment ────────────────────────────────────────────

interface AssignmentCardProps {
  assignment:       CompanyAgentAssignment
  availableAgents:  AvailableAgent[]
  companyId:        string
  onSaved:          (updated: Partial<CompanyAgentAssignment>) => void
}

function AssignmentCard({ assignment, availableAgents, companyId, onSaved }: AssignmentCardProps) {
  const [draft, setDraft] = useState<AssignmentDraft>({
    agent_id:             assignment.agent_id,
    is_active:            assignment.is_active,
    capabilities:         {
      can_auto_reply:    assignment.capabilities?.can_auto_reply    ?? false,
      can_inform_prices: assignment.capabilities?.can_inform_prices ?? false,
      can_send_media:    assignment.capabilities?.can_send_media    ?? false
    },
    price_display_policy: assignment.price_display_policy
  })
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty =
    draft.agent_id             !== assignment.agent_id             ||
    draft.is_active            !== assignment.is_active            ||
    draft.price_display_policy !== assignment.price_display_policy ||
    draft.capabilities.can_auto_reply    !== (assignment.capabilities?.can_auto_reply    ?? false) ||
    draft.capabilities.can_inform_prices !== (assignment.capabilities?.can_inform_prices ?? false) ||
    draft.capabilities.can_send_media    !== (assignment.capabilities?.can_send_media    ?? false)

  const handleSave = async () => {
    setSaveState('saving')
    setSaveError(null)
    try {
      const updated = await companyAgentConfigApi.updateAssignment(companyId, assignment.id, {
        agent_id:             draft.agent_id,
        is_active:            draft.is_active,
        capabilities:         draft.capabilities,
        price_display_policy: draft.price_display_policy
      })
      setSaveState('saved')
      onSaved(updated)
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : 'Erro ao salvar')
    }
  }

  const handleToggleActive = async () => {
    const newActive = !draft.is_active
    setDraft((d) => ({ ...d, is_active: newActive }))
    setSaveState('saving')
    setSaveError(null)
    try {
      const updated = await companyAgentConfigApi.updateAssignment(companyId, assignment.id, {
        is_active: newActive
      })
      setSaveState('saved')
      onSaved(updated)
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (err) {
      setDraft((d) => ({ ...d, is_active: !newActive }))
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : 'Erro ao alterar status')
    }
  }

  const setCap = (key: keyof AgentCapabilities, value: boolean) => {
    setDraft((d) => ({ ...d, capabilities: { ...d.capabilities, [key]: value } }))
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5 shadow-sm">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            {CHANNEL_LABELS[assignment.channel] ?? assignment.channel}
          </span>
          <span className="text-gray-700 font-semibold text-base">{assignment.display_name}</span>
        </div>

        {/* Toggle ativo/inativo */}
        <button
          onClick={handleToggleActive}
          disabled={saveState === 'saving'}
          className="flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          title={draft.is_active ? 'Desativar agente' : 'Ativar agente'}
        >
          {draft.is_active ? (
            <>
              <ToggleRight className="w-6 h-6 text-green-500" />
              <span className="text-green-600">Ativo</span>
            </>
          ) : (
            <>
              <ToggleLeft className="w-6 h-6 text-gray-400" />
              <span className="text-gray-500">Inativo</span>
            </>
          )}
        </button>
      </div>

      {/* Agente vinculado */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Agente vinculado</label>
        <div className="relative">
          <select
            value={draft.agent_id}
            onChange={(e) => setDraft((d) => ({ ...d, agent_id: e.target.value }))}
            className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {availableAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Capabilities */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-2">Capacidades</p>
        <div className="space-y-2">
          {([
            { key: 'can_auto_reply',    label: 'Resposta automática' },
            { key: 'can_inform_prices', label: 'Informar preços' },
            { key: 'can_send_media',    label: 'Enviar mídia' }
          ] as { key: keyof AgentCapabilities; label: string }[]).map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draft.capabilities[key] ?? false}
                onChange={(e) => setCap(key, e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Política de preços */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Política de preços</label>
        <div className="relative">
          <select
            value={draft.price_display_policy}
            onChange={(e) => setDraft((d) => ({ ...d, price_display_policy: e.target.value as PriceDisplayPolicy }))}
            className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {(Object.entries(PRICE_POLICY_LABELS) as [PriceDisplayPolicy, string][]).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Rodapé: erro + botão salvar */}
      {saveError && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {saveError}
        </p>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!isDirty || saveState === 'saving'}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 text-white"
        >
          {saveState === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
          {saveState === 'saved'  ? 'Salvo!' : 'Salvar alterações'}
        </button>
      </div>
    </div>
  )
}

// ── Componente: Card de Routing Rule Fallback ─────────────────────────────────

interface RoutingRuleCardProps {
  rule:      AgentRoutingRuleFallback
  companyId: string
  onSaved:   (id: string, isActive: boolean) => void
}

function RoutingRuleFallbackCard({ rule, companyId, onSaved }: RoutingRuleCardProps) {
  const [isActive, setIsActive] = useState(rule.is_active)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const handleToggle = async () => {
    const next = !isActive
    setIsActive(next)
    setSaving(true)
    setError(null)
    try {
      await companyAgentConfigApi.updateRoutingRule(companyId, rule.id, next)
      onSaved(rule.id, next)
    } catch (err) {
      setIsActive(!next)
      setError(err instanceof Error ? err.message : 'Erro ao alterar regra')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-gray-800">
            {CHANNEL_LABELS[rule.channel] ?? rule.channel} — Fallback
          </p>
          {rule.assignment_display_name && (
            <p className="text-xs text-gray-500">
              Assignment: {rule.assignment_display_name}
            </p>
          )}
          <p className="text-xs text-gray-400">Prioridade: {rule.priority}</p>
          {rule.description && (
            <p className="text-xs text-gray-500 italic mt-1">{rule.description}</p>
          )}
        </div>

        <button
          onClick={handleToggle}
          disabled={saving}
          className="flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          title={isActive ? 'Desativar fallback' : 'Ativar fallback'}
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          ) : isActive ? (
            <>
              <ToggleRight className="w-6 h-6 text-green-500" />
              <span className="text-green-600">Ativo</span>
            </>
          ) : (
            <>
              <ToggleLeft className="w-6 h-6 text-gray-400" />
              <span className="text-gray-500">Inativo</span>
            </>
          )}
        </button>
      </div>

      {/* Aviso quando fallback está inativo */}
      {!isActive && (
        <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-700">
            Sem fallback ativo, mensagens sem regra específica não serão roteadas para nenhum agente.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export const CompanyAgentConfigPanel: React.FC<Props> = ({ companyId }) => {
  const [assignments,    setAssignments]    = useState<CompanyAgentAssignment[]>([])
  const [routingRules,   setRoutingRules]   = useState<AgentRoutingRuleFallback[]>([])
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([])
  const [loading,        setLoading]        = useState(true)
  const [loadError,      setLoadError]      = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const config = await companyAgentConfigApi.getConfig(companyId)
      setAssignments(config.assignments)
      setRoutingRules(config.routing_rules_fallback)
      setAvailableAgents(config.available_agents)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar configurações')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { void load() }, [load])

  const handleAssignmentSaved = (assignmentId: string, updated: Partial<CompanyAgentAssignment>) => {
    setAssignments((prev) =>
      prev.map((a) => (a.id === assignmentId ? { ...a, ...updated } : a))
    )
  }

  const handleRoutingRuleSaved = (ruleId: string, isActive: boolean) => {
    setRoutingRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, is_active: isActive } : r))
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <span className="ml-2 text-sm text-gray-500">Carregando configurações...</span>
      </div>
    )
  }

  // ── Erro de carregamento ──────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-gray-600">{loadError}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Tentar novamente
        </button>
      </div>
    )
  }

  // ── Estado vazio ──────────────────────────────────────────────────────────

  if (assignments.length === 0 && routingRules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <Bot className="w-10 h-10 text-gray-300" />
        <p className="text-sm font-medium text-gray-600">Nenhum agente configurado</p>
        <p className="text-xs text-gray-400 max-w-sm">
          Os agentes conversacionais são provisionados pelo administrador da plataforma.
          Entre em contato caso precise configurar um agente para sua empresa.
        </p>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-500" />
            Agentes Conversacionais
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Configure os agentes de IA vinculados à sua empresa.
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          title="Recarregar"
        >
          <RefreshCw className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Assignments */}
      {assignments.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Configuração por canal
          </h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {assignments.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                availableAgents={availableAgents}
                companyId={companyId}
                onSaved={(updated) => handleAssignmentSaved(a.id, updated)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Routing Rules Fallback */}
      {routingRules.length > 0 && (
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Regra de roteamento fallback
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Usada quando nenhuma regra específica corresponder à mensagem recebida.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {routingRules.map((r) => (
              <RoutingRuleFallbackCard
                key={r.id}
                rule={r}
                companyId={companyId}
                onSaved={handleRoutingRuleSaved}
              />
            ))}
          </div>
        </section>
      )}

    </div>
  )
}
