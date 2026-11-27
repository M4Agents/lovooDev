// =============================================================================
// metaConversationAccess
//
// Núcleo de visibilidade das conversas Meta. Não autentica JWT, não lê
// membership e não substitui validateMetaCaller. O caller entrega somente o
// contexto de sucesso já produzido por esse guard.
//
// Fonte da visibilidade: companies.chat_visibility_by_assigned_to lida no
// banco para o company_id autorizado. Fonte da atribuição:
// meta_conversations.assigned_to. Não usa template, tier, restrict_leads_to_owner
// nem leads.responsible_user_id.
//
// Flag false preserva a visão atual. Flag true restringe apenas seller ativo
// às conversas atribuídas a ele. Flag ausente, nula ou erro de leitura nega
// o acesso. Não há cache entre chamadas.
//
// Este módulo ainda não protege endpoints. A integração é uma etapa posterior.
// =============================================================================

import { META_VIEW_ROLES } from './validateMetaCaller.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PARENT_ROLES = new Set(['super_admin', 'system_admin']);

export const META_CONVERSATION_NOT_FOUND = 'conversation_not_found';

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function denied(status, error, reason) {
  return { ok: false, status, error, reason };
}

function notFound() {
  return denied(404, META_CONVERSATION_NOT_FOUND, 'not_found');
}

function unavailable(reason) {
  return denied(503, 'Não foi possível verificar a visibilidade', reason);
}

function accessPathMatchesRole(role, accessPath) {
  if (accessPath === 'direct') return role !== 'partner';
  if (accessPath === 'partner') return role === 'partner';
  if (accessPath === 'parent') return PARENT_ROLES.has(role);
  return false;
}

/**
 * Aceita apenas o sucesso de validateMetaCaller. Contexto ausente, recusado
 * ou incompatível com a trilha parent/client não abre visibilidade.
 */
export function parseMetaCallerContext(auth, companyId) {
  if (!auth || auth.ok !== true) return null;
  if (!isUuid(auth.userId) || !isUuid(auth.companyId)) return null;
  if (!META_VIEW_ROLES.includes(auth.role)) return null;
  if (!accessPathMatchesRole(auth.role, auth.accessPath)) return null;
  if (companyId != null && companyId !== auth.companyId) return null;
  return {
    userId: auth.userId,
    companyId: auth.companyId,
    role: auth.role,
    accessPath: auth.accessPath,
  };
}

function isScope(scope) {
  return Boolean(scope)
    && scope.ok === true
    && (scope.visibility === 'all' || scope.visibility === 'assigned')
    && isUuid(scope.userId)
    && isUuid(scope.companyId)
    && META_VIEW_ROLES.includes(scope.role);
}

/**
 * Lê a flag da empresa autorizada e resolve o escopo da requisição.
 * Não reutiliza resultado de chamada anterior.
 */
export async function resolveMetaConversationVisibility(svc, auth, options = {}) {
  const caller = parseMetaCallerContext(auth, options.companyId);
  if (!caller) {
    return denied(403, 'Acesso negado', 'invalid_context');
  }
  if (!svc || typeof svc.from !== 'function') {
    return unavailable('configuration_unavailable');
  }

  let row;
  let error;
  try {
    const result = await svc
      .from('companies')
      .select('chat_visibility_by_assigned_to')
      .eq('id', caller.companyId)
      .maybeSingle();
    row = result?.data;
    error = result?.error;
  } catch {
    return unavailable('configuration_unavailable');
  }

  if (error || !row || typeof row.chat_visibility_by_assigned_to !== 'boolean') {
    return unavailable('configuration_unavailable');
  }

  const restricted = row.chat_visibility_by_assigned_to === true && caller.role === 'seller';
  return {
    ok: true,
    visibility: restricted ? 'assigned' : 'all',
    userId: caller.userId,
    companyId: caller.companyId,
    role: caller.role,
    accessPath: caller.accessPath,
    chatVisibilityByAssignedTo: row.chat_visibility_by_assigned_to,
  };
}

/**
 * Aplica empresa, instância e atribuição no builder, antes de paginação,
 * ordenação ou contagem feitas pelo caller. Falha não devolve a consulta original.
 */
export function applyMetaConversationFilters(query, scope, options = {}) {
  if (!query || typeof query.eq !== 'function' || !isScope(scope)) {
    return { ok: false, reason: 'invalid_context' };
  }
  if (options.companyId != null && options.companyId !== scope.companyId) {
    return { ok: false, reason: 'company_mismatch' };
  }
  if (options.instanceId != null && !isUuid(options.instanceId)) {
    return { ok: false, reason: 'invalid_context' };
  }
  if (options.conversationId != null && !isUuid(options.conversationId)) {
    return { ok: false, reason: 'invalid_context' };
  }

  let next = query.eq('company_id', scope.companyId);
  if (options.conversationId != null) next = next.eq('id', options.conversationId);
  if (options.instanceId != null) next = next.eq('instance_id', options.instanceId);
  if (scope.visibility === 'assigned') next = next.eq('assigned_to', scope.userId);
  return { ok: true, query: next };
}

/**
 * Autoriza uma conversa. Ausência, outro tenant, outra instância, atribuição
 * nula ou de terceiro produzem o mesmo 404. Erro de consulta permanece 503.
 * O filtro é reaplicado nesta chamada; o resultado não vale para a operação seguinte.
 */
export async function authorizeMetaConversation(svc, scope, options = {}) {
  if (!isScope(scope)) {
    return denied(403, 'Acesso negado', 'invalid_context');
  }
  if (!isUuid(options.conversationId)) return notFound();
  if (options.instanceId != null && !isUuid(options.instanceId)) return notFound();
  if (!svc || typeof svc.from !== 'function') return unavailable('query_failed');

  const filtered = applyMetaConversationFilters(
    svc.from('meta_conversations').select('id, company_id, instance_id, assigned_to'),
    scope,
    {
      conversationId: options.conversationId,
      instanceId: options.instanceId ?? null,
    },
  );
  if (!filtered.ok) return denied(403, 'Acesso negado', filtered.reason);

  let row;
  let error;
  try {
    const result = await filtered.query.maybeSingle();
    row = result?.data;
    error = result?.error;
  } catch {
    return unavailable('query_failed');
  }

  if (error) return unavailable('query_failed');
  if (!row || row.company_id !== scope.companyId || row.id !== options.conversationId) {
    return notFound();
  }
  if (options.instanceId != null && row.instance_id !== options.instanceId) return notFound();
  if (scope.visibility === 'assigned' && row.assigned_to !== scope.userId) return notFound();

  return {
    ok: true,
    conversation: {
      id: row.id,
      companyId: row.company_id,
      instanceId: row.instance_id,
      assignedTo: row.assigned_to ?? null,
    },
  };
}
