// =============================================================================
// POST /api/whatsapp/meta/conversations/:conversationId/leads/link
//
// Vincula um lead existente a uma conversa Meta. A visibilidade da conversa
// é resolvida antes da RPC. A decisão comercial final continua em
// public.link_meta_conversation_lead, sob locks.
//
// Body:
//   company_id        (UUID, obrigatório)
//   lead_id           (inteiro positivo seguro, obrigatório)
//   expected_lead_id  (inteiro positivo seguro ou null explícito)
//
// Segurança:
//   - company_id do body identifica o tenant — nunca autoriza acesso
//   - p_actor_user_id é exclusivamente auth.userId
//   - Nenhum UPDATE direto em meta_conversations
//   - Nenhuma leitura do lead atual para decidir replace
//   - 404 e 403 opacos; conflito não devolve o lead gravado
//   - 500 nunca expõe SQL, stack ou credencial
// =============================================================================

import { getSupabaseAdmin } from '../../../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_VIEW_ROLES } from '../../../../../lib/meta-whatsapp/validateMetaCaller.js';
import {
  applyMetaConversationFilters,
  resolveMetaConversationVisibility,
} from '../../../../../lib/meta-whatsapp/metaConversationAccess.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUSINESS_CODES = new Set([
  'linked',
  'already_linked',
  'conflict',
  'forbidden',
  'not_found',
]);

const RETRYABLE_SQLSTATE = new Set(['40001', '40P01']);

const CONV_FIELDS = 'id, company_id, assigned_to, status';

const OPAQUE_FORBIDDEN = { error: 'Permissão insuficiente para esta operação' };
const OPAQUE_NOT_FOUND = { error: 'Registro não encontrado' };
const CONFLICT = { error: 'conflict' };
const RETRYABLE_CONFLICT = { error: 'conflict', retryable: true };
const INTERNAL_ERROR = { error: 'internal_error' };

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isPositiveSafeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function visibilityFailure(scope) {
  if (scope.status === 503) return { status: 503, error: 'internal_error' };
  return { status: scope.status, error: scope.error };
}

async function loadAuthorizedConversation(svc, auth, conversationId) {
  const scope = await resolveMetaConversationVisibility(svc, auth);
  if (!scope.ok) return { ok: false, ...visibilityFailure(scope) };

  const filtered = applyMetaConversationFilters(
    svc.from('meta_conversations').select(CONV_FIELDS),
    scope,
    { conversationId },
  );
  if (!filtered.ok) return { ok: false, status: 403, error: 'Acesso negado' };

  const { data, error } = await filtered.query.eq('status', 'active').maybeSingle();
  if (error) return { ok: false, status: 500, error: 'internal_error' };

  const assignedOk = scope.visibility !== 'assigned' || data?.assigned_to === auth.userId;
  const allowed = Boolean(data)
    && data.id === conversationId
    && data.company_id === auth.companyId
    && data.status === 'active'
    && assignedOk;
  if (!allowed) return { ok: false, status: 404, error: OPAQUE_NOT_FOUND.error };
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Body inválido' });
  }

  const companyId = body.company_id;
  if (!Object.prototype.hasOwnProperty.call(body, 'company_id') || companyId == null || companyId === '') {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }
  if (!isUuid(companyId)) {
    return res.status(400).json({ error: 'company_id inválido' });
  }

  const conversationId = req.query?.conversationId;
  if (!isUuid(conversationId)) {
    return res.status(400).json({ error: 'conversationId inválido' });
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'lead_id')) {
    return res.status(400).json({ error: 'lead_id é obrigatório' });
  }
  const leadId = body.lead_id;
  if (!isPositiveSafeInteger(leadId)) {
    return res.status(400).json({ error: 'lead_id inválido' });
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'expected_lead_id')) {
    return res.status(400).json({ error: 'expected_lead_id é obrigatório' });
  }
  const expectedLeadId = body.expected_lead_id;
  if (expectedLeadId !== null && !isPositiveSafeInteger(expectedLeadId)) {
    return res.status(400).json({ error: 'expected_lead_id inválido' });
  }

  let svc;
  try {
    svc = getSupabaseAdmin();
  } catch {
    return res.status(500).json(INTERNAL_ERROR);
  }

  try {
    const auth = await validateMetaCaller(req, svc, companyId, { roles: META_VIEW_ROLES });
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const loaded = await loadAuthorizedConversation(svc, auth, conversationId);
    if (!loaded.ok) {
      return res.status(loaded.status).json({ error: loaded.error });
    }

    const refreshed = await validateMetaCaller(req, svc, auth.companyId, { roles: META_VIEW_ROLES });
    if (!refreshed.ok) {
      return res.status(refreshed.status).json({ error: refreshed.error });
    }

    const { data, error } = await svc.rpc('link_meta_conversation_lead', {
      p_company_id: refreshed.companyId,
      p_conversation_id: conversationId,
      p_destination_lead_id: leadId,
      p_expected_lead_id: expectedLeadId,
      p_actor_user_id: refreshed.userId,
    });

    if (error) {
      if (RETRYABLE_SQLSTATE.has(error.code)) {
        return res.status(409).json(RETRYABLE_CONFLICT);
      }
      return res.status(500).json(INTERNAL_ERROR);
    }

    if (!Array.isArray(data) || data.length !== 1) {
      return res.status(500).json(INTERNAL_ERROR);
    }

    const row = data[0];
    const result = row?.result_code;
    if (!BUSINESS_CODES.has(result)) {
      return res.status(500).json(INTERNAL_ERROR);
    }

    if (result === 'linked' || result === 'already_linked') {
      if (row.conversation_id !== conversationId || row.lead_id !== leadId) {
        return res.status(500).json(INTERNAL_ERROR);
      }
      return res.status(200).json({
        result,
        conversation_id: row.conversation_id,
        lead_id: row.lead_id,
      });
    }

    if (result === 'conflict') {
      return res.status(409).json(CONFLICT);
    }
    if (result === 'forbidden') {
      return res.status(403).json(OPAQUE_FORBIDDEN);
    }
    return res.status(404).json(OPAQUE_NOT_FOUND);
  } catch {
    return res.status(500).json(INTERNAL_ERROR);
  }
}
