import { describe, expect, it, vi } from 'vitest';
import { BYO_POC_ROLES } from '../byoPocGate.js';
import { authorizeByoCredentialWrite, BYO_CREDENTIAL_WRITE_ROLES } from '../byoCredentialAuth.js';
import * as instagramCaller from '../validateInstagramCaller.js';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const PARENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_PARENT = 'bbbbbbbb-0000-4000-8000-000000000002';
const USER = { id: 'user-1' };
const SECRET = 'fixture-app-secret-not-real';
const FORBIDDEN = {
  ok: false,
  status: 403,
  error: 'Permissão insuficiente para esta operação',
};
const UNAVAILABLE = {
  ok: false,
  status: 503,
  error: 'Serviço temporariamente indisponível',
};

function eqValue(filters, column) {
  return filters.find((item) => item[0] === 'eq' && item[1] === column)?.[2];
}

function directRow(state, filters) {
  const direct = state.direct;
  if (!direct || direct.role == null) return null;
  if (eqValue(filters, 'company_id') !== direct.companyId) return null;
  if (eqValue(filters, 'user_id') !== state.user?.id) return null;
  if (eqValue(filters, 'is_active') === true && direct.active === false) return null;
  return direct;
}

function mockSvc(state) {
  function resolveSingle(table, filters) {
    const roleList = filters.find((item) => item[0] === 'in' && item[1] === 'role')?.[2];
    if (table === 'company_users' && !roleList) {
      if (state.directQueryError) {
        return { data: null, error: { message: 'falha-consulta-direta' } };
      }
      const direct = directRow(state, filters);
      if (!direct) return { data: null, error: null };
      return { data: { role: direct.role }, error: null };
    }
    if (table === 'company_users' && roleList) {
      const parent = state.parent;
      if (!parent || !roleList.includes(parent.role)) return { data: null, error: null };
      if (eqValue(filters, 'user_id') !== state.user?.id) return { data: null, error: null };
      if (eqValue(filters, 'is_active') !== true) return { data: null, error: null };
      return { data: parent, error: null };
    }
    if (table === 'companies') {
      const child = state.child;
      if (!child || eqValue(filters, 'id') !== child.id) return { data: null, error: null };
      if (eqValue(filters, 'parent_company_id') !== child.parentCompanyId) return { data: null, error: null };
      return { data: { id: child.id }, error: null };
    }
    if (table === 'partner_company_assignments') {
      return { data: state.assignment ? { id: 'assignment-1' } : null, error: null };
    }
    return { data: null, error: { message: 'tabela inesperada' } };
  }

  function resolveList(table, filters) {
    const roleList = filters.find((item) => item[0] === 'in' && item[1] === 'role')?.[2];
    if (table !== 'company_users' || roleList) {
      return { data: null, error: { message: 'lista inesperada' } };
    }
    if (state.proof) return state.proof;
    const direct = directRow(state, filters);
    if (!direct) return { data: [], error: null };
    return { data: [{ role: direct.role, user_id: 'intruso' }], error: null };
  }

  function from(table) {
    const filters = [];
    const query = {
      select() { return query; },
      eq(column, value) { filters.push(['eq', column, value]); return query; },
      in(column, value) { filters.push(['in', column, value]); return query; },
      maybeSingle() { return Promise.resolve(resolveSingle(table, filters)); },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolveList(table, filters)).then(onFulfilled, onRejected);
      },
    };
    return query;
  }

  return {
    auth: {
      getUser: async () => (
        state.user
          ? { data: { user: state.user }, error: null }
          : { data: { user: null }, error: { message: 'invalid' } }
      ),
    },
    from,
  };
}

function request() {
  return {
    headers: { authorization: 'Bearer test-token' },
    body: { app_secret: SECRET, user_id: 'intruso' },
  };
}

function parentState(role, parentCompanyId = PARENT) {
  return {
    user: USER,
    parent: { role, company_id: parentCompanyId, companies: { company_type: 'parent' } },
    child: { id: COMPANY, parentCompanyId: PARENT },
  };
}

describe('authorizeByoCredentialWrite', () => {
  it('lista só super_admin, system_admin e admin', () => {
    expect(BYO_CREDENTIAL_WRITE_ROLES).toEqual(['super_admin', 'system_admin', 'admin']);
    expect(BYO_POC_ROLES).toContain('manager');
    expect(BYO_POC_ROLES).toContain('partner');
    expect(BYO_CREDENTIAL_WRITE_ROLES).not.toContain('manager');
  });

  it('autoriza admin direto e nega manager, partner e seller', async () => {
    for (const role of ['manager', 'partner', 'seller']) {
      const result = await authorizeByoCredentialWrite(
        request(),
        mockSvc({
          user: USER,
          direct: { role, companyId: COMPANY },
          assignment: true,
          proof: { data: [{ role: 'admin', user_id: 'intruso' }], error: null },
        }),
        COMPANY,
      );
      expect(result).toEqual(FORBIDDEN);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }

    const admin = await authorizeByoCredentialWrite(
      request(),
      mockSvc({ user: USER, direct: { role: 'admin', companyId: COMPANY } }),
      COMPANY,
    );
    expect(admin).toEqual({ ok: true, userId: 'user-1', role: 'admin' });
    expect(JSON.stringify(admin)).not.toContain('intruso');
  });

  it('autoriza super_admin e system_admin só da pai correta', async () => {
    const allowed = await authorizeByoCredentialWrite(
      request(),
      mockSvc(parentState('super_admin')),
      COMPANY,
    );
    expect(allowed).toEqual({ ok: true, userId: 'user-1', role: 'super_admin' });

    const systemAdmin = await authorizeByoCredentialWrite(
      request(),
      mockSvc(parentState('system_admin')),
      COMPANY,
    );
    expect(systemAdmin).toEqual({ ok: true, userId: 'user-1', role: 'system_admin' });

    const wrongParent = await authorizeByoCredentialWrite(
      request(),
      mockSvc(parentState('super_admin', OTHER_PARENT)),
      COMPANY,
    );
    expect(wrongParent).toEqual({
      ok: false,
      status: 403,
      error: 'Empresa não encontrada ou sem acesso',
    });
  });

  it('autoriza parent quando o vínculo direto está inativo', async () => {
    const result = await authorizeByoCredentialWrite(
      request(),
      mockSvc({
        ...parentState('super_admin'),
        direct: { role: 'manager', companyId: COMPANY, active: false },
      }),
      COMPANY,
    );
    expect(result).toEqual({ ok: true, userId: 'user-1', role: 'super_admin' });
  });

  it('nega manager direto quando a consulta do helper falha e a pai autoriza', async () => {
    const result = await authorizeByoCredentialWrite(
      request(),
      mockSvc({
        ...parentState('super_admin'),
        directQueryError: true,
        proof: { data: [{ role: 'manager' }], error: null },
      }),
      COMPANY,
    );
    expect(result).toEqual(FORBIDDEN);
    expect(JSON.stringify(result)).not.toContain('falha-consulta-direta');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('devolve admin direto quando o helper autorizou super_admin da pai', async () => {
    const result = await authorizeByoCredentialWrite(
      request(),
      mockSvc({
        ...parentState('super_admin'),
        directQueryError: true,
        proof: { data: [{ role: 'admin', user_id: 'intruso' }], error: null },
      }),
      COMPANY,
    );
    expect(result).toEqual({ ok: true, userId: 'user-1', role: 'admin' });
    expect(JSON.stringify(result)).not.toContain('intruso');
  });

  it('devolve super_admin direto quando o helper autorizou system_admin da pai', async () => {
    const result = await authorizeByoCredentialWrite(
      request(),
      mockSvc({
        ...parentState('system_admin'),
        directQueryError: true,
        proof: { data: [{ role: 'super_admin', user_id: 'intruso' }], error: null },
      }),
      COMPANY,
    );
    expect(result).toEqual({ ok: true, userId: 'user-1', role: 'super_admin' });
    expect(JSON.stringify(result)).not.toContain('intruso');
  });

  it('classifica falha, ausência e formato da segunda consulta', async () => {
    const cases = [
      [{ data: null, error: { message: 'falha-consulta-direta', details: SECRET } }, UNAVAILABLE],
      [{ data: null, error: null }, UNAVAILABLE],
      [{ data: { role: 'admin' }, error: null }, UNAVAILABLE],
      [{ data: [{ role: 'admin' }, { role: 'manager' }], error: null }, FORBIDDEN],
      [{ data: [{ role: 'seller' }], error: null }, FORBIDDEN],
      [{ data: [], error: null }, FORBIDDEN],
    ];

    for (const [proof, expected] of cases) {
      const result = await authorizeByoCredentialWrite(
        request(),
        mockSvc({
          user: USER,
          direct: { role: 'admin', companyId: COMPANY },
          proof,
        }),
        COMPANY,
      );
      expect(result).toEqual(expected);
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain('falha-consulta-direta');
    }
  });

  it('preserva 401 do helper', async () => {
    const missing = await authorizeByoCredentialWrite(
      { headers: {}, body: { app_secret: SECRET } },
      mockSvc({ user: USER }),
      COMPANY,
    );
    expect(missing).toEqual({ ok: false, status: 401, error: 'Autenticação necessária' });

    const invalid = await authorizeByoCredentialWrite(
      request(),
      mockSvc({ user: null }),
      COMPANY,
    );
    expect(invalid).toEqual({ ok: false, status: 401, error: 'Sessão inválida ou expirada' });
    expect(JSON.stringify(invalid)).not.toContain(SECRET);
  });

  it('revalida uma role fora da lista mesmo se o helper a devolvesse', async () => {
    const spy = vi.spyOn(instagramCaller, 'validateInstagramCaller').mockResolvedValue({
      ok: true,
      userId: 'user-1',
      role: 'partner',
    });
    const result = await authorizeByoCredentialWrite(request(), {}, COMPANY);
    expect(result).toEqual(FORBIDDEN);
    spy.mockRestore();
  });
});
