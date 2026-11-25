import { describe, expect, it, vi } from 'vitest';
import { AUTHORIZATION_UNAVAILABLE, validateCompanyCaller } from '../validateCompanyCaller.js';
import { CATALOG_UPLOAD_ROLES } from '../../media/catalogUpload/constants.js';

const USER_ID = 'aaaa0000-0000-4000-8000-000000000001';
const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002';
const PARENT_ID = 'cccc0000-0000-4000-8000-000000000003';

function makeChain(data, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function makeSvc() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: vi.fn(),
  };
}

function req() {
  return { headers: { authorization: 'Bearer valid-token' } };
}

const parentRow = {
  role: 'super_admin',
  company_id: PARENT_ID,
  companies: { company_type: 'parent' },
};

function expectInfra(result) {
  expect(result).toEqual({ ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE });
  expect(JSON.stringify(result)).not.toMatch(/db |PGRST|timeout|duplicate|segredo|XX000/i);
}

describe('falha fechada do autorizador compartilhado', () => {
  it('consulta direta falha mesmo com privilégio na empresa pai', async () => {
    const calls = [];
    const svc = makeSvc();
    svc.from.mockImplementation((table) => {
      calls.push(table);
      if (calls.filter((item) => item === 'company_users').length === 1) {
        return makeChain(null, { code: 'XX000', message: 'db down' });
      }
      return makeChain(table === 'companies'
        ? { parent_company_id: PARENT_ID, id: COMPANY_ID }
        : parentRow);
    });

    expectInfra(await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES }));
    expect(calls).toEqual(['company_users']);
  });

  it('duplicidade do maybeSingle falha fechado', async () => {
    const svc = makeSvc();
    svc.from.mockReturnValue(makeChain(null, {
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
    }));

    expectInfra(await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES }));
    expect(svc.from).toHaveBeenCalledTimes(1);
  });

  it('exceção da consulta direta falha fechado', async () => {
    const svc = makeSvc();
    svc.from.mockImplementation(() => {
      throw new Error('timeout acquiring connection');
    });

    expectInfra(await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES }));
    expect(svc.from).toHaveBeenCalledTimes(1);
  });

  it('consulta da empresa falha sem avaliar a trilha parent', async () => {
    const calls = [];
    const svc = makeSvc();
    svc.from.mockImplementation((table) => {
      calls.push(table);
      if (table === 'company_users') return makeChain(calls.length === 1 ? null : parentRow);
      return makeChain(null, { message: 'companies timeout' });
    });

    expectInfra(await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES }));
    expect(calls).toEqual(['company_users', 'companies']);
  });

  it('erro de assignment não continua para a trilha parent', async () => {
    const calls = [];
    const svc = makeSvc();
    svc.from.mockImplementation((table) => {
      calls.push(table);
      if (table === 'company_users' && calls.filter((item) => item === 'company_users').length === 1) {
        return makeChain({ role: 'partner' });
      }
      if (table === 'partner_company_assignments') {
        return makeChain(null, { message: 'assignment timeout' });
      }
      return makeChain(parentRow);
    });

    expectInfra(await validateCompanyCaller(req(), svc, COMPANY_ID, {
      roles: ['partner', 'super_admin', 'system_admin'],
    }));
    expect(calls).toEqual(['company_users', 'partner_company_assignments']);
  });

  it('erro na consulta de vínculo parent não avalia a filha', async () => {
    const calls = [];
    const svc = makeSvc();
    svc.from.mockImplementation((table) => {
      calls.push(table);
      if (table === 'company_users') {
        const attempt = calls.filter((item) => item === 'company_users').length;
        if (attempt === 1) return makeChain(null);
        return makeChain(null, { message: 'parent link down' });
      }
      return makeChain({ parent_company_id: PARENT_ID, id: COMPANY_ID });
    });

    expectInfra(await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES }));
    expect(calls).toEqual(['company_users', 'companies', 'company_users']);
  });

  it('erro na consulta de relacionamento parent/client falha fechado', async () => {
    const calls = [];
    const svc = makeSvc();
    svc.from.mockImplementation((table) => {
      calls.push(table);
      if (table === 'company_users') {
        const attempt = calls.filter((item) => item === 'company_users').length;
        return makeChain(attempt === 1 ? null : parentRow);
      }
      const attempt = calls.filter((item) => item === 'companies').length;
      if (attempt === 1) return makeChain({ parent_company_id: PARENT_ID });
      return makeChain(null, { message: 'child check down' });
    });

    const result = await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES });
    expectInfra(result);
    expect(result.error).not.toContain('não encontrada');
    expect(calls).toEqual(['company_users', 'companies', 'company_users', 'companies']);
  });

  it('ausência confirmada de vínculo direto permite parent legítimo', async () => {
    const svc = makeSvc();
    const sequences = {
      company_users: [makeChain(null), makeChain(parentRow)],
      companies: [makeChain({ parent_company_id: PARENT_ID }), makeChain({ id: COMPANY_ID })],
    };
    const seen = { company_users: 0, companies: 0 };
    svc.from.mockImplementation((table) => {
      const index = seen[table];
      seen[table] += 1;
      return sequences[table][index];
    });

    const result = await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES });
    expect(result).toMatchObject({
      ok: true,
      companyId: COMPANY_ID,
      userId: USER_ID,
      role: 'super_admin',
      accessPath: 'parent',
    });
  });

  it('vínculo direto seller prevalece sobre parent privilegiado', async () => {
    const calls = [];
    const svc = makeSvc();
    svc.from.mockImplementation((table) => {
      calls.push(table);
      if (calls.filter((item) => item === 'company_users').length === 1) {
        return makeChain({ role: 'seller' });
      }
      return makeChain(parentRow);
    });

    const result = await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES });
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Permissão insuficiente para esta operação',
    });
    expect(calls).toEqual(['company_users']);
  });

  it('vínculo direto autorizado não consulta a empresa pai', async () => {
    const svc = makeSvc();
    svc.from.mockReturnValue(makeChain({ role: 'admin' }));

    const result = await validateCompanyCaller(req(), svc, COMPANY_ID, { roles: CATALOG_UPLOAD_ROLES });
    expect(result).toMatchObject({
      ok: true,
      companyId: COMPANY_ID,
      role: 'admin',
      accessPath: 'direct',
    });
    expect(svc.from).toHaveBeenCalledTimes(1);
    expect(svc.from).toHaveBeenCalledWith('company_users');
  });
});
