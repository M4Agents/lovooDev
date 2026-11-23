// =============================================================================
// assertMetaLeadAccess
//
// Decisão pura e síncrona de autorização de leads para futuras APIs Meta.
// Não consulta banco, não lê JWT, não lê templates, não grava conversa/lead,
// não executa CAS e não produz HTTP.
//
// O handler deve:
//   1. Rodar validateMetaCaller
//   2. Carregar empresa / conversa / lead no backend (service_role)
//   3. Filtrar explicitamente por auth.companyId
//   4. Chamar este helper
//   5. Aplicar scope no SQL e tratar CAS / HTTP
//
// Este módulo NÃO substitui validateMetaCaller.
// Uso exclusivo de /api/whatsapp/meta — não importar em Uazapi ou Instagram.
//
// Sucesso: { ok: true,  scope: 'all' | 'own' }
// Recusa:  { ok: false, reason: 'invalid_context' | 'forbidden' | 'not_found' }
// =============================================================================

import { META_VIEW_ROLES } from './validateMetaCaller.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPERATIONS = new Set(['search', 'read', 'link', 'replace', 'unlink', 'create']);

const REPLACE_ROLES = new Set(['super_admin', 'system_admin', 'admin']);
const PARENT_ROLES  = new Set(['super_admin', 'system_admin']);

const ACCESS_PATHS = new Set(['direct', 'partner', 'parent']);

function denied(reason) {
  return { ok: false, reason };
}

function allowed(scope) {
  return { ok: true, scope };
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isSoftDeleted(lead) {
  return lead.deleted_at != null && lead.deleted_at !== '';
}

function accessPathMatchesRole(role, accessPath) {
  if (accessPath === 'direct')  return role !== 'partner';
  if (accessPath === 'partner') return role === 'partner';
  if (accessPath === 'parent')  return PARENT_ROLES.has(role);
  return false;
}

function resolveScope(role, restrictLeadsToOwner) {
  if (role === 'seller' && restrictLeadsToOwner === true) return 'own';
  return 'all';
}

function ownsLead(auth, lead) {
  return lead.responsible_user_id === auth.userId;
}

function leadInScope(scope, auth, lead) {
  if (scope === 'all') return true;
  return ownsLead(auth, lead);
}

/**
 * Autoriza uma operação Meta sobre leads da empresa já validada pelo guard.
 *
 * @param {object} params
 * @param {object} params.auth
 *   Retorno de sucesso de validateMetaCaller (ok, userId, companyId, role, accessPath).
 * @param {'search'|'read'|'link'|'replace'|'unlink'|'create'} params.operation
 * @param {{ id: string, restrict_leads_to_owner: boolean }} params.company
 * @param {{ id: number, company_id: string, responsible_user_id: string|null, deleted_at?: string|null }} [params.lead]
 * @param {{ id?: string, company_id: string, lead_id?: number|null }} [params.conversation]
 *
 * @returns {{ ok: true, scope: 'all'|'own' } | { ok: false, reason: 'invalid_context'|'forbidden'|'not_found' }}
 */
export function assertMetaLeadAccess({
  auth,
  operation,
  company,
  lead = null,
  conversation = null,
} = {}) {
  if (!OPERATIONS.has(operation)) {
    return denied('invalid_context');
  }

  if (!auth || auth.ok !== true) {
    return denied('invalid_context');
  }

  if (!isUuid(auth.userId) || !isUuid(auth.companyId)) {
    return denied('invalid_context');
  }

  if (!META_VIEW_ROLES.includes(auth.role) || !ACCESS_PATHS.has(auth.accessPath)) {
    return denied('invalid_context');
  }

  if (!accessPathMatchesRole(auth.role, auth.accessPath)) {
    return denied('invalid_context');
  }

  if (!company || !isUuid(company.id) || company.id !== auth.companyId) {
    return denied('invalid_context');
  }

  if (typeof company.restrict_leads_to_owner !== 'boolean') {
    return denied('invalid_context');
  }

  if (conversation != null) {
    if (typeof conversation !== 'object' || !isUuid(conversation.company_id)) {
      return denied('invalid_context');
    }
    if (conversation.company_id !== auth.companyId) {
      return denied('invalid_context');
    }
  }

  if (lead != null) {
    if (typeof lead !== 'object' || !isUuid(lead.company_id) || !Number.isInteger(lead.id)) {
      return denied('invalid_context');
    }
    if (lead.company_id !== auth.companyId) {
      return denied('invalid_context');
    }
  }

  const requiresLead = operation === 'read' || operation === 'link'
    || operation === 'replace' || operation === 'unlink';
  const requiresConversation = operation === 'link' || operation === 'replace'
    || operation === 'unlink';

  if (requiresLead && lead == null) {
    return denied('invalid_context');
  }
  if (requiresConversation && conversation == null) {
    return denied('invalid_context');
  }

  if (operation === 'unlink' && conversation.lead_id != null && conversation.lead_id !== lead.id) {
    return denied('invalid_context');
  }

  const scope = resolveScope(auth.role, company.restrict_leads_to_owner);

  if (operation === 'search' || operation === 'create') {
    return allowed(scope);
  }

  if (operation === 'replace' && !REPLACE_ROLES.has(auth.role)) {
    return denied('forbidden');
  }

  if (isSoftDeleted(lead)) {
    if (operation === 'unlink' && leadInScope(scope, auth, lead)) {
      return allowed(scope);
    }
    return denied('not_found');
  }

  if (!leadInScope(scope, auth, lead)) {
    return denied('not_found');
  }

  return allowed(scope);
}
