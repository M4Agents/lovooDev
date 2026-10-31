import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeInstagramModalitySwitch } from '../instagramModalityAuth.js';

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';
const PARENT = 'dddddddd-0000-4000-8000-000000000004';
const USER = '11111111-1111-4111-8111-111111111111';

function builder(result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function service(steps) {
  const queue = [...steps];
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: USER } }, error: null }),
    },
    from: () => builder(queue.shift()),
  };
}

function request() {
  return { headers: { authorization: 'Bearer session-token' } };
}

describe('authorizeInstagramModalitySwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recusa sessão ausente', async () => {
    const result = await authorizeInstagramModalitySwitch(
      { headers: {} },
      service([]),
      COMPANY,
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('recusa usuário sem vínculo com a empresa', async () => {
    const result = await authorizeInstagramModalitySwitch(request(), service([
      { data: null, error: null },
      { data: null, error: null },
    ]), COMPANY);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('recusa manager, seller e partner', async () => {
    for (const role of ['manager', 'seller', 'partner']) {
      const result = await authorizeInstagramModalitySwitch(request(), service([
        { data: { role }, error: null },
      ]), COMPANY);
      expect(result).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('recusa partner mesmo com atribuição, porque o papel não escreve', async () => {
    const result = await authorizeInstagramModalitySwitch(request(), service([
      { data: { role: 'partner' }, error: null },
      { data: { id: 'assignment' }, error: null },
    ]), COMPANY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('recusa super_admin apenas da empresa pai', async () => {
    const result = await authorizeInstagramModalitySwitch(request(), service([
      { data: null, error: null },
      {
        data: {
          role: 'super_admin',
          company_id: PARENT,
          companies: { company_type: 'parent' },
        },
        error: null,
      },
      { data: { id: COMPANY }, error: null },
      { data: [], error: null },
    ]), COMPANY);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('recusa dois papéis diretos', async () => {
    const result = await authorizeInstagramModalitySwitch(request(), service([
      { data: { role: 'admin' }, error: null },
      { data: [{ role: 'admin' }, { role: 'system_admin' }], error: null },
    ]), COMPANY);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('autoriza um admin direto e devolve o usuário do JWT', async () => {
    const result = await authorizeInstagramModalitySwitch(request(), service([
      { data: { role: 'admin' }, error: null },
      { data: [{ role: 'admin' }], error: null },
    ]), COMPANY);
    expect(result).toEqual({ ok: true, userId: USER, role: 'admin' });
  });
});
