/**
 * Painel de configuração de agentes conversacionais por empresa.
 *
 * Exibe os company_agent_assignments da empresa e as routing rules fallback,
 * permitindo que admins ativem/desativem, troquem o agente vinculado,
 * ajustem capabilities e a política de preços.
 *
 * Gate: canManageConversationalAgents (admin | system_admin | super_admin)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, AlertCircle, Loader2, RefreshCw, ToggleLeft, ToggleRight, ChevronDown, Plus, X, Repeat2, HelpCircle } from 'lucide-react'
import {
  companyAgentConfigApi,
  type CompanyAgentAssignment,
  type AgentRoutingRuleFallback,
  type AvailableAgent,
  type PriceDisplayPolicy,
  type AgentCapabilities,
  type AgentChannel,
  type OperatingSchedule,
} from '../../services/companyAgentConfigApi'
import { useAccessControl } from '../../hooks/useAccessControl'
import { AgentScheduleEditor } from './AgentScheduleEditor'

// ── Tipos internos ────────────────────────────────────────────────────────────

type Props = {
  companyId: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface AssignmentDraft {
  agent_id:                string
  is_active:               boolean
  capabilities:            AgentCapabilities
  price_display_policy:    PriceDisplayPolicy
  operating_schedule:      OperatingSchedule | null
  follow_up_enabled:       boolean
  follow_up_absence_hours: number
  follow_up_max_attempts:  number
  follow_up_interval_hours: number
}

const PRICE_POLICY_LABELS: Record<PriceDisplayPolicy, string> = {
  disabled:      'Nunca informar preço',
  fixed_only:    'Apenas preço fixo',
  range_allowed: 'Permitir faixa de preço',
  consult_only:  'Orientar a consultar humano'
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp:  'WhatsApp',
  web:       'Web',
  email:     'E-mail',
  sms:       'SMS',
  instagram: 'Instagram',
}

// ── Componente: Follow-up Proativo ───────────────────────────────────────────

interface FollowUpDraft {
  follow_up_enabled:        boolean
  follow_up_absence_hours:  number
  follow_up_max_attempts:   number
  follow_up_interval_hours: number
}

interface FollowUpProativoCardProps {
  draft:           FollowUpDraft
  canManage:       boolean
  onToggle:        () => void
  onChangeAbsence: (v: number) => void
  onChangeAttempts:(v: number) => void
  onChangeInterval:(v: number) => void
}

function FollowUpProativoCard({
  draft, canManage, onToggle, onChangeAbsence, onChangeAttempts, onChangeInterval
}: FollowUpProativoCardProps) {
  const [helpOpen, setHelpOpen] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora
  useEffect(() => {
    if (!helpOpen) return
    const handler = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setHelpOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [helpOpen])

  const steps = [
    `Lead para de responder → após ${draft.follow_up_absence_hours}h o agente envia a 1ª mensagem de reengajamento.`,
    ...(draft.follow_up_max_attempts >= 2
      ? [`Se continuar sem resposta → após mais ${draft.follow_up_interval_hours}h envia a 2ª mensagem.`]
      : []),
    ...(draft.follow_up_max_attempts >= 3
      ? [`Ainda sem resposta → após mais ${draft.follow_up_interval_hours}h envia a ${draft.follow_up_max_attempts}ª e última mensagem.`]
      : []),
    draft.follow_up_max_attempts === 0
      ? 'Nenhuma mensagem será enviada (tentativas = 0).'
      : 'Após as tentativas, o sistema para. Se o lead responder a qualquer momento, o agente retoma normalmente.',
  ]

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Repeat2 className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold text-gray-800">Follow-up Proativo</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Ícone de ajuda com popover */}
          <div ref={helpRef} className="relative">
            <button
              type="button"
              onClick={() => setHelpOpen((o) => !o)}
              className="p-1 rounded-full text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
              title="Como funciona"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {helpOpen && (
              <div className="absolute right-0 top-7 z-50 w-72 bg-white border border-blue-100 rounded-xl shadow-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-blue-700">Como funciona com a configuração atual</p>
                <ol className="space-y-1.5">
                  {steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                      <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-blue-100 text-blue-600 font-bold flex items-center justify-center text-[10px]">
                        {i === steps.length - 1 ? '✓' : i + 1}
                      </span>
                      <span dangerouslySetInnerHTML={{ __html: step.replace(/(\d+h)/g, '<strong>$1</strong>') }} />
                    </li>
                  ))}
                </ol>
                <p className="text-[11px] text-blue-500 pt-0.5 border-t border-blue-50">
                  As mensagens são geradas pelo agente com base no contexto real da conversa — não são templates fixos.
                </p>
              </div>
            )}
          </div>

          {/* Toggle ativo/inativo */}
          <button
            onClick={onToggle}
            disabled={!canManage}
            className="flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-40"
            title={draft.follow_up_enabled ? 'Desativar follow-up' : 'Ativar follow-up'}
          >
            {draft.follow_up_enabled ? (
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
      </div>

      {/* Campos */}
      <div className={`px-4 py-4 space-y-4 transition-opacity ${draft.follow_up_enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <p className="text-xs text-gray-500">
          O agente enviará mensagens automáticas para leads que pararem de responder durante a conversa.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Ausência (horas)</label>
            <input
              type="number" min={1} max={168}
              value={draft.follow_up_absence_hours}
              onChange={(e) => onChangeAbsence(Math.min(168, Math.max(1, Number(e.target.value) || 1)))}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400">1 – 168h</p>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Tentativas</label>
            <input
              type="number" min={0} max={10}
              value={draft.follow_up_max_attempts}
              onChange={(e) => onChangeAttempts(Math.min(10, Math.max(0, Number(e.target.value) || 0)))}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400">0 = sem limite</p>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Intervalo (horas)</label>
            <input
              type="number" min={1} max={720}
              value={draft.follow_up_interval_hours}
              onChange={(e) => onChangeInterval(Math.min(720, Math.max(1, Number(e.target.value) || 1)))}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400">entre envios</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Componente: Card de Assignment ────────────────────────────────────────────

interface AssignmentCardProps {
  assignment:       CompanyAgentAssignment
  availableAgents:  AvailableAgent[]
  companyId:        string
  onSaved:          (updated: Partial<CompanyAgentAssignment>) => void
}

function AssignmentCard({ assignment, availableAgents, companyId, onSaved }: AssignmentCardProps) {
  const { canManageConversationalAgents } = useAccessControl()

  const [draft, setDraft] = useState<AssignmentDraft>({
    agent_id:                assignment.agent_id,
    is_active:               assignment.is_active,
    capabilities:            {
      can_auto_reply:    assignment.capabilities?.can_auto_reply    ?? false,
      can_inform_prices: assignment.capabilities?.can_inform_prices ?? false,
      can_send_media:    true
    },
    price_display_policy:    assignment.price_display_policy,
    operating_schedule:      assignment.operating_schedule ?? null,
    follow_up_enabled:       assignment.follow_up_enabled       ?? false,
    follow_up_absence_hours: assignment.follow_up_absence_hours ?? 2,
    follow_up_max_attempts:  assignment.follow_up_max_attempts  ?? 3,
    follow_up_interval_hours: assignment.follow_up_interval_hours ?? 24,
  })
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty =
    draft.agent_id             !== assignment.agent_id             ||
    draft.is_active            !== assignment.is_active            ||
    draft.price_display_policy !== assignment.price_display_policy ||
    draft.capabilities.can_auto_reply    !== (assignment.capabilities?.can_auto_reply    ?? false) ||
    draft.capabilities.can_inform_prices !== (assignment.capabilities?.can_inform_prices ?? false) ||
    JSON.stringify(draft.operating_schedule) !== JSON.stringify(assignment.operating_schedule ?? null) ||
    draft.follow_up_enabled       !== (assignment.follow_up_enabled       ?? false) ||
    draft.follow_up_absence_hours !== (assignment.follow_up_absence_hours ?? 2)     ||
    draft.follow_up_max_attempts  !== (assignment.follow_up_max_attempts  ?? 3)     ||
    draft.follow_up_interval_hours !== (assignment.follow_up_interval_hours ?? 24)

  const handleSave = async () => {
    setSaveState('saving')
    setSaveError(null)
    try {
      const updated = await companyAgentConfigApi.updateAssignment(companyId, assignment.id, {
        agent_id:                draft.agent_id,
        is_active:               draft.is_active,
        capabilities:            draft.capabilities,
        price_display_policy:    draft.price_display_policy,
        operating_schedule:      draft.operating_schedule,
        follow_up_enabled:       draft.follow_up_enabled,
        follow_up_absence_hours: draft.follow_up_absence_hours,
        follow_up_max_attempts:  draft.follow_up_max_attempts,
        follow_up_interval_hours: draft.follow_up_interval_hours,
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

      {/* Horário de atendimento */}
      <AgentScheduleEditor
        value={draft.operating_schedule}
        onChange={(v) => setDraft((d) => ({ ...d, operating_schedule: v }))}
        readOnly={!canManageConversationalAgents}
      />

      {/* Follow-up Proativo */}
      <FollowUpProativoCard
        draft={draft}
        canManage={canManageConversationalAgents}
        onToggle={() => setDraft((d) => ({ ...d, follow_up_enabled: !d.follow_up_enabled }))}
        onChangeAbsence={(v) => setDraft((d) => ({ ...d, follow_up_absence_hours: v }))}
        onChangeAttempts={(v) => setDraft((d) => ({ ...d, follow_up_max_attempts: v }))}
        onChangeInterval={(v) => setDraft((d) => ({ ...d, follow_up_interval_hours: v }))}
      />


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

// ── Tipos internos do modal de criação ───────────────────────────────────────

const CHANNEL_OPTIONS: { value: AgentChannel; label: string }[] = [
  { value: 'whatsapp',  label: 'WhatsApp' },
  { value: 'web',       label: 'Web' },
  { value: 'email',     label: 'E-mail' },
  { value: 'sms',       label: 'SMS' },
  { value: 'instagram', label: 'Instagram' },
]

interface CreateForm {
  agentId:     string
  channel:     AgentChannel
  displayName: string
  canAutoReply:    boolean
  canInformPrices: boolean
  canSendMedia:    boolean
  pricePolicy: PriceDisplayPolicy
}

const DEFAULT_CREATE_FORM: CreateForm = {
  agentId:         '',
  channel:         'whatsapp',
  displayName:     '',
  canAutoReply:    false,
  canInformPrices: false,
  canSendMedia:    false,
  pricePolicy:     'disabled',
}

// ── Componente principal ──────────────────────────────────────────────────────

export const CompanyAgentConfigPanel: React.FC<Props> = ({ companyId }) => {
  const [assignments,    setAssignments]    = useState<CompanyAgentAssignment[]>([])
  const [routingRules,   setRoutingRules]   = useState<AgentRoutingRuleFallback[]>([])
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([])
  const [loading,        setLoading]        = useState(true)
  const [loadError,      setLoadError]      = useState<string | null>(null)

  // ── Estados do modal de criação ───────────────────────────────────────────
  const [showModal,    setShowModal]    = useState(false)
  const [creating,     setCreating]     = useState(false)
  const [createError,  setCreateError]  = useState<string | null>(null)
  const [form,         setForm]         = useState<CreateForm>(DEFAULT_CREATE_FORM)

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

  // ── Handlers do modal de criação ──────────────────────────────────────────

  const openModal = () => {
    setForm({
      ...DEFAULT_CREATE_FORM,
      agentId: availableAgents[0]?.id ?? '',
    })
    setCreateError(null)
    setShowModal(true)
  }

  const closeModal = () => {
    if (creating) return
    setShowModal(false)
    setCreateError(null)
  }

  const handleCreate = async () => {
    if (!form.agentId || !form.displayName.trim()) {
      setCreateError('Selecione um agente e informe o nome de exibição.')
      return
    }

    setCreating(true)
    setCreateError(null)

    try {
      await companyAgentConfigApi.createAssignment(companyId, {
        agent_id:     form.agentId,
        channel:      form.channel,
        display_name: form.displayName.trim(),
        capabilities: {
          can_auto_reply:    form.canAutoReply,
          can_inform_prices: form.canInformPrices,
          can_send_media:    form.canSendMedia,
        },
        price_display_policy: form.pricePolicy,
      })
      setShowModal(false)
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erro ao criar assignment.')
    } finally {
      setCreating(false)
    }
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
      <>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <Bot className="w-10 h-10 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-600">Nenhum agente configurado</p>
            {availableAgents.length > 0 ? (
              <p className="text-xs text-gray-400 mt-1">
                Vincule um agente a um canal para começar a receber atendimentos automáticos.
              </p>
            ) : (
              <p className="text-xs text-gray-400 max-w-sm mt-1">
                Crie um agente conversacional antes de configurar o atendimento por canal.
              </p>
            )}
          </div>
          {availableAgents.length > 0 && (
            <button
              onClick={openModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Adicionar canal
            </button>
          )}
        </div>

        {/* Modal de criação de assignment */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">

              {/* Header do modal */}
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900">Adicionar canal</h3>
                <button
                  onClick={closeModal}
                  disabled={creating}
                  className="p-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Agente */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Agente</label>
                <div className="relative">
                  <select
                    value={form.agentId}
                    onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}
                    disabled={creating}
                    className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {availableAgents.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Canal */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Canal</label>
                <div className="relative">
                  <select
                    value={form.channel}
                    onChange={e => setForm(f => ({ ...f, channel: e.target.value as AgentChannel }))}
                    disabled={creating}
                    className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {CHANNEL_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Nome de exibição */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Nome de exibição</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                  disabled={creating}
                  placeholder="Ex: Atendimento WhatsApp"
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              {/* Capacidades */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-700">Capacidades</label>
                {[
                  { key: 'canAutoReply',    label: 'Resposta automática' },
                  { key: 'canInformPrices', label: 'Informar preços' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form[key as keyof CreateForm] as boolean}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                      disabled={creating}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>

              {/* Política de preços */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">Política de preços</label>
                <div className="relative">
                  <select
                    value={form.pricePolicy}
                    onChange={e => setForm(f => ({ ...f, pricePolicy: e.target.value as PriceDisplayPolicy }))}
                    disabled={creating}
                    className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {(Object.entries(PRICE_POLICY_LABELS) as [PriceDisplayPolicy, string][]).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Erro */}
              {createError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  {createError}
                </p>
              )}

              {/* Ações */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  onClick={closeModal}
                  disabled={creating}
                  className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !form.agentId || !form.displayName.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  {creating ? 'Criando…' : 'Criar'}
                </button>
              </div>

            </div>
          </div>
        )}
      </>
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
        <div className="flex items-center gap-2">
          {availableAgents.length > 0 && (
            <button
              onClick={openModal}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Adicionar canal
            </button>
          )}
          <button
            onClick={load}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="Recarregar"
          >
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
        </div>
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

      {/* Modal de criação de assignment */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">

            {/* Header do modal */}
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Adicionar canal</h3>
              <button
                onClick={closeModal}
                disabled={creating}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Agente */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Agente</label>
              <div className="relative">
                <select
                  value={form.agentId}
                  onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}
                  disabled={creating}
                  className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {availableAgents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Canal */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Canal</label>
              <div className="relative">
                <select
                  value={form.channel}
                  onChange={e => setForm(f => ({ ...f, channel: e.target.value as AgentChannel }))}
                  disabled={creating}
                  className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {CHANNEL_OPTIONS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Nome de exibição */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Nome de exibição</label>
              <input
                type="text"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                disabled={creating}
                placeholder="Ex: Atendimento WhatsApp"
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            {/* Capacidades */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-700">Capacidades</label>
              {[
                { key: 'canAutoReply',    label: 'Resposta automática' },
                { key: 'canInformPrices', label: 'Informar preços' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form[key as keyof CreateForm] as boolean}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                    disabled={creating}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>

            {/* Política de preços */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">Política de preços</label>
              <div className="relative">
                <select
                  value={form.pricePolicy}
                  onChange={e => setForm(f => ({ ...f, pricePolicy: e.target.value as PriceDisplayPolicy }))}
                  disabled={creating}
                  className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {(Object.entries(PRICE_POLICY_LABELS) as [PriceDisplayPolicy, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {createError && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {createError}
              </p>
            )}

            {/* Ações */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={closeModal}
                disabled={creating}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !form.agentId || !form.displayName.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                {creating ? 'Criando…' : 'Criar'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
