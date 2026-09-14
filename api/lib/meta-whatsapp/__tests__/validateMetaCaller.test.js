// =============================================================================
// validateMetaCaller.test.js
//
// Testes unitários para api/lib/meta-whatsapp/validateMetaCaller.js
// Todos os testes usam mocks — sem banco, rede ou credential real.
//
// COBERTURA:
//   TC-A  Sem Authorization → 401
//   TC-B  Bearer inválido (JWT rejeitado) → 401
//   TC-C  company_id inválido (verificada APÓS auth) → 400 ou 401 conforme Bearer
//   TC-D  Membership direta + role permitida + flag ON → sucesso (accessPath=direct)
//   TC-E  Membership direta + role não permitida → 403
//   TC-F  seller com META_CONNECT_ROLES → 403
//   TC-G  seller com META_VIEW_ROLES → sucesso
//   TC-H  Partner sem assignment ativo → 403
//   TC-I  Partner com assignment ativo + flag ON → sucesso (accessPath=partner)
//   TC-J  Parent admin com child pertencente ao parent correto → sucesso (accessPath=parent)
//   TC-K  Parent admin tentando empresa de outro parent → 403
//   TC-L  Acesso legítimo + feature flag OFF → 403
//   TC-M  Feature flag SEMPRE obrigatória — sem bypass público
//   TC-N  Nenhuma query de credentials/onboarding/instances deve ocorrer
//
// ORDEM DE VALIDAÇÃO (implementação):
//   1. Bearer check
//   2. svc.auth.getUser(token) → 401 se inválido
//   3. UUID format check       → 400 se inválido
//   4. Trilha 1/2 + RBAC
//   5. Feature flag (sempre)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateMetaCaller,
  META_VIEW_ROLES,
  META_CONNECT_ROLES,
} from '../validateMetaCaller.js';

// ── Silenciar logs ─────────────────────────────────────────────────────────────
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// =============================================================================
// UUIDs de teste
// =============================================================================

const USER_ID        = 'aaaa0000-0000-0000-0000-000000000001';
const COMPANY_ID     = 'bbbb0000-0000-0000-0000-000000000002';
const PARENT_ID      = 'cccc0000-0000-0000-0000-000000000003';
const OTHER_CHILD_ID = 'dddd0000-0000-0000-0000-000000000004';
const ASSIGNMENT_ID  = 'eeee0000-0000-0000-0000-000000000005';

// =============================================================================
// Factories de mock
// =============================================================================

/** Cria um objeto de chain Supabase que encadeia .select().eq()...maybeSingle() */
function makeChain(data, error = null) {
  const chain = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    in:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

/**
 * Cria um mock de svc com tabelas configuráveis.
 *
 * @param {object} [opts]
 * @param {{ id: string } | null} [opts.user]         — usuário retornado por auth.getUser
 * @param {Error | null}          [opts.authError]    — erro em auth.getUser
 * @param {Record<string, object>} [opts.tables]      — mapa tabela → chain (reutilizado)
 * @param {Record<string, object[]>} [opts.tableSeq]  — mapa tabela → fila de chains em sequência
 *
 * Para a mesma tabela consultada mais de uma vez (ex: Trilha 2 consulta
 * company_users para membership direta e depois para membership pai; Trilha 2
 * consulta companies para childCheck e depois para feature flag), use tableSeq:
 *   tableSeq: { company_users: [chainDireto, chainParent] }
 * Cada chamada .from('company_users') retornará o próximo chain da fila.
 * Se a fila se esgotar, retorna makeChain(null).
 */
function makeSvc({
  user      = { id: USER_ID },
  authError = null,
  tables    = {},
  tableSeq  = {},
} = {}) {
  const counters = {};

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data:  { user: authError ? null : user },
        error: authError ?? null,
      }),
    },
    from: vi.fn().mockImplementation((table) => {
      if (tableSeq[table]) {
        counters[table] = (counters[table] ?? 0);
        const chain = tableSeq[table][counters[table]] ?? makeChain(null);
        counters[table]++;
        return chain;
      }
      return tables[table] ?? makeChain(null);
    }),
  };
}

/** Cria um request mock com Authorization header. */
function makeReq(authHeader = 'Bearer valid-token') {
  return { headers: { authorization: authHeader } };
}

// =============================================================================
// Testes
// =============================================================================

describe('validateMetaCaller', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // TC-A: sem Authorization
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-A: sem Authorization', () => {
    it('retorna 401 quando header authorization está ausente', async () => {
      const svc = makeSvc();
      const req = { headers: {} };

      const result = await validateMetaCaller(req, svc, COMPANY_ID);

      expect(result).toEqual({ ok: false, status: 401, error: 'Autenticação necessária' });
      expect(svc.auth.getUser).not.toHaveBeenCalled();
    });

    it('retorna 401 quando prefixo Bearer está ausente', async () => {
      const svc = makeSvc();
      const req = makeReq('Basic dXNlcjpwYXNz');

      const result = await validateMetaCaller(req, svc, COMPANY_ID);

      expect(result).toEqual({ ok: false, status: 401, error: 'Autenticação necessária' });
      expect(svc.auth.getUser).not.toHaveBeenCalled();
    });

    it('Authorization ausente + companyId inválido → 401 (auth vence)', async () => {
      const svc = makeSvc();
      const req = { headers: {} };

      const result = await validateMetaCaller(req, svc, 'not-a-uuid');

      // Bearer ausente → 401 antes de qualquer check de UUID
      expect(result).toEqual({ ok: false, status: 401, error: 'Autenticação necessária' });
      expect(svc.auth.getUser).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-B: Bearer inválido (JWT rejeitado pelo Supabase)
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-B: Bearer inválido', () => {
    it('retorna 401 quando auth.getUser retorna erro', async () => {
      const svc = makeSvc({ authError: new Error('invalid_jwt') });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID);

      expect(result).toEqual({ ok: false, status: 401, error: 'Sessão inválida ou expirada' });
      expect(svc.auth.getUser).toHaveBeenCalledOnce();
    });

    it('retorna 401 quando auth.getUser retorna user null', async () => {
      const svc = makeSvc();
      svc.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID);

      expect(result).toEqual({ ok: false, status: 401, error: 'Sessão inválida ou expirada' });
      expect(svc.auth.getUser).toHaveBeenCalledOnce();
    });

    it('Bearer inválido + companyId inválido → 401 (auth vence sobre UUID)', async () => {
      const svc = makeSvc({ authError: new Error('expired') });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, 'not-a-uuid');

      // auth.getUser é chamado (Bearer presente), falha → 401
      expect(svc.auth.getUser).toHaveBeenCalledOnce();
      expect(result).toEqual({ ok: false, status: 401, error: 'Sessão inválida ou expirada' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-C: company_id inválido (verificado APÓS auth bem-sucedida)
  //
  // ORDEM DE VALIDAÇÃO:
  //   1. Bearer check
  //   2. auth.getUser → 401 se inválido
  //   3. UUID format  → 400 se inválido (somente se auth OK)
  //
  // Portanto:
  //   sem Authorization + UUID inválido  → 401
  //   Bearer inválido   + UUID inválido  → 401 (auth.getUser chamado)
  //   Bearer válido     + UUID inválido  → 400 (auth.getUser chamado)
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-C: company_id inválido', () => {
    const invalidIds = [
      '',
      'not-a-uuid',
      '12345',
      'gggg0000-0000-0000-0000-000000000000', // chars inválidos (g não é hex)
      null,
      undefined,
    ];

    for (const badId of invalidIds) {
      it(`Bearer válido + company_id="${badId}" → 400 (auth chamada, UUID rejeitado depois)`, async () => {
        const svc = makeSvc(); // auth válida
        const req = makeReq();

        const result = await validateMetaCaller(req, svc, badId);

        expect(result).toEqual({ ok: false, status: 400, error: 'company_id inválido' });
        // auth.getUser chamado antes da validação de UUID
        expect(svc.auth.getUser).toHaveBeenCalledOnce();
        // Nenhuma query no banco após o 400
        expect(svc.from).not.toHaveBeenCalled();
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-D: membership direta + role permitida + flag ON → sucesso
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-D: membership direta com role permitida e flag ON', () => {
    it('retorna ok=true com accessPath=direct para admin + META_VIEW_ROLES + flag ON', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          companies:     makeChain({ meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      expect(result).toEqual({
        ok:         true,
        userId:     USER_ID,
        companyId:  COMPANY_ID,
        role:       'admin',
        accessPath: 'direct',
      });
    });

    it('retorna ok=true para super_admin com META_CONNECT_ROLES + flag ON', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'super_admin' }),
          companies:     makeChain({ meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_CONNECT_ROLES });

      expect(result.ok).toBe(true);
      expect(result.role).toBe('super_admin');
      expect(result.accessPath).toBe('direct');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-E: membership direta com role não permitida → 403
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-E: role não permitida pela ação', () => {
    it('retorna 403 quando role não está na lista recebida', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'seller' }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, {
        roles: ['super_admin', 'admin'],
      });

      expect(result).toEqual({
        ok:     false,
        status: 403,
        error:  'Permissão insuficiente para esta operação',
      });
      // Não deve consultar companies (flag) se role já negada
      expect(svc.from).not.toHaveBeenCalledWith('companies');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-F: seller bloqueado em META_CONNECT_ROLES
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-F: seller bloqueado em META_CONNECT_ROLES', () => {
    it('retorna 403 para seller tentando ação de conexão', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'seller' }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_CONNECT_ROLES });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect(META_CONNECT_ROLES).not.toContain('seller');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-G: seller permitido em META_VIEW_ROLES
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-G: seller permitido em META_VIEW_ROLES', () => {
    it('retorna ok=true para seller com ação de visualização + flag ON', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'seller' }),
          companies:     makeChain({ meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      expect(result.ok).toBe(true);
      expect(result.role).toBe('seller');
      expect(result.accessPath).toBe('direct');
      expect(META_VIEW_ROLES).toContain('seller');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-H: partner sem assignment ativo → 403
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-H: partner sem assignment ativo', () => {
    it('retorna 403 quando partner não tem assignment ativo para a empresa', async () => {
      const svc = makeSvc({
        tables: {
          company_users:               makeChain({ role: 'partner' }),
          partner_company_assignments: makeChain(null),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      expect(result).toEqual({
        ok:     false,
        status: 403,
        error:  'Partner sem assignment ativo para esta empresa',
      });
      // companies (flag) não deve ser consultada — negado antes
      expect(svc.from).not.toHaveBeenCalledWith('companies');
    });

    it('partner em META_VIEW_ROLES sem assignment → 403 (role sozinha não basta)', async () => {
      expect(META_VIEW_ROLES).toContain('partner'); // partner está na lista
      const svc = makeSvc({
        tables: {
          company_users:               makeChain({ role: 'partner' }),
          partner_company_assignments: makeChain(null),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-I: partner com assignment ativo → sucesso
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-I: partner com assignment ativo e flag ON', () => {
    it('retorna ok=true com accessPath=partner quando assignment está ativo', async () => {
      const svc = makeSvc({
        tables: {
          company_users:               makeChain({ role: 'partner' }),
          partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }),
          companies:                   makeChain({ meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_CONNECT_ROLES });

      expect(result).toEqual({
        ok:         true,
        userId:     USER_ID,
        companyId:  COMPANY_ID,
        role:       'partner',
        accessPath: 'partner',
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-J: parent admin com child pertencente ao parent correto → sucesso
  //
  // Trilha 2 consulta:
  //   company_users × 2  (1ª: sem membership direta; 2ª: parent admin)
  //   companies × 2      (1ª: childCheck; 2ª: feature flag)
  //
  // Para as duas consultas a companies retornamos um objeto com ambos os campos
  // necessários: id (para childCheck) e meta_whatsapp_enabled (para a flag).
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-J: parent admin com hierarquia correta', () => {
    it('retorna ok=true com accessPath=parent para super_admin de parent com child correto', async () => {
      const svc = makeSvc({
        tableSeq: {
          company_users: [
            makeChain(null),      // 1ª: sem membership direta
            makeChain({           // 2ª: parent admin
              role:      'super_admin',
              company_id: PARENT_ID,
              companies: { company_type: 'parent' },
            }),
          ],
        },
        tables: {
          // Mesmo objeto satisfaz childCheck (non-null) e feature flag (enabled=true)
          companies: makeChain({ id: COMPANY_ID, meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      expect(result).toEqual({
        ok:         true,
        userId:     USER_ID,
        companyId:  COMPANY_ID,
        role:       'super_admin',
        accessPath: 'parent',
      });
    });

    it('system_admin de parent também tem acesso via Trilha 2', async () => {
      const svc = makeSvc({
        tableSeq: {
          company_users: [
            makeChain(null),
            makeChain({
              role:       'system_admin',
              company_id: PARENT_ID,
              companies:  { company_type: 'parent' },
            }),
          ],
        },
        tables: {
          companies: makeChain({ id: COMPANY_ID, meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID);

      expect(result.ok).toBe(true);
      expect(result.role).toBe('system_admin');
      expect(result.accessPath).toBe('parent');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-K: parent admin tentando empresa de outro parent → 403
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-K: isolamento multi-tenant — parent cross-tenant bloqueado', () => {
    it('retorna 403 quando empresa alvo não pertence ao parent do usuário', async () => {
      const svc = makeSvc({
        tableSeq: {
          company_users: [
            makeChain(null),
            makeChain({
              role:       'super_admin',
              company_id: PARENT_ID,
              companies:  { company_type: 'parent' },
            }),
          ],
        },
        tables: {
          // child NÃO pertence a PARENT_ID → childCheck retorna null → 403
          companies: makeChain(null),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, OTHER_CHILD_ID);

      expect(result).toEqual({
        ok:     false,
        status: 403,
        error:  'Empresa não encontrada ou sem acesso',
      });
    });

    it('admin de empresa client (não parent) não acessa via Trilha 2', async () => {
      // 2ª consulta company_users usa .in('role', ['super_admin','system_admin'])
      // — admin não está nesse filtro, Supabase retornaria null
      const svc = makeSvc({
        tableSeq: {
          company_users: [
            makeChain(null), // sem membership direta
            makeChain(null), // sem membership parent (admin filtrado pelo .in())
          ],
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID);

      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-L: acesso legítimo + feature flag OFF → 403
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-L: feature flag OFF bloqueia acesso mesmo com auth/RBAC válidos', () => {
    it('retorna 403 quando companies.meta_whatsapp_enabled = false', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          companies:     makeChain({ meta_whatsapp_enabled: false }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      expect(result).toEqual({
        ok:     false,
        status: 403,
        error:  'Meta WhatsApp não habilitado para esta empresa',
      });
    });

    it('retorna 403 quando company não existe (meta_whatsapp_enabled é null)', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          companies:     makeChain(null),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-M: feature flag SEMPRE obrigatória — sem bypass público
  //
  // validateMetaCaller não expõe requireFeatureFlag nem qualquer opção de
  // bypass. A única opção pública é { roles }.
  // Qualquer propriedade extra passada em options é silenciosamente ignorada,
  // mas a flag continua sendo verificada normalmente.
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-M: feature flag é sempre obrigatória (sem bypass público)', () => {
    it('flag OFF → 403 mesmo passando propriedade requireFeatureFlag:false (ignorada)', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          companies:     makeChain({ meta_whatsapp_enabled: false }),
        },
      });
      const req = makeReq();

      // requireFeatureFlag não é parâmetro da API pública — será ignorado
      // mas a flag OFF deve continuar bloqueando o acesso
      const result = await validateMetaCaller(req, svc, COMPANY_ID, {
        roles:              META_VIEW_ROLES,
        requireFeatureFlag: false, // propriedade desconhecida — não tem efeito
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toBe('Meta WhatsApp não habilitado para esta empresa');
    });

    it('companies sempre consultado após auth+RBAC válidos para verificar flag', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          companies:     makeChain({ meta_whatsapp_enabled: false }),
        },
      });
      const req = makeReq();

      await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      const companiesCalls = svc.from.mock.calls.filter(([t]) => t === 'companies');
      expect(companiesCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('flag ON → sucesso (confirma que a flag é verificada, não sempre bloqueada)', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'manager' }),
          companies:     makeChain({ meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      const result = await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      expect(result.ok).toBe(true);
      expect(result.role).toBe('manager');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-N: tabelas sensíveis nunca consultadas
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-N: isolamento de tabelas sensíveis', () => {
    const SENSITIVE_TABLES = [
      'meta_whatsapp_credentials',
      'meta_whatsapp_onboarding',
      'meta_whatsapp_instances',
      'instagram_connections',
      'nuvemshop_connections',
    ];

    it('nenhuma tabela sensível é consultada em fluxo de sucesso', async () => {
      const svc = makeSvc({
        tables: {
          company_users: makeChain({ role: 'admin' }),
          companies:     makeChain({ meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      const queriedTables = svc.from.mock.calls.map(([t]) => t);
      for (const sensitive of SENSITIVE_TABLES) {
        expect(queriedTables).not.toContain(sensitive);
      }
    });

    it('nenhuma tabela sensível é consultada em fluxo de falha (auth inválida)', async () => {
      const svc = makeSvc({ authError: new Error('bad') });
      const req = makeReq();

      await validateMetaCaller(req, svc, COMPANY_ID);

      const queriedTables = svc.from.mock.calls.map(([t]) => t);
      for (const sensitive of SENSITIVE_TABLES) {
        expect(queriedTables).not.toContain(sensitive);
      }
    });

    it('somente company_users, partner_company_assignments e companies são consultadas', async () => {
      const ALLOWED_TABLES = new Set([
        'company_users',
        'partner_company_assignments',
        'companies',
      ]);
      const svc = makeSvc({
        tables: {
          company_users:               makeChain({ role: 'partner' }),
          partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }),
          companies:                   makeChain({ meta_whatsapp_enabled: true }),
        },
      });
      const req = makeReq();

      await validateMetaCaller(req, svc, COMPANY_ID, { roles: META_VIEW_ROLES });

      const queriedTables = svc.from.mock.calls.map(([t]) => t);
      for (const table of queriedTables) {
        expect(ALLOWED_TABLES.has(table)).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Validações de contrato das matrizes exportadas
  // ─────────────────────────────────────────────────────────────────────────
  describe('Matrizes exportadas', () => {
    it('META_VIEW_ROLES inclui todos os roles esperados', () => {
      expect(META_VIEW_ROLES).toEqual(expect.arrayContaining([
        'super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller',
      ]));
    });

    it('META_CONNECT_ROLES exclui manager e seller', () => {
      expect(META_CONNECT_ROLES).not.toContain('manager');
      expect(META_CONNECT_ROLES).not.toContain('seller');
    });

    it('META_CONNECT_ROLES inclui partner (que exigirá assignment)', () => {
      expect(META_CONNECT_ROLES).toContain('partner');
    });

    it('nenhuma matriz usa comparação por tier — são arrays literais', () => {
      expect(Array.isArray(META_VIEW_ROLES)).toBe(true);
      expect(Array.isArray(META_CONNECT_ROLES)).toBe(true);
    });
  });
});
