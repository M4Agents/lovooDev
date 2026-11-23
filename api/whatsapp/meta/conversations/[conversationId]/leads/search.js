// =============================================================================
// GET /api/whatsapp/meta/conversations/:conversationId/leads/search
//
// Pesquisa leads do CRM para vinculação manual a uma conversa Meta.
// Não vincula, não cria lead, não altera a conversa.
//
// Query params:
//   company_id  (UUID, obrigatório)
//   q           (string, obrigatório) — trim, 2–80 caracteres
//   limit       (inteiro, opcional) — padrão 10, máximo efetivo 20
//
// Fluxo de segurança (ordem obrigatória):
//   1. Method guard (GET only)
//   2. Validar formato da entrada — sem DB
//   3. getSupabaseAdmin()
//   4. validateMetaCaller(META_VIEW_ROLES)
//   5. Lookup de meta_conversations com auth.companyId + status=active
//   6. Carregar companies.id e restrict_leads_to_owner
//   7. assertMetaLeadAccess(operation='search')
//   8. [somente após helper ok + scope válido] consultar leads
//
// Segurança:
//   - company_id da query identifica o tenant — nunca autoriza acesso
//   - Toda query usa auth.companyId — nunca req.query.*
//   - scope/role/ownership do cliente são ignorados
//   - 404 idêntico para conversa inexistente, arquivada ou de outro tenant
//   - Helper recusado ou scope inválido: fail-closed, sem consultar leads
//   - SELECT mínimo: sem company_id, deleted_at, phone_normalized, metadata
//   - Erros 500 nunca expõem SQL, stack, motivo do helper ou PII
//   - Zero logging de q, telefone, e-mail, Authorization ou token
//
// RBAC:
//   - META_VIEW_ROLES + assertMetaLeadAccess
//   - scope='own' → responsible_user_id = auth.userId (exclui NULL)
//   - Sem templates de permissão, comparação por tier ou RLS como substituto
// =============================================================================

import { getSupabaseAdmin } from '../../../../../lib/automation/supabaseAdmin.js';
import { validateMetaCaller, META_VIEW_ROLES } from '../../../../../lib/meta-whatsapp/validateMetaCaller.js';
import { assertMetaLeadAccess } from '../../../../../lib/meta-whatsapp/assertMetaLeadAccess.js';
import { brMobilePhoneLookupValues } from '../../../../../lib/phone/canonicalizeBrMobile.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 20;
const Q_MIN = 2;
const Q_MAX = 80;

const CONV_FIELDS = 'id, company_id';
const COMPANY_FIELDS = 'id, restrict_leads_to_owner';
const LEAD_FIELDS = 'id, name, phone, email, responsible_user_id';

const OPAQUE_CONV_404 = { error: 'Conversa não encontrada' };
const INTERNAL_ERROR = { error: 'internal_error' };

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function readSingleParam(value) {
  if (value === undefined) return { ok: true, value: undefined };
  if (Array.isArray(value) || typeof value !== 'string') {
    return { ok: false };
  }
  return { ok: true, value };
}

function escapeIlikeLiteral(value) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function quotePostgrestValue(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildLeadTextOrFilter(term) {
  const pattern = quotePostgrestValue(`%${escapeIlikeLiteral(term)}%`);
  return `name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`;
}

function phoneLookupValues(term) {
  const digits = term.replace(/\D/g, '');
  if (digits.length < 10) return [];
  return brMobilePhoneLookupValues(term).filter((value) => /^\d{10,}$/.test(value));
}

function startLeadQuery(svc, auth, scope) {
  let query = svc
    .from('leads')
    .select(LEAD_FIELDS)
    .eq('company_id', auth.companyId)
    .is('deleted_at', null);

  if (scope === 'own') {
    query = query.eq('responsible_user_id', auth.userId);
  }

  return query;
}

function toPublicLead(row) {
  if (!row || !Number.isInteger(row.id)) return null;
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    phone: row.phone == null ? null : String(row.phone),
    email: row.email == null ? null : String(row.email),
    responsible_user_id: row.responsible_user_id == null
      ? null
      : String(row.responsible_user_id),
  };
}

function mergeAndSortLeads(textRows, phoneRows, limit) {
  const byId = new Map();
  for (const row of [...(textRows ?? []), ...(phoneRows ?? [])]) {
    const dto = toPublicLead(row);
    if (!dto || byId.has(dto.id)) continue;
    byId.set(dto.id, dto);
  }

  return [...byId.values()]
    .sort((a, b) => {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return a.id - b.id;
    })
    .slice(0, limit);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyParam = readSingleParam(req.query?.company_id);
  const conversationParam = readSingleParam(req.query?.conversationId);
  const qParam = readSingleParam(req.query?.q);
  const limitParam = readSingleParam(req.query?.limit);

  if (!companyParam.ok || !conversationParam.ok || !qParam.ok || !limitParam.ok) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }

  const companyId = companyParam.value;
  if (!companyId) {
    return res.status(400).json({ error: 'company_id é obrigatório' });
  }
  if (!isUuid(companyId)) {
    return res.status(400).json({ error: 'company_id inválido' });
  }

  const conversationId = conversationParam.value;
  if (!conversationId || !isUuid(conversationId)) {
    return res.status(400).json({ error: 'conversationId inválido' });
  }

  const rawQ = qParam.value;
  if (rawQ === undefined || rawQ.includes('\0')) {
    return res.status(400).json({ error: 'q inválido' });
  }
  const q = rawQ.trim();
  // PostgREST trata * como alias de % em ILIKE, mesmo entre aspas.
  if (q.includes('*')) {
    return res.status(400).json({ error: 'q inválido' });
  }
  if (q.length < Q_MIN || q.length > Q_MAX) {
    return res.status(400).json({ error: 'q deve ter entre 2 e 80 caracteres' });
  }

  let safeLimit = LIMIT_DEFAULT;
  if (limitParam.value !== undefined) {
    const parsed = parseInt(limitParam.value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== limitParam.value) {
      return res.status(400).json({ error: 'limit inválido — deve ser inteiro positivo' });
    }
    safeLimit = Math.min(parsed, LIMIT_MAX);
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

    const { data: conversation, error: convErr } = await svc
      .from('meta_conversations')
      .select(CONV_FIELDS)
      .eq('id', conversationId)
      .eq('company_id', auth.companyId)
      .eq('status', 'active')
      .maybeSingle();

    if (convErr) {
      return res.status(500).json(INTERNAL_ERROR);
    }
    if (!conversation) {
      return res.status(404).json(OPAQUE_CONV_404);
    }

    const { data: company, error: companyErr } = await svc
      .from('companies')
      .select(COMPANY_FIELDS)
      .eq('id', auth.companyId)
      .maybeSingle();

    if (companyErr || !company) {
      return res.status(500).json(INTERNAL_ERROR);
    }

    const access = assertMetaLeadAccess({
      auth,
      operation: 'search',
      company: {
        id: company.id,
        restrict_leads_to_owner: company.restrict_leads_to_owner,
      },
      conversation: {
        id: conversation.id,
        company_id: conversation.company_id,
      },
    });

    if (!access.ok || (access.scope !== 'all' && access.scope !== 'own')) {
      return res.status(500).json(INTERNAL_ERROR);
    }

    const textQuery = startLeadQuery(svc, auth, access.scope)
      .or(buildLeadTextOrFilter(q))
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .limit(safeLimit);

    const { data: textRows, error: textErr } = await textQuery;
    if (textErr) {
      return res.status(500).json(INTERNAL_ERROR);
    }

    let phoneRows = [];
    const phoneValues = phoneLookupValues(q);
    if (phoneValues.length > 0) {
      const phoneQuery = startLeadQuery(svc, auth, access.scope)
        .in('phone_normalized', phoneValues)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .limit(safeLimit);

      const phoneResult = await phoneQuery;
      if (phoneResult.error) {
        return res.status(500).json(INTERNAL_ERROR);
      }
      phoneRows = phoneResult.data ?? [];
    }

    return res.status(200).json({
      leads: mergeAndSortLeads(textRows, phoneRows, safeLimit),
    });
  } catch {
    return res.status(500).json(INTERNAL_ERROR);
  }
}
