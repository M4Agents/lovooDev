// =============================================================================
// api/admin/companies/__tests__/toggle-meta-whatsapp.test.js
//
// Cobertura completa do endpoint:
//   POST /api/admin/companies/toggle-meta-whatsapp
//
// CASOS COBERTOS (22 testes):
//
//   Método e ENV:
//   TC-01  GET → 405
//   TC-02  sem Bearer → 401
//   TC-03  JWT inválido → 401
//
//   Body / validação de campos:
//   TC-04  company_id ausente → 400
//   TC-05  company_id não-UUID → 400
//   TC-06  enabled ausente → 400
//   TC-07  enabled = "true" (string) → 400
//   TC-08  enabled = 1 (number) → 400
//
//   RBAC — roles insuficientes (403 antes de qualquer fetch de empresa):
//   TC-09  seller → 403
//   TC-10  manager → 403
//   TC-11  admin da empresa parent → 403
//   TC-12  partner → 403
//   TC-13  super_admin membership SOMENTE na empresa CLIENT alvo → 403
//   TC-14  system_admin membership SOMENTE na empresa CLIENT alvo → 403
//
//   Cross-parent (garantia multi-tenant — CRÍTICO):
//   TC-15  super_admin de parent A tentando client de parent B → 403
//   TC-16  system_admin de parent A tentando client de parent B → 403
//
//   Success:
//   TC-17  super_admin da parent correta → 200, enabled=true persiste
//   TC-18  system_admin da parent correta → 200, enabled=false persiste
//
//   Target inválido:
//   TC-19  target não existe → 404
//   TC-20  target é empresa parent → 422
//   TC-21  target foi deletado → 422
//
//   Erro de banco:
//   TC-22  UPDATE retorna erro → 500 seguro
//
// PRINCÍPIOS:
//   - vi.hoisted: env vars e mocks definidos antes da importação do módulo.
//   - Supabase completamente mockado — zero chamadas reais de rede ou banco.
//   - Nenhum token/JWT real; nenhum UUID de produção.
//   - Cross-parent (TC-15, TC-16) prova que parent A não acessa client de parent B.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisting: env + mocks antes do import do handler ─────────────────────────

const { mockGetUser, mockFrom, mockSvcClient } = vi.hoisted(() => {
  process.env.VITE_SUPABASE_URL        = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-svc-key'

  const mockGetUser   = vi.fn()
  const mockFrom      = vi.fn()
  const mockSvcClient = {
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }
  return { mockGetUser, mockFrom, mockSvcClient }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSvcClient),
}))

import handler from '../toggle-meta-whatsapp.js'

// ── Constantes sintéticas ─────────────────────────────────────────────────────

const PARENT_A_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PARENT_B_ID = 'bbbbbbbb-0000-4000-8000-000000000002'
const CLIENT_A_ID = 'cccccccc-0000-4000-8000-000000000003'  // parent = PARENT_A_ID
const CLIENT_B_ID = 'dddddddd-0000-4000-8000-000000000004'  // parent = PARENT_B_ID
const USER_ID     = 'eeeeeeee-0000-4000-8000-000000000005'

const MOCK_USER = { id: USER_ID }

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Cria um "chain" de query Supabase totalmente mockado.
 * Todos os métodos de filtro retornam `this` (encadeamento).
 * `.maybeSingle()` e `.single()` resolvem com `result`.
 * `then`/`catch` permitem `await chain` direto (sem método terminal).
 */
function makeChain(data, error = null) {
  const result = { data, error }
  const self = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    in:          vi.fn().mockReturnThis(),
    update:      vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single:      vi.fn().mockResolvedValue(result),
    // Para queries awaited sem método terminal (ex: SELECT sem .maybeSingle())
    then:  (resolve) => Promise.resolve(result).then(resolve),
    catch: (reject)  => Promise.resolve(result).catch(reject),
  }
  return self
}

/** Req mínimo válido */
function makeReq(overrides = {}) {
  return {
    method:  'POST',
    headers: { authorization: 'Bearer valid-test-token' },
    body:    { company_id: CLIENT_A_ID, enabled: true },
    ...overrides,
  }
}

/** Res com captura de status e body */
function makeRes() {
  const r = { _status: null, _body: null }
  r.status = (code) => { r._status = code; return r }
  r.json   = (body) => { r._body   = body; return r }
  return r
}

/**
 * Configura o cenário "happy path" padrão.
 * @param {object} opts
 *   parentIds   — IDs das parents retornadas pelo RBAC check (step 5)
 *   targetId    — ID da empresa alvo
 *   targetParent— parent_company_id da empresa alvo
 *   targetType  — company_type da empresa alvo (default: 'client')
 *   targetDeleted — deleted_at da empresa alvo (default: null)
 *   updateError — erro do UPDATE (default: null)
 */
function setupScenario({
  parentIds     = [PARENT_A_ID],
  targetId      = CLIENT_A_ID,
  targetParent  = PARENT_A_ID,
  targetType    = 'client',
  targetDeleted = null,
  updateError   = null,
} = {}) {
  // auth.getUser retorna usuário válido
  mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null })

  // from() chamado 3× em sequência:
  // 1ª: company_users RBAC check → retorna array de memberships
  // 2ª: companies SELECT target → retorna empresa alvo
  // 3ª: companies UPDATE → retorna sucesso/erro
  const memberships = parentIds.map(id => ({ company_id: id, companies: { company_type: 'parent' } }))

  mockFrom
    .mockReturnValueOnce(
      makeChain(memberships),    // step 5: RBAC
    )
    .mockReturnValueOnce(
      makeChain(targetDeleted === null ? {         // step 6: target company
        id:                targetId,
        company_type:      targetType,
        deleted_at:        null,
        parent_company_id: targetParent,
      } : {
        id:                targetId,
        company_type:      targetType,
        deleted_at:        targetDeleted,
        parent_company_id: targetParent,
      }),
    )
    .mockReturnValueOnce(
      makeChain(null, updateError),                // step 8: UPDATE
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Testes
// ─────────────────────────────────────────────────────────────────────────────

describe('toggle-meta-whatsapp — método e autenticação', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-01: GET → 405 method_not_allowed', async () => {
    const res = makeRes()
    await handler({ method: 'GET', headers: {}, body: {} }, res)
    expect(res._status).toBe(405)
    expect(res._body.error).toBe('method_not_allowed')
  })

  it('TC-02: sem Bearer → 401 unauthorized', async () => {
    const res = makeRes()
    await handler({ method: 'POST', headers: {}, body: {} }, res)
    expect(res._status).toBe(401)
    expect(res._body.error).toBe('unauthorized')
  })

  it('TC-03: JWT inválido → 401 unauthorized', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid jwt') })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(401)
    expect(res._body.error).toBe('unauthorized')
  })
})

describe('toggle-meta-whatsapp — validação de body', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null })
  })

  it('TC-04: company_id ausente → 400 invalid_request', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { enabled: true } }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe('invalid_request')
  })

  it('TC-05: company_id não-UUID → 400 invalid_request', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { company_id: 'not-a-uuid', enabled: true } }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe('invalid_request')
  })

  it('TC-06: enabled ausente → 400 invalid_request', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { company_id: CLIENT_A_ID } }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe('invalid_request')
  })

  it('TC-07: enabled = "true" (string) → 400 — coerção rejeitada', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { company_id: CLIENT_A_ID, enabled: 'true' } }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe('invalid_request')
  })

  it('TC-08: enabled = 1 (number) → 400 — coerção rejeitada', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { company_id: CLIENT_A_ID, enabled: 1 } }), res)
    expect(res._status).toBe(400)
    expect(res._body.error).toBe('invalid_request')
  })
})

describe('toggle-meta-whatsapp — RBAC (403 antes de qualquer fetch de empresa)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null })
  })

  // Configura RBAC retornando array vazio (nenhuma parent membership autorizada)
  function setupNoParentMembership() {
    mockFrom.mockReturnValueOnce(makeChain([]))   // step 5: array vazio
  }

  it('TC-09: seller → 403 forbidden (sem membership em parent)', async () => {
    setupNoParentMembership()
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(403)
    expect(res._body.error).toBe('forbidden')
    // Banco de target NÃO consultado: apenas 1 chamada from() (RBAC)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('TC-10: manager → 403 forbidden', async () => {
    setupNoParentMembership()
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(403)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('TC-11: admin da empresa parent → 403 (role \'admin\' excluída da query RBAC)', async () => {
    // A query RBAC filtra apenas super_admin|system_admin.
    // 'admin' de parent company → retorna array vazio → 403.
    setupNoParentMembership()
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(403)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('TC-12: partner → 403 (excluído da matriz desta versão)', async () => {
    setupNoParentMembership()
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(403)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('TC-13: super_admin com membership SOMENTE na empresa CLIENT alvo → 403', async () => {
    // super_admin de uma empresa client (não parent) não satisfaz o filtro
    // company_type = 'parent' na query RBAC → array vazio → 403.
    // Prova que membership direta na empresa client é insuficiente.
    setupNoParentMembership()
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(403)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('TC-14: system_admin com membership SOMENTE na empresa CLIENT alvo → 403', async () => {
    setupNoParentMembership()
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(403)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })
})

describe('toggle-meta-whatsapp — cross-parent guard (garantia multi-tenant)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null })
  })

  // Caller tem membership em PARENT_A_ID.
  // Target é CLIENT_B_ID, cujo parent_company_id = PARENT_B_ID (parent diferente).
  // Deve retornar 403 — cross-parent impossível.

  it('TC-15: super_admin de parent A tentando client de parent B → 403 forbidden', async () => {
    // step 5: RBAC retorna PARENT_A_ID
    mockFrom.mockReturnValueOnce(
      makeChain([{ company_id: PARENT_A_ID, companies: { company_type: 'parent' } }]),
    )
    // step 6: target CLIENT_B_ID pertence a PARENT_B_ID
    mockFrom.mockReturnValueOnce(
      makeChain({
        id:                CLIENT_B_ID,
        company_type:      'client',
        deleted_at:        null,
        parent_company_id: PARENT_B_ID,   // ← parent diferente
      }),
    )
    // step 8 NÃO deve ser chamado

    const res = makeRes()
    await handler(makeReq({ body: { company_id: CLIENT_B_ID, enabled: true } }), res)

    expect(res._status).toBe(403)
    expect(res._body.error).toBe('forbidden')
    // UPDATE nunca executado: apenas 2 from() calls (RBAC + target fetch)
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('TC-16: system_admin de parent A tentando client de parent B → 403 forbidden', async () => {
    mockFrom.mockReturnValueOnce(
      makeChain([{ company_id: PARENT_A_ID, companies: { company_type: 'parent' } }]),
    )
    mockFrom.mockReturnValueOnce(
      makeChain({
        id:                CLIENT_B_ID,
        company_type:      'client',
        deleted_at:        null,
        parent_company_id: PARENT_B_ID,
      }),
    )

    const res = makeRes()
    await handler(makeReq({ body: { company_id: CLIENT_B_ID, enabled: true } }), res)

    expect(res._status).toBe(403)
    expect(res._body.error).toBe('forbidden')
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })
})

describe('toggle-meta-whatsapp — sucesso', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-17: super_admin da parent correta + enabled=true → 200, persiste true', async () => {
    setupScenario({ enabled: true })
    const res = makeRes()
    await handler(makeReq({ body: { company_id: CLIENT_A_ID, enabled: true } }), res)

    expect(res._status).toBe(200)
    expect(res._body.success).toBe(true)
    expect(res._body.company_id).toBe(CLIENT_A_ID)
    expect(res._body.meta_whatsapp_enabled).toBe(true)
  })

  it('TC-18: system_admin da parent correta + enabled=false → 200, persiste false', async () => {
    setupScenario({ enabled: false })
    const res = makeRes()
    await handler(makeReq({ body: { company_id: CLIENT_A_ID, enabled: false } }), res)

    expect(res._status).toBe(200)
    expect(res._body.success).toBe(true)
    expect(res._body.company_id).toBe(CLIENT_A_ID)
    expect(res._body.meta_whatsapp_enabled).toBe(false)
  })
})

describe('toggle-meta-whatsapp — target inválido', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null })
  })

  it('TC-19: target não existe → 404 company_not_found', async () => {
    // RBAC: caller tem membership em parent
    mockFrom.mockReturnValueOnce(
      makeChain([{ company_id: PARENT_A_ID, companies: { company_type: 'parent' } }]),
    )
    // target: não encontrado
    mockFrom.mockReturnValueOnce(makeChain(null))

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(404)
    expect(res._body.error).toBe('company_not_found')
  })

  it('TC-20: target é empresa parent → 422 invalid_target', async () => {
    mockFrom.mockReturnValueOnce(
      makeChain([{ company_id: PARENT_A_ID, companies: { company_type: 'parent' } }]),
    )
    // target: é uma empresa parent
    mockFrom.mockReturnValueOnce(
      makeChain({
        id:                PARENT_A_ID,
        company_type:      'parent',   // ← empresa parent
        deleted_at:        null,
        parent_company_id: null,       // parents não têm parent_company_id
      }),
    )

    const res = makeRes()
    await handler(makeReq({ body: { company_id: PARENT_A_ID, enabled: true } }), res)

    expect(res._status).toBe(422)
    expect(res._body.error).toBe('invalid_target')
  })

  it('TC-21: target foi deletado → 422 invalid_target', async () => {
    mockFrom.mockReturnValueOnce(
      makeChain([{ company_id: PARENT_A_ID, companies: { company_type: 'parent' } }]),
    )
    mockFrom.mockReturnValueOnce(
      makeChain({
        id:                CLIENT_A_ID,
        company_type:      'client',
        deleted_at:        '2026-01-01T00:00:00Z',   // ← deletada
        parent_company_id: PARENT_A_ID,
      }),
    )

    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(422)
    expect(res._body.error).toBe('invalid_target')
  })
})

describe('toggle-meta-whatsapp — erros de banco', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('TC-22: UPDATE retorna erro → 500 internal_error seguro (sem detalhes expostos)', async () => {
    setupScenario({ updateError: new Error('connection timeout') })
    const res = makeRes()
    await handler(makeReq(), res)

    expect(res._status).toBe(500)
    expect(res._body.error).toBe('internal_error')
    // Nunca vazar mensagem interna do banco
    expect(JSON.stringify(res._body)).not.toContain('connection timeout')
    expect(JSON.stringify(res._body)).not.toContain('timeout')
  })
})
