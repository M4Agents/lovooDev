// =============================================================================
// metaConversationAccess.test.js
//
// Testes do núcleo de visibilidade. Não declaram endpoints protegidos.
// Membership, partner e trilha parent/client continuam a cargo de
// validateMetaCaller: aqui só se prova que um contexto recusado não abre acesso.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { validateCompanyCaller } from '../../auth/validateCompanyCaller.js';
import {
  authorizeMetaConversation,
  applyMetaConversationFilters,
  parseMetaCallerContext,
  resolveMetaConversationVisibility,
  META_CONVERSATION_NOT_FOUND,
} from '../metaConversationAccess.js';
import { META_VIEW_ROLES, validateMetaCaller } from '../validateMetaCaller.js';

const USER_ID = 'aaaa0000-0000-0000-0000-000000000001';
const OTHER_USER = 'eeee0000-0000-0000-0000-000000000005';
const COMPANY_ID = 'bbbb0000-0000-0000-0000-000000000002';
const OTHER_CO = 'cccc0000-0000-0000-0000-000000000003';
const CONV_ID = 'dddd0000-0000-0000-0000-000000000004';
const INSTANCE_ID = 'ffff0000-0000-0000-0000-000000000006';
const OTHER_INSTANCE = '99990000-0000-0000-0000-000000000007';

const BROAD_ROLES = ['super_admin', 'system_admin', 'admin', 'manager', 'partner'];

function auth(overrides = {}) {
  return {
    ok: true,
    userId: USER_ID,
    companyId: COMPANY_ID,
    role: 'admin',
    accessPath: 'direct',
    ...overrides,
  };
}

function scope(overrides = {}) {
  return {
    ok: true,
    visibility: 'all',
    userId: USER_ID,
    companyId: COMPANY_ID,
    role: 'admin',
    accessPath: 'direct',
    chatVisibilityByAssignedTo: false,
    ...overrides,
  };
}

function companySvc(flag, error = null) {
  return {
    from(table) {
      if (table !== 'companies') throw new Error(`tabela inesperada ${table}`);
      return {
        select() { return this; },
        eq(column, value) {
          this.column = column;
          this.value = value;
          return this;
        },
        maybeSingle: async () => ({ data: flag, error }),
      };
    },
  };
}

function conversationSvc(row, { error = null, throwOnRead = false } = {}) {
  return {
    from(table) {
      const filters = {};
      const api = {
        select() { return api; },
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        maybeSingle: async () => {
          if (throwOnRead) throw new Error('falha de leitura');
          if (error) return { data: null, error };
          if (!row) return { data: null, error: null };
          if (filters.company_id && filters.company_id !== row.company_id) return { data: null, error: null };
          if (filters.id && filters.id !== row.id) return { data: null, error: null };
          if (filters.instance_id && filters.instance_id !== row.instance_id) return { data: null, error: null };
          if (Object.prototype.hasOwnProperty.call(filters, 'assigned_to') && filters.assigned_to !== row.assigned_to) {
            return { data: null, error: null };
          }
          return { data: { ...row }, error: null };
        },
        filters,
      };
      return api;
    },
  };
}

function listQuery() {
  const calls = [];
  const api = {
    eq(column, value) {
      calls.push(['eq', column, value]);
      return api;
    },
    order() {
      calls.push(['order']);
      return api;
    },
    range() {
      calls.push(['range']);
      return api;
    },
    calls,
  };
  return api;
}

describe('resolveMetaConversationVisibility', () => {
  it.each(BROAD_ROLES)('role %s mantém visibilidade ampla com a flag ligada', async (role) => {
    const accessPath = role === 'partner'
      ? 'partner'
      : (role === 'super_admin' || role === 'system_admin' ? 'parent' : 'direct');
    const result = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: true }),
      auth({ role, accessPath }),
    );
    expect(result.ok).toBe(true);
    expect(result.visibility).toBe('all');
  });

  it('seller com flag false preserva a visibilidade existente', async () => {
    const result = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: false }),
      auth({ role: 'seller' }),
    );
    expect(result).toMatchObject({ ok: true, visibility: 'all', chatVisibilityByAssignedTo: false });
  });

  it('seller com flag true fica restrito à própria atribuição', async () => {
    const result = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: true }),
      auth({ role: 'seller' }),
    );
    expect(result).toMatchObject({ ok: true, visibility: 'assigned', userId: USER_ID });
  });

  it('role desconhecido não abre visibilidade', async () => {
    const svc = companySvc({ chat_visibility_by_assigned_to: false });
    const result = await resolveMetaConversationVisibility(svc, auth({ role: 'intern' }));
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'invalid_context' });
  });

  it('empresa divergente do contexto autenticado é negada antes da flag', async () => {
    const svc = companySvc({ chat_visibility_by_assigned_to: false });
    const result = await resolveMetaConversationVisibility(svc, auth(), { companyId: OTHER_CO });
    expect(result.reason).toBe('invalid_context');
  });

  it('falha de leitura da flag não assume false', async () => {
    const result = await resolveMetaConversationVisibility(
      companySvc(null, { message: 'timeout' }),
      auth({ role: 'seller' }),
    );
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'configuration_unavailable' });
    expect(result.error).not.toContain('timeout');
  });

  it('configuração ausente ou nula não equivale a flag false', async () => {
    const missing = await resolveMetaConversationVisibility(companySvc(null), auth({ role: 'seller' }));
    const empty = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: null }),
      auth({ role: 'seller' }),
    );
    expect(missing.reason).toBe('configuration_unavailable');
    expect(empty.reason).toBe('configuration_unavailable');
  });

  it('exceção na leitura da flag falha fechada', async () => {
    const svc = {
      from() {
        return { select() { return this; }, eq() { return this; }, maybeSingle: async () => { throw new Error('boom'); } };
      },
    };
    const result = await resolveMetaConversationVisibility(svc, auth());
    expect(result.reason).toBe('configuration_unavailable');
  });

  it('reavalia a flag a cada requisição', async () => {
    const flags = [false, true];
    const svc = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: { chat_visibility_by_assigned_to: flags.shift() }, error: null }),
        };
      },
    };
    const seller = auth({ role: 'seller' });
    const first = await resolveMetaConversationVisibility(svc, seller);
    const second = await resolveMetaConversationVisibility(svc, seller);
    expect(first.visibility).toBe('all');
    expect(second.visibility).toBe('assigned');
  });
});

describe('contexto recusado pelo validateMetaCaller', () => {
  it.each([
    ['membership inativa ou ausente', { ok: false, status: 403, error: 'Acesso negado a esta empresa' }],
    ['partner sem atribuição', { ok: false, status: 403, error: 'Partner sem assignment ativo para esta empresa' }],
    ['parent de outra empresa', { ok: false, status: 403, error: 'Empresa não encontrada ou sem acesso' }],
  ])('%s não produz visibilidade ampla', async (_label, callerResult) => {
    const result = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: false }),
      callerResult,
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_context' });
  });

  it('contexto ausente ou incompleto é negado', async () => {
    expect((await resolveMetaConversationVisibility(companySvc({}), null)).reason).toBe('invalid_context');
    expect((await resolveMetaConversationVisibility(companySvc({}), auth({ userId: 'nao-uuid' }))).reason).toBe('invalid_context');
    expect(parseMetaCallerContext(undefined)).toBeNull();
  });

  it('partner autorizado usa a trilha partner e admin não usa a trilha parent', async () => {
    const partner = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: true }),
      auth({ role: 'partner', accessPath: 'partner' }),
    );
    const forgedParent = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: false }),
      auth({ role: 'admin', accessPath: 'parent' }),
    );
    const parentAdmin = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: true }),
      auth({ role: 'system_admin', accessPath: 'parent' }),
    );
    expect(partner.visibility).toBe('all');
    expect(forgedParent.reason).toBe('invalid_context');
    expect(parentAdmin.visibility).toBe('all');
  });
});

describe('authorizeMetaConversation', () => {
  const row = {
    id: CONV_ID,
    company_id: COMPANY_ID,
    instance_id: INSTANCE_ID,
    assigned_to: USER_ID,
  };

  it('seller restrito acessa a própria conversa', async () => {
    const result = await authorizeMetaConversation(
      conversationSvc(row),
      scope({ visibility: 'assigned', role: 'seller', chatVisibilityByAssignedTo: true }),
      { conversationId: CONV_ID, instanceId: INSTANCE_ID },
    );
    expect(result.ok).toBe(true);
    expect(result.conversation.assignedTo).toBe(USER_ID);
  });

  it.each([
    ['inexistente', null, CONV_ID, INSTANCE_ID],
    ['de outra empresa', { ...row, company_id: OTHER_CO }, CONV_ID, INSTANCE_ID],
    ['de outra instância', row, CONV_ID, OTHER_INSTANCE],
    ['atribuída a terceiro', { ...row, assigned_to: OTHER_USER }, CONV_ID, INSTANCE_ID],
    ['sem atribuição', { ...row, assigned_to: null }, CONV_ID, INSTANCE_ID],
  ])('seller restrito recebe 404 opaco quando a conversa está %s', async (_label, stored, conversationId, instanceId) => {
    const result = await authorizeMetaConversation(
      conversationSvc(stored),
      scope({ visibility: 'assigned', role: 'seller' }),
      { conversationId, instanceId },
    );
    expect(result).toEqual({ ok: false, status: 404, error: META_CONVERSATION_NOT_FOUND, reason: 'not_found' });
  });

  it('seller com flag false acessa conversa sem atribuição', async () => {
    const result = await authorizeMetaConversation(
      conversationSvc({ ...row, assigned_to: null }),
      scope({ visibility: 'all', role: 'seller', chatVisibilityByAssignedTo: false }),
      { conversationId: CONV_ID },
    );
    expect(result.ok).toBe(true);
    expect(result.conversation.assignedTo).toBeNull();
  });

  it('falha da consulta não vira not_found', async () => {
    const failed = await authorizeMetaConversation(
      conversationSvc(row, { error: { message: 'db down' } }),
      scope(),
      { conversationId: CONV_ID },
    );
    const thrown = await authorizeMetaConversation(
      conversationSvc(row, { throwOnRead: true }),
      scope(),
      { conversationId: CONV_ID },
    );
    expect(failed).toMatchObject({ status: 503, reason: 'query_failed' });
    expect(thrown.reason).toBe('query_failed');
    expect(failed.error).not.toContain('db down');
  });

  it('escopo ausente não autoriza a conversa', async () => {
    const result = await authorizeMetaConversation(conversationSvc(row), null, { conversationId: CONV_ID });
    expect(result.reason).toBe('invalid_context');
  });

  it('transferência simulada passa a negar o responsável anterior', async () => {
    let assigned = USER_ID;
    const svc = {
      from() {
        return conversationSvc({ ...row, assigned_to: assigned }).from('meta_conversations');
      },
    };
    const restricted = scope({ visibility: 'assigned', role: 'seller' });
    const before = await authorizeMetaConversation(svc, restricted, { conversationId: CONV_ID });
    assigned = OTHER_USER;
    const after = await authorizeMetaConversation(svc, restricted, { conversationId: CONV_ID });
    expect(before.ok).toBe(true);
    expect(after.status).toBe(404);
  });

  it('desativação simulada nega e a reativação reavalia a atribuição vigente', async () => {
    const active = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: true }),
      auth({ role: 'seller' }),
    );
    const deactivated = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: true }),
      { ok: false, status: 403, error: 'Acesso negado a esta empresa' },
    );
    const reactivated = await resolveMetaConversationVisibility(
      companySvc({ chat_visibility_by_assigned_to: true }),
      auth({ role: 'seller' }),
    );
    const allowed = await authorizeMetaConversation(
      conversationSvc(row),
      reactivated,
      { conversationId: CONV_ID },
    );
    expect(active.visibility).toBe('assigned');
    expect(deactivated.reason).toBe('invalid_context');
    expect(allowed.ok).toBe(true);
  });
});

describe('applyMetaConversationFilters', () => {
  it('aplica empresa e atribuição antes da paginação', () => {
    const query = listQuery();
    const filtered = applyMetaConversationFilters(
      query,
      scope({ visibility: 'assigned', role: 'seller' }),
      { instanceId: INSTANCE_ID },
    );
    expect(filtered.ok).toBe(true);
    filtered.query.order().range();
    expect(filtered.query.calls.map((call) => call[0])).toEqual(['eq', 'eq', 'eq', 'order', 'range']);
    expect(filtered.query.calls).toEqual([
      ['eq', 'company_id', COMPANY_ID],
      ['eq', 'instance_id', INSTANCE_ID],
      ['eq', 'assigned_to', USER_ID],
      ['order'],
      ['range'],
    ]);
  });

  it('visão ampla não filtra assigned_to', () => {
    const filtered = applyMetaConversationFilters(listQuery(), scope({ visibility: 'all', role: 'seller' }));
    expect(filtered.query.calls.some((call) => call[1] === 'assigned_to')).toBe(false);
  });

  it('consulta inválida não devolve o builder original', () => {
    const query = listQuery();
    expect(applyMetaConversationFilters(query, null)).toEqual({ ok: false, reason: 'invalid_context' });
    expect(query.calls).toEqual([]);
    expect(applyMetaConversationFilters(query, scope(), { companyId: OTHER_CO }).reason).toBe('company_mismatch');
  });
});

const PARENT_ID = 'abab0000-0000-0000-0000-00000000000a';
const ASSIGNMENT_ID = 'acac0000-0000-0000-0000-00000000000b';

function makeChain(data, error = null) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    in() { return chain; },
    maybeSingle: async () => ({ data, error }),
  };
  return chain;
}

function guardReq(extra = {}) {
  return { headers: { authorization: 'Bearer valid-token' }, ...extra };
}

function guardSvc({ tables = {}, tableSeq = {}, conversation = undefined } = {}) {
  const counters = {};
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from(table) {
      if (table === 'meta_conversations') {
        return conversationSvc(conversation).from(table);
      }
      if (tableSeq[table]) {
        counters[table] = counters[table] ?? 0;
        const chain = tableSeq[table][counters[table]] ?? makeChain(null);
        counters[table] += 1;
        return chain;
      }
      return tables[table] ?? makeChain(null);
    },
  };
}

function directSvc(role, { meta = true, chat = false, conversation } = {}) {
  return guardSvc({
    conversation,
    tables: {
      company_users: makeChain({ role }),
      companies: makeChain({
        id: COMPANY_ID,
        meta_whatsapp_enabled: meta,
        chat_visibility_by_assigned_to: chat,
      }),
    },
  });
}

function companyCaller(svc, companyId = COMPANY_ID, roles = META_VIEW_ROLES) {
  return validateCompanyCaller(guardReq(), svc, companyId, { roles });
}

function metaCaller(svc, companyId = COMPANY_ID) {
  return validateMetaCaller(guardReq(), svc, companyId, { roles: META_VIEW_ROLES });
}

describe('contexto real dos guards no núcleo', () => {
  it('A/B: os dois guards produzem o contexto aceito pelo núcleo', async () => {
    const meta = await metaCaller(directSvc('admin', { meta: true, chat: false }));
    const common = await companyCaller(directSvc('admin', { meta: false, chat: false }));
    expect(meta).toEqual(common);
    expect(parseMetaCallerContext(meta, COMPANY_ID)).toEqual({
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: 'admin',
      accessPath: 'direct',
    });
    const fromMeta = await resolveMetaConversationVisibility(
      directSvc('admin', { meta: true, chat: false }),
      meta,
    );
    const fromCommon = await resolveMetaConversationVisibility(
      directSvc('manager', { meta: false, chat: false }),
      await companyCaller(directSvc('manager', { meta: false, chat: false })),
    );
    expect(fromMeta).toMatchObject({ ok: true, visibility: 'all', role: 'admin', accessPath: 'direct' });
    expect(fromCommon).toMatchObject({ ok: true, visibility: 'all', role: 'manager', accessPath: 'direct' });
  });

  it('C/D/E/F: seller restrito segue a atribuição e a flag desligada preserva a visão ampla', async () => {
    const own = {
      id: CONV_ID,
      company_id: COMPANY_ID,
      instance_id: INSTANCE_ID,
      assigned_to: USER_ID,
    };
    const cases = [
      ['própria', true, own, true],
      ['de terceiro', true, { ...own, assigned_to: OTHER_USER }, false],
      ['sem atribuição', true, { ...own, assigned_to: null }, false],
      ['flag desligada', false, { ...own, assigned_to: null }, true],
    ];
    for (const [label, chat, row, allowed] of cases) {
      const svc = directSvc('seller', { meta: false, chat, conversation: row });
      const context = await companyCaller(svc);
      const scopeResult = await resolveMetaConversationVisibility(svc, context);
      const authorized = await authorizeMetaConversation(svc, scopeResult, {
        conversationId: CONV_ID,
        instanceId: INSTANCE_ID,
      });
      expect(scopeResult.visibility, label).toBe(chat ? 'assigned' : 'all');
      expect(authorized.ok, label).toBe(allowed);
      if (!allowed) {
        expect(authorized).toEqual({
          ok: false,
          status: 404,
          error: META_CONVERSATION_NOT_FOUND,
          reason: 'not_found',
        });
      }
    }
  });

  it.each(['admin', 'manager', 'super_admin', 'system_admin'])(
    'G/H/I: %s autorizado permanece com visão ampla',
    async (role) => {
      const svc = directSvc(role, { meta: false, chat: true });
      const scopeResult = await resolveMetaConversationVisibility(svc, await companyCaller(svc));
      expect(scopeResult).toMatchObject({ ok: true, visibility: 'all', role, accessPath: 'direct' });
    },
  );

  it('J/K: partner só entra com assignment ativo', async () => {
    const active = guardSvc({
      tables: {
        company_users: makeChain({ role: 'partner' }),
        partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }),
        companies: makeChain({ meta_whatsapp_enabled: false, chat_visibility_by_assigned_to: true }),
      },
    });
    const context = await companyCaller(active);
    const scopeResult = await resolveMetaConversationVisibility(active, context);
    expect(context.accessPath).toBe('partner');
    expect(scopeResult.visibility).toBe('all');

    const inactive = guardSvc({
      tables: {
        company_users: makeChain({ role: 'partner' }),
        partner_company_assignments: makeChain(null),
      },
    });
    const denied = await companyCaller(inactive);
    expect(denied).toEqual({
      ok: false,
      status: 403,
      error: 'Partner sem assignment ativo para esta empresa',
    });
    expect((await resolveMetaConversationVisibility(inactive, denied)).reason).toBe('invalid_context');
  });

  it('L/O/P: membership inativa, role desconhecido e credencial ausente não geram contexto', async () => {
    const inactive = await companyCaller(guardSvc());
    const unknown = await companyCaller(directSvc('auditor'));
    const anonymous = await validateCompanyCaller(
      { headers: {} },
      guardSvc(),
      COMPANY_ID,
      { roles: META_VIEW_ROLES },
    );
    expect(inactive).toEqual({ ok: false, status: 403, error: 'Acesso negado a esta empresa' });
    expect(unknown).toEqual({
      ok: false,
      status: 403,
      error: 'Permissão insuficiente para esta operação',
    });
    expect(anonymous.status).toBe(401);
    for (const context of [inactive, unknown, anonymous]) {
      expect((await resolveMetaConversationVisibility(guardSvc(), context)).reason).toBe('invalid_context');
    }
  });

  it('M/N: parent autorizado alcança a filha e parent de outra árvore não produz contexto', async () => {
    for (const role of ['super_admin', 'system_admin']) {
      const svc = guardSvc({
        tableSeq: {
          company_users: [
            makeChain(null),
            makeChain(null),
            makeChain({
              role,
              company_id: PARENT_ID,
              companies: { company_type: 'parent' },
            }),
          ],
          companies: [
            makeChain({ parent_company_id: PARENT_ID }),
            makeChain({ id: COMPANY_ID }),
            makeChain({ chat_visibility_by_assigned_to: false }),
          ],
        },
      });
      const context = await companyCaller(svc);
      const scopeResult = await resolveMetaConversationVisibility(svc, context);
      expect(context).toMatchObject({ ok: true, role, accessPath: 'parent', companyId: COMPANY_ID });
      expect(scopeResult.visibility).toBe('all');
    }

    const foreign = guardSvc({
      tableSeq: {
        company_users: [
          makeChain(null),
          makeChain(null),
          makeChain({
            role: 'system_admin',
            company_id: PARENT_ID,
            companies: { company_type: 'parent' },
          }),
        ],
        companies: [makeChain({ parent_company_id: OTHER_CO })],
      },
    });
    const denied = await companyCaller(foreign);
    expect(denied).toEqual({ ok: false, status: 403, error: 'Acesso negado a esta empresa' });
    expect((await resolveMetaConversationVisibility(foreign, denied)).reason).toBe('invalid_context');
  });

  it('Q/R: trilha adulterada e empresa divergente são negadas antes da flag', async () => {
    const svc = directSvc('admin', { meta: false, chat: false });
    const context = await companyCaller(svc);
    const forged = { ...context, accessPath: 'parent' };
    expect((await resolveMetaConversationVisibility(svc, forged)).reason).toBe('invalid_context');
    expect((await resolveMetaConversationVisibility(svc, context, { companyId: OTHER_CO })).reason)
      .toBe('invalid_context');
  });

  it('S: falha ao ler a flag comercial fecha o acesso do contexto Meta válido', async () => {
    const svc = guardSvc({
      tables: { company_users: makeChain({ role: 'seller' }) },
      tableSeq: {
        companies: [
          makeChain({ meta_whatsapp_enabled: true }),
          makeChain(null, { message: 'timeout' }),
        ],
      },
    });
    const context = await metaCaller(svc);
    const scopeResult = await resolveMetaConversationVisibility(svc, context);
    expect(context.ok).toBe(true);
    expect(scopeResult).toMatchObject({
      ok: false,
      status: 503,
      reason: 'configuration_unavailable',
    });
    expect(scopeResult.error).not.toContain('timeout');
  });

  it('T/X/Y/Z: Meta desligado não abre o guard Meta nem amplia o seller', async () => {
    const tables = {
      company_users: makeChain({ role: 'seller' }),
      companies: makeChain({
        meta_whatsapp_enabled: false,
        chat_visibility_by_assigned_to: true,
      }),
    };
    const commonSvc = guardSvc({
      tables,
      conversation: {
        id: CONV_ID,
        company_id: COMPANY_ID,
        instance_id: INSTANCE_ID,
        assigned_to: OTHER_USER,
      },
    });
    const metaSvc = guardSvc({ tables });
    const common = await validateCompanyCaller(
      guardReq({ body: { role: 'super_admin', accessPath: 'parent', userId: OTHER_USER } }),
      commonSvc,
      COMPANY_ID,
      { roles: META_VIEW_ROLES },
    );
    const meta = await metaCaller(metaSvc);
    const scopeResult = await resolveMetaConversationVisibility(commonSvc, common);
    const authorized = await authorizeMetaConversation(commonSvc, scopeResult, {
      conversationId: CONV_ID,
    });
    expect(common).toMatchObject({
      ok: true,
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: 'seller',
      accessPath: 'direct',
    });
    expect(meta).toEqual({
      ok: false,
      status: 403,
      error: 'Meta WhatsApp não habilitado para esta empresa',
    });
    expect((await resolveMetaConversationVisibility(metaSvc, meta)).reason).toBe('invalid_context');
    expect(scopeResult.visibility).toBe('assigned');
    expect(authorized).toEqual({
      ok: false,
      status: 404,
      error: META_CONVERSATION_NOT_FOUND,
      reason: 'not_found',
    });
  });
});
