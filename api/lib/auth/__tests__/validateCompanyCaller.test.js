import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCompanyCaller } from '../validateCompanyCaller.js';
import { validateMetaCaller, META_VIEW_ROLES } from '../../meta-whatsapp/validateMetaCaller.js';

const USER_ID = 'aaaa0000-0000-0000-0000-000000000001';
const COMPANY_ID = 'bbbb0000-0000-0000-0000-000000000002';
const PARENT_ID = 'cccc0000-0000-0000-0000-000000000003';
const OTHER_ID = 'dddd0000-0000-0000-0000-000000000004';
const ASSIGNMENT_ID = 'eeee0000-0000-0000-0000-000000000005';

function makeChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeSvc({ user = { id: USER_ID }, authError = null, tables = {}, tableSeq = {} } = {}) {
  const counters = {};
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authError ? null : user },
        error: authError ?? null,
      }),
    },
    from: vi.fn((table) => {
      if (tableSeq[table]) {
        counters[table] = counters[table] ?? 0;
        const chain = tableSeq[table][counters[table]] ?? makeChain(null);
        counters[table] += 1;
        return chain;
      }
      return tables[table] ?? makeChain(null);
    }),
  };
}

function makeReq(authorization = 'Bearer valid-token', extra = {}) {
  return { headers: { authorization }, body: extra.body, query: extra.query };
}

function directSvc(role, extraTables = {}) {
  return makeSvc({
    tables: {
      company_users: makeChain({ role }),
      ...extraTables,
    },
  });
}

describe('validateCompanyCaller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('A: ausência de credencial nega antes de autenticar', async () => {
    const svc = makeSvc();
    const result = await validateCompanyCaller(
      { headers: {} },
      svc,
      COMPANY_ID,
      { roles: META_VIEW_ROLES },
    );
    expect(result).toEqual({ ok: false, status: 401, error: 'Autenticação necessária' });
    expect(svc.auth.getUser).not.toHaveBeenCalled();
  });

  it('B: credencial inválida nega antes da empresa', async () => {
    const svc = makeSvc({ authError: new Error('invalid_jwt') });
    const result = await validateCompanyCaller(makeReq(), svc, 'not-a-uuid', {
      roles: META_VIEW_ROLES,
    });
    expect(result).toEqual({ ok: false, status: 401, error: 'Sessão inválida ou expirada' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('C/D/I/J/K/L/M: membership ativa devolve o role do banco', async () => {
    for (const role of ['super_admin', 'system_admin', 'admin', 'manager', 'seller']) {
      const users = makeChain({ role });
      const svc = makeSvc({ tables: { company_users: users } });
      const result = await validateCompanyCaller(makeReq(), svc, COMPANY_ID, {
        roles: META_VIEW_ROLES,
      });
      expect(result).toEqual({
        ok: true,
        userId: USER_ID,
        companyId: COMPANY_ID,
        role,
        accessPath: 'direct',
      });
      expect(users.eq).toHaveBeenCalledWith('is_active', true);
      expect(svc.from).not.toHaveBeenCalledWith('companies');
    }
  });

  it('E/F: membership inativa ou ausente não abre acesso', async () => {
    const svc = makeSvc({
      tables: {
        company_users: makeChain(null),
        companies: makeChain(null),
      },
    });
    const result = await validateCompanyCaller(makeReq(), svc, COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    expect(result).toEqual({ ok: false, status: 403, error: 'Acesso negado a esta empresa' });
  });

  it('G/H: role desconhecido ou fora da operação é negado', async () => {
    const unknown = await validateCompanyCaller(
      makeReq(),
      directSvc('auditor'),
      COMPANY_ID,
      { roles: META_VIEW_ROLES },
    );
    const sellerConnect = await validateCompanyCaller(
      makeReq(),
      directSvc('seller'),
      COMPANY_ID,
      { roles: ['super_admin', 'system_admin', 'admin'] },
    );
    expect(unknown).toEqual({
      ok: false,
      status: 403,
      error: 'Permissão insuficiente para esta operação',
    });
    expect(sellerConnect).toEqual(unknown);
  });

  it('N: partner com assignment ativo entra pela trilha partner', async () => {
    const svc = makeSvc({
      tables: {
        company_users: makeChain({ role: 'partner' }),
        partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }),
      },
    });
    const result = await validateCompanyCaller(makeReq(), svc, COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    expect(result).toEqual({
      ok: true,
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: 'partner',
      accessPath: 'partner',
    });
    expect(svc.from).not.toHaveBeenCalledWith('companies');
  });

  it('O/P: partner sem assignment ou com assignment inativo é negado', async () => {
    const assignments = makeChain(null);
    const svc = makeSvc({
      tables: {
        company_users: makeChain({ role: 'partner' }),
        partner_company_assignments: assignments,
      },
    });
    const result = await validateCompanyCaller(makeReq(), svc, COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Partner sem assignment ativo para esta empresa',
    });
    expect(assignments.eq).toHaveBeenCalledWith('is_active', true);
    expect(svc.from).not.toHaveBeenCalledWith('companies');
  });

  it('Q: parent autorizado alcança a filha vinculada', async () => {
    for (const role of ['super_admin', 'system_admin']) {
      const svc = makeSvc({
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
          ],
        },
      });
      const result = await validateCompanyCaller(makeReq(), svc, COMPANY_ID, {
        roles: META_VIEW_ROLES,
      });
      expect(result).toEqual({
        ok: true,
        userId: USER_ID,
        companyId: COMPANY_ID,
        role,
        accessPath: 'parent',
      });
    }
  });

  it('R/S: parent de outra árvore e empresa sem vínculo são negados', async () => {
    const foreign = makeSvc({
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
        companies: [
          makeChain({ parent_company_id: OTHER_ID }),
        ],
      },
    });
    const deniedParent = await validateCompanyCaller(makeReq(), foreign, COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    expect(deniedParent).toEqual({
      ok: false,
      status: 403,
      error: 'Acesso negado a esta empresa',
    });

    const missing = await validateCompanyCaller(
      makeReq(),
      makeSvc(),
      COMPANY_ID,
      { roles: META_VIEW_ROLES },
    );
    expect(missing).toEqual({ ok: false, status: 403, error: 'Acesso negado a esta empresa' });
  });

  it('T: erro de consulta não abre acesso', async () => {
    const svc = makeSvc({
      tables: {
        company_users: makeChain(null, { message: 'db down' }),
        companies: makeChain(null, { message: 'db down' }),
      },
    });
    const result = await validateCompanyCaller(makeReq(), svc, COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'Autorização temporariamente indisponível',
    });
    expect(JSON.stringify(result)).not.toContain('db down');
    expect(svc.from).not.toHaveBeenCalledWith('companies');
  });

  it('U/V: empresa sem Meta passa no módulo comum e continua negada no guard Meta', async () => {
    const tables = {
      company_users: makeChain({ role: 'admin' }),
      companies: makeChain({ meta_whatsapp_enabled: false }),
    };
    const commonSvc = makeSvc({ tables });
    const common = await validateCompanyCaller(makeReq(), commonSvc, COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    expect(common.ok).toBe(true);
    expect(common.role).toBe('admin');
    expect(commonSvc.from).not.toHaveBeenCalledWith('companies');

    const meta = await validateMetaCaller(makeReq(), makeSvc({ tables }), COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    expect(meta).toEqual({
      ok: false,
      status: 403,
      error: 'Meta WhatsApp não habilitado para esta empresa',
    });
  });

  it('W/X: o guard Meta preserva o contexto e as mensagens anteriores', async () => {
    const tables = {
      company_users: makeChain({ role: 'manager' }),
      companies: makeChain({ meta_whatsapp_enabled: true }),
    };
    const common = await validateCompanyCaller(makeReq(), makeSvc({ tables }), COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    const meta = await validateMetaCaller(makeReq(), makeSvc({ tables }), COMPANY_ID, {
      roles: META_VIEW_ROLES,
    });
    expect(meta).toEqual(common);
    expect(meta).toEqual({
      ok: true,
      userId: USER_ID,
      companyId: COMPANY_ID,
      role: 'manager',
      accessPath: 'direct',
    });

    const missingCredential = await validateMetaCaller(
      { headers: {} },
      makeSvc(),
      COMPANY_ID,
    );
    expect(missingCredential).toEqual({
      ok: false,
      status: 401,
      error: 'Autenticação necessária',
    });
  });

  it('Y: role informado pelo cliente não amplia o acesso', async () => {
    const result = await validateCompanyCaller(
      makeReq('Bearer valid-token', { body: { role: 'super_admin' }, query: { accessPath: 'parent' } }),
      directSvc('seller'),
      COMPANY_ID,
      { roles: ['admin'] },
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Permissão insuficiente para esta operação',
    });
  });
});
