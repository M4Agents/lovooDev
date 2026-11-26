import { AUTHORIZATION_UNAVAILABLE, validateCompanyCaller } from '../../auth/validateCompanyCaller.js'
import {
  CHAT_AUTOMATION_ROLES,
  CHAT_CONVERSATION_ROLES,
  CHAT_PURPOSES,
} from './constants.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function deny(status, error) {
  return { ok: false, status, error }
}

function infra() {
  return deny(503, AUTHORIZATION_UNAVAILABLE)
}

function notFound() {
  return deny(404, 'Recurso não encontrado')
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

async function readMaybeSingle(buildQuery) {
  try {
    const result = await buildQuery().maybeSingle()
    if (!result || typeof result !== 'object' || result.error) return { ok: false }
    return { ok: true, data: result.data ?? null }
  } catch {
    return { ok: false }
  }
}

function structuralError(request) {
  if (!request || typeof request !== 'object' || !CHAT_PURPOSES.includes(request.purpose)) {
    return deny(400, 'Pedido inválido')
  }
  if (request.purpose === 'automation_audio') {
    if (request.conversationId != null || request.instanceId != null || !isUuid(request.flowId)) {
      return deny(400, 'Pedido inválido')
    }
    return null
  }
  if (!isUuid(request.conversationId) || request.flowId != null) return deny(400, 'Pedido inválido')
  if (request.purpose === 'chat_schedule') {
    if (!isUuid(request.instanceId)) return deny(400, 'Pedido inválido')
  } else if (request.instanceId != null) {
    return deny(400, 'Pedido inválido')
  }
  return null
}

function accepted(auth) {
  return {
    ok: true,
    userId: auth.userId,
    companyId: auth.companyId,
    role: auth.role,
    accessPath: auth.accessPath,
  }
}

async function authorizeAutomation(svc, auth, flowId) {
  const flow = await readMaybeSingle(() => svc
    .from('automation_flows')
    .select('id, company_id')
    .eq('id', flowId)
    .eq('company_id', auth.companyId))
  if (!flow.ok) return infra()
  if (!flow.data || flow.data.id !== flowId || flow.data.company_id !== auth.companyId) return notFound()
  return accepted(auth)
}

async function loadInstance(svc, auth, instanceId, restrictSeller) {
  const instance = await readMaybeSingle(() => svc
    .from('whatsapp_life_instances')
    .select('id, company_id, deleted_at, assigned_user_id, available_to_all')
    .eq('id', instanceId)
    .eq('company_id', auth.companyId))
  if (!instance.ok) return infra()
  if (
    !instance.data
    || instance.data.id !== instanceId
    || instance.data.company_id !== auth.companyId
    || instance.data.deleted_at != null
  ) {
    return notFound()
  }
  if (
    restrictSeller
    && instance.data.assigned_user_id !== auth.userId
    && instance.data.available_to_all !== true
  ) {
    return notFound()
  }
  return accepted(auth)
}

async function authorizeConversation(svc, auth, request) {
  const conversation = await readMaybeSingle(() => svc
    .from('chat_conversations')
    .select('id, company_id, instance_id, last_instance_id, assigned_to')
    .eq('id', request.conversationId)
    .eq('company_id', auth.companyId))
  if (!conversation.ok) return infra()
  if (
    !conversation.data
    || conversation.data.id !== request.conversationId
    || conversation.data.company_id !== auth.companyId
  ) {
    return notFound()
  }

  const visibility = await readMaybeSingle(() => svc
    .from('companies')
    .select('id, chat_visibility_by_assigned_to')
    .eq('id', auth.companyId))
  if (!visibility.ok) return infra()
  if (!visibility.data || visibility.data.id !== auth.companyId) return notFound()

  const flag = visibility.data.chat_visibility_by_assigned_to
  if (auth.role === 'seller' && flag !== true && flag !== false) return infra()
  const restricted = auth.role === 'seller' && flag === true
  if (restricted && conversation.data.assigned_to !== auth.userId) return notFound()

  if (request.purpose === 'chat_schedule') {
    return loadInstance(svc, auth, request.instanceId, restricted)
  }
  const linkedId = conversation.data.instance_id ?? conversation.data.last_instance_id
  if (!isUuid(linkedId)) return notFound()
  return loadInstance(svc, auth, linkedId, false)
}

export async function authorizeChatUpload(req, svc, request) {
  const invalid = structuralError(request)
  if (invalid) return invalid

  const roles = request.purpose === 'automation_audio' ? CHAT_AUTOMATION_ROLES : CHAT_CONVERSATION_ROLES
  const auth = await validateCompanyCaller(req, svc, request.companyId, { roles: [...roles] })
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error }
  if (auth.companyId !== request.companyId || !roles.includes(auth.role)) {
    return deny(403, 'Permissão insuficiente para esta operação')
  }
  if (request.purpose === 'automation_audio' && request.messageType !== 'audio') {
    return deny(415, 'Tipo de arquivo não permitido')
  }
  if (request.purpose === 'automation_audio') return authorizeAutomation(svc, auth, request.flowId)
  return authorizeConversation(svc, auth, request)
}
