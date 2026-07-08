// =====================================================
// CONTACT CYCLE API SERVICE
//
// Camada de acesso REST para o Motor de Ciclos de Contato.
//
// Todas as chamadas usam /api/contact-cycles/* com Bearer token.
// Nunca usa Supabase client para dados — apenas para auth.
// Nunca usa service_role.
// Nunca envia campos extras além dos aceitos pelo backend.
// =====================================================

import { supabase } from '../lib/supabase'
import type {
  ContactCycleConfig,
  ContactCycleConfigForm,
  ContactAttemptReason,
  ContactAttemptReasonForm,
  ContactAttemptReasonPatch,
  ContactAttemptQuestion,
  ContactAttemptQuestionForm,
  ContactAttemptQuestionPatch,
  ContactCycleHistoryItem,
  ContactCycleState,
  ContactCycleByLeadState,
  ContactAttemptForm,
} from '../types/contact-cycles'

// ── Helper interno ──────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sessão expirada')
  return session.access_token
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken()

  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  const json = await res.json()

  if (!json.ok) {
    throw new Error(json.error ?? `Erro ${res.status}`)
  }

  return json.data as T
}

// ── Config ──────────────────────────────────────────────────────

/**
 * Busca a configuração de ciclo de contato da empresa.
 * Retorna null se ainda não foi criada.
 */
async function getConfig(companyId: string): Promise<ContactCycleConfig | null> {
  return apiFetch<ContactCycleConfig | null>(
    `/api/contact-cycles/config?company_id=${encodeURIComponent(companyId)}`,
  )
}

/**
 * Atualiza a configuração de ciclo de contato.
 * Envia somente os 4 campos aceitos pelo backend.
 */
async function updateConfig(
  companyId: string,
  form: ContactCycleConfigForm,
): Promise<ContactCycleConfig> {
  return apiFetch<ContactCycleConfig>('/api/contact-cycles/config', {
    method: 'PUT',
    body: JSON.stringify({
      company_id: companyId,
      enabled: form.enabled,
      eligibility_rule: form.eligibility_rule,
      eligibility_hours: form.eligibility_hours,
      show_extra_questions: form.show_extra_questions,
    }),
  })
}

// ── Motivos ──────────────────────────────────────────────────────

/**
 * Lista motivos de tentativa.
 * Admin+ passa includeInactive=true para ver motivos inativos.
 */
async function listReasons(
  companyId: string,
  includeInactive = false,
): Promise<ContactAttemptReason[]> {
  const params = new URLSearchParams({ company_id: companyId })
  if (includeInactive) params.set('include_inactive', 'true')
  // #region agent log
  const __raw = await apiFetch<unknown>(`/api/contact-cycles/reasons?${params}`)
  console.log('[DEBUG:H-A] listReasons raw result', { type: typeof __raw, isArray: Array.isArray(__raw), keys: __raw && typeof __raw === 'object' ? Object.keys(__raw as object) : null, value: __raw })
  return __raw as ContactAttemptReason[]
  // #endregion
}

/**
 * Cria um novo motivo de tentativa.
 * RBAC: admin+
 */
async function createReason(
  companyId: string,
  form: ContactAttemptReasonForm,
): Promise<ContactAttemptReason> {
  return apiFetch<ContactAttemptReason>('/api/contact-cycles/reasons', {
    method: 'POST',
    body: JSON.stringify({
      company_id: companyId,
      label: form.label,
    }),
  })
}

/**
 * Atualiza label ou status ativo de um motivo.
 * Desativar: patch = { active: false }
 * Reativar:  patch = { active: true }
 * RBAC: admin+
 */
async function updateReason(
  companyId: string,
  reasonId: string,
  patch: ContactAttemptReasonPatch,
): Promise<void> {
  await apiFetch<void>(`/api/contact-cycles/reasons/${encodeURIComponent(reasonId)}`, {
    method: 'PUT',
    body: JSON.stringify({ company_id: companyId, ...patch }),
  })
}

// ── Perguntas ────────────────────────────────────────────────────

/**
 * Lista perguntas dinâmicas.
 * Admin+ passa includeInactive=true para ver perguntas inativas.
 */
async function listQuestions(
  companyId: string,
  includeInactive = false,
): Promise<ContactAttemptQuestion[]> {
  const params = new URLSearchParams({ company_id: companyId })
  if (includeInactive) params.set('include_inactive', 'true')
  return apiFetch<ContactAttemptQuestion[]>(`/api/contact-cycles/questions?${params}`)
}

/**
 * Cria uma nova pergunta dinâmica.
 * RBAC: admin+
 */
async function createQuestion(
  companyId: string,
  form: ContactAttemptQuestionForm,
): Promise<ContactAttemptQuestion> {
  return apiFetch<ContactAttemptQuestion>('/api/contact-cycles/questions', {
    method: 'POST',
    body: JSON.stringify({
      company_id: companyId,
      label: form.label,
      field_type: form.field_type,
      options: form.options,
      required: form.required,
      sort_order: form.sort_order,
    }),
  })
}

/**
 * Atualiza uma pergunta dinâmica.
 * Desativar: patch = { active: false }
 * RBAC: admin+
 */
async function updateQuestion(
  companyId: string,
  questionId: string,
  patch: ContactAttemptQuestionPatch,
): Promise<void> {
  await apiFetch<void>(`/api/contact-cycles/questions/${encodeURIComponent(questionId)}`, {
    method: 'PUT',
    body: JSON.stringify({ company_id: companyId, ...patch }),
  })
}

// ── Estado da oportunidade ──────────────────────────────────────

/**
 * Busca o estado atual do ciclo de contato de uma oportunidade.
 * RBAC: seller+
 */
async function getOpportunityState(
  opportunityId: string,
  companyId: string,
): Promise<ContactCycleState> {
  const params = new URLSearchParams({ company_id: companyId })
  return apiFetch<ContactCycleState>(
    `/api/contact-cycles/${encodeURIComponent(opportunityId)}/state?${params}`,
  )
}

/**
 * Busca o histórico de ciclos de uma oportunidade.
 * RBAC: seller+
 */
async function getCycleHistory(
  opportunityId: string,
  companyId: string,
): Promise<ContactCycleHistoryItem[]> {
  const params = new URLSearchParams({ company_id: companyId })
  const result = await apiFetch<{ cycles: ContactCycleHistoryItem[] }>(
    `/api/contact-cycles/${encodeURIComponent(opportunityId)}/history?${params}`,
  )
  return result.cycles
}

// ── Estado por lead (chat flow) ──────────────────────────────────

/**
 * Resolve oportunidade ativa do lead e avalia elegibilidade.
 * Chamado silenciosamente após envio de mensagem.
 * Retorna eligible_for_attempt: false sem erro se não houver opp ou módulo desabilitado.
 * RBAC: seller+
 */
async function getStateByLead(
  leadId: number,
  companyId: string,
): Promise<ContactCycleByLeadState> {
  const params = new URLSearchParams({
    company_id: companyId,
  })
  return apiFetch<ContactCycleByLeadState>(
    `/api/contact-cycles/by-lead/${encodeURIComponent(leadId)}?${params}`,
  )
}

/**
 * Registra uma tentativa de contato.
 * O backend abre o ciclo automaticamente se necessário.
 * Nunca enviar lead_id nem funnel_stage_id — derivados no servidor.
 * RBAC: seller+
 */
async function registerAttempt(
  opportunityId: string,
  companyId: string,
  form: ContactAttemptForm,
): Promise<{ attempt_id: string }> {
  return apiFetch<{ attempt_id: string }>(
    `/api/contact-cycles/${encodeURIComponent(opportunityId)}/attempt`,
    {
      method: 'POST',
      body: JSON.stringify({
        company_id:           companyId,
        trigger_reason:       form.trigger_reason,
        reason_id:            form.reason_id ?? null,
        whatsapp_message_id:  form.whatsapp_message_id ?? null,
        notes:                form.notes ?? null,
        answers:              form.answers ?? [],
      }),
    },
  )
}

// ── Export ──────────────────────────────────────────────────────

export const contactCycleApi = {
  // Config
  getConfig,
  updateConfig,

  // Motivos
  listReasons,
  createReason,
  updateReason,

  // Perguntas
  listQuestions,
  createQuestion,
  updateQuestion,

  // Oportunidade
  getOpportunityState,
  getCycleHistory,

  // Chat flow
  getStateByLead,
  registerAttempt,
}
