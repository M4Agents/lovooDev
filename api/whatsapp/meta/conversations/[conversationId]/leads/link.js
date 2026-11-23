// =============================================================================
// POST /api/whatsapp/meta/conversations/:conversationId/leads/link
//
// Vincula um lead existente a uma conversa Meta. A decisão final é da RPC
// public.link_meta_conversation_lead, sob locks. Este handler só valida a
// entrada, identifica o usuário e traduz o retorno.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUSINESS_CODES = new Set([
  'linked',
  'already_linked',
  'conflict',
  'forbidden',
  'not_found',
]);

const RETRYABLE_SQLSTATE = new Set(['40001', '40P01']);

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

    const { data, error } = await svc.rpc('link_meta_conversation_lead', {
      p_company_id: auth.companyId,
      p_conversation_id: conversationId,
      p_destination_lead_id: leadId,
      p_expected_lead_id: expectedLeadId,
      p_actor_user_id: auth.userId,
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
