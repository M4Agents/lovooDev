import { describe, expect, it, vi } from 'vitest'
import { AUTHORIZATION_UNAVAILABLE } from '../../../auth/validateCompanyCaller.js'
import { authorizeChatUpload } from '../authorization.js'
import { CHAT_AUTOMATION_ROLES, CHAT_CONVERSATION_ROLES } from '../constants.js'

const USER_ID = 'aaaa0000-0000-4000-8000-000000000001'
const OTHER_ID = 'ffff0000-0000-4000-8000-000000000006'
const COMPANY_ID = 'bbbb0000-0000-4000-8000-000000000002'
const PARENT_ID = 'cccc0000-0000-4000-8000-000000000003'
const CONVERSATION_ID = 'dddd0000-0000-4000-8000-000000000004'
const INSTANCE_ID = 'eeee0000-0000-4000-8000-000000000005'
const FLOW_ID = '11111111-1111-4111-8111-111111111111'
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_INSTANCE_ID = '99999999-9999-4999-8999-999999999999'

function makeChain(data, error = null) {
  const state = {}
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn((column, values) => {
      state.in = { column, values }
      return chain
    }),
    maybeSingle: vi.fn(async () => {
      if (state.in && data && !state.in.values.includes(data.role)) {
        return { data: null, error }
      }
      return { data, error }
    }),
  }
  return chain
}

function makeSvc({ tables = {}, tableSeq = {} } = {}) {
  const counters = {}
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: vi.fn((table) => {
      if (tableSeq[table]) {
        counters[table] = counters[table] ?? 0
        const chain = tableSeq[table][counters[table]] ?? tables[table] ?? makeChain(null)
        counters[table] += 1
        return chain
      }
      return tables[table] ?? makeChain(null)
    }),
  }
}

function req(body = {}) {
  return { headers: { authorization: 'Bearer session-token' }, body }
}

function manual(overrides = {}) {
  return {
    companyId: COMPANY_ID,
    purpose: 'chat_manual',
    conversationId: CONVERSATION_ID,
    instanceId: null,
    flowId: null,
    messageType: 'image',
    ...overrides,
  }
}

function conversation(overrides = {}) {
  return {
    id: CONVERSATION_ID,
    company_id: COMPANY_ID,
    instance_id: INSTANCE_ID,
    last_instance_id: null,
    assigned_to: null,
    ...overrides,
  }
}

function instance(overrides = {}) {
  return {
    id: INSTANCE_ID,
    company_id: COMPANY_ID,
    deleted_at: null,
    assigned_user_id: null,
    available_to_all: false,
    ...overrides,
  }
}

function directSvc(role, { flag = false, conv = conversation(), inst = instance(), assignment = null, flow = null } = {}) {
  return makeSvc({
    tables: {
      company_users: makeChain({ role }),
      companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: flag }),
      chat_conversations: makeChain(conv),
      whatsapp_life_instances: makeChain(inst),
      partner_company_assignments: makeChain(assignment),
      automation_flows: makeChain(flow),
    },
  })
}

const NOT_FOUND = { ok: false, status: 404, error: 'Recurso não encontrado' }

describe('autorização do upload do chat', () => {
  it('aplica a matriz explícita e nega seller e partner na automação', async () => {
    expect(CHAT_CONVERSATION_ROLES).toEqual([
      'super_admin', 'system_admin', 'admin', 'manager', 'seller', 'partner',
    ])
    expect(CHAT_AUTOMATION_ROLES).toEqual(['super_admin', 'system_admin', 'admin', 'manager'])
    for (const role of ['super_admin', 'system_admin', 'admin', 'manager', 'seller']) {
      const result = await authorizeChatUpload(req(), directSvc(role), manual())
      expect(result).toMatchObject({ ok: true, userId: USER_ID, role, accessPath: 'direct' })
    }
    for (const role of CHAT_AUTOMATION_ROLES) {
      const result = await authorizeChatUpload(req(), directSvc(role, {
        flow: { id: FLOW_ID, company_id: COMPANY_ID },
      }), manual({
        purpose: 'automation_audio',
        conversationId: null,
        flowId: FLOW_ID,
        messageType: 'audio',
      }))
      expect(result.ok).toBe(true)
    }
    for (const role of ['seller', 'partner']) {
      const svc = directSvc(role, { assignment: { id: ASSIGNMENT_ID } })
      const result = await authorizeChatUpload(req(), svc, manual({
        purpose: 'automation_audio',
        conversationId: null,
        flowId: FLOW_ID,
        messageType: 'audio',
      }))
      expect(result).toEqual({
        ok: false,
        status: 403,
        error: 'Permissão insuficiente para esta operação',
      })
      expect(svc.from).not.toHaveBeenCalledWith('automation_flows')
    }
  })

  it('nega membership inativa, partner sem atribuição e identidade substituída', async () => {
    const users = makeChain(null)
    const inactive = makeSvc({
      tables: {
        company_users: users,
        companies: makeChain(null),
      },
    })
    expect(await authorizeChatUpload(req({ impersonating: true, userId: OTHER_ID }), inactive, manual()))
      .toEqual({ ok: false, status: 403, error: 'Acesso negado a esta empresa' })
    expect(users.eq).toHaveBeenCalledWith('is_active', true)
    expect(inactive.from).not.toHaveBeenCalledWith('chat_conversations')

    const partner = directSvc('partner', { assignment: null })
    expect(await authorizeChatUpload(req(), partner, manual())).toEqual({
      ok: false,
      status: 403,
      error: 'Partner sem assignment ativo para esta empresa',
    })
    expect(partner.from).not.toHaveBeenCalledWith('chat_conversations')

    const allowed = await authorizeChatUpload(
      req({ impersonating: true, userId: OTHER_ID }),
      directSvc('partner', { assignment: { id: ASSIGNMENT_ID } }),
      manual(),
    )
    expect(allowed).toMatchObject({ ok: true, userId: USER_ID, accessPath: 'partner' })
    expect(allowed.userId).not.toBe(OTHER_ID)
  })

  it('aceita super_admin da empresa pai e partner herdado com assignment', async () => {
    const parent = makeSvc({
      tableSeq: {
        company_users: [
          makeChain(null),
          makeChain(null),
          makeChain({
            role: 'super_admin',
            company_id: PARENT_ID,
            companies: { company_type: 'parent' },
          }),
        ],
        companies: [
          makeChain({ parent_company_id: PARENT_ID }),
          makeChain({ id: COMPANY_ID }),
          makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: true }),
        ],
      },
      tables: {
        chat_conversations: makeChain(conversation({ assigned_to: null })),
        whatsapp_life_instances: makeChain(instance()),
      },
    })
    expect(await authorizeChatUpload(req(), parent, manual())).toMatchObject({
      ok: true,
      role: 'super_admin',
      accessPath: 'parent',
    })

    const inherited = makeSvc({
      tableSeq: {
        company_users: [
          makeChain(null),
          makeChain({
            role: 'partner',
            company_id: PARENT_ID,
            companies: { company_type: 'parent' },
          }),
        ],
        companies: [makeChain({ parent_company_id: PARENT_ID })],
      },
      tables: {
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
        partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }),
        chat_conversations: makeChain(conversation()),
        whatsapp_life_instances: makeChain(instance()),
      },
    })
    expect(await authorizeChatUpload(req(), inherited, manual())).toMatchObject({
      ok: true,
      role: 'partner',
      accessPath: 'partner',
    })
  })

  it('consulta a flag atual e distingue seller restrito, conversa sem responsável e transferência', async () => {
    const open = await authorizeChatUpload(
      req(),
      directSvc('seller', { flag: false, conv: conversation({ assigned_to: null }) }),
      manual(),
    )
    expect(open.ok).toBe(true)

    const unassigned = await authorizeChatUpload(
      req(),
      directSvc('seller', { flag: true, conv: conversation({ assigned_to: null }) }),
      manual(),
    )
    const foreign = await authorizeChatUpload(
      req(),
      directSvc('seller', { flag: true, conv: conversation({ assigned_to: OTHER_ID }) }),
      manual(),
    )
    const owned = await authorizeChatUpload(
      req(),
      directSvc('seller', { flag: true, conv: conversation({ assigned_to: USER_ID }) }),
      manual(),
    )
    expect(unassigned).toEqual(NOT_FOUND)
    expect(foreign).toEqual(NOT_FOUND)
    expect(owned.ok).toBe(true)
    expect(unassigned).toEqual(foreign)

    const manager = await authorizeChatUpload(
      req(),
      directSvc('manager', { flag: true, conv: conversation({ assigned_to: null }) }),
      manual(),
    )
    expect(manager.ok).toBe(true)
  })

  it('nega conversa, instância e fluxo fora da empresa com o mesmo erro opaco', async () => {
    const conversationChain = makeChain(null)
    const missingConversation = makeSvc({
      tables: {
        company_users: makeChain({ role: 'admin' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
        chat_conversations: conversationChain,
      },
    })
    const crossInstance = directSvc('admin', { inst: null })
    const deleted = directSvc('admin', { inst: instance({ deleted_at: '2026-01-01T00:00:00.000Z' }) })
    const noInstance = directSvc('admin', {
      conv: conversation({ instance_id: null, last_instance_id: null }),
    })
    expect(await authorizeChatUpload(req(), missingConversation, manual())).toEqual(NOT_FOUND)
    expect(conversationChain.eq).toHaveBeenCalledWith('id', CONVERSATION_ID)
    expect(conversationChain.eq).toHaveBeenCalledWith('company_id', COMPANY_ID)
    for (const svc of [crossInstance, deleted, noInstance]) {
      expect(await authorizeChatUpload(req(), svc, manual())).toEqual(NOT_FOUND)
    }
    expect(JSON.stringify(NOT_FOUND)).not.toContain(CONVERSATION_ID)
    expect(JSON.stringify(NOT_FOUND)).not.toContain(INSTANCE_ID)
    expect(JSON.stringify(NOT_FOUND)).not.toContain(FLOW_ID)

    const schedule = manual({ purpose: 'chat_schedule', instanceId: INSTANCE_ID })
    const blocked = await authorizeChatUpload(req(), directSvc('seller', {
      flag: true,
      conv: conversation({ assigned_to: USER_ID }),
      inst: instance({ assigned_user_id: OTHER_ID, available_to_all: false }),
    }), schedule)
    const shared = await authorizeChatUpload(req(), directSvc('seller', {
      flag: true,
      conv: conversation({ assigned_to: USER_ID }),
      inst: instance({ assigned_user_id: OTHER_ID, available_to_all: true }),
    }), schedule)
    expect(blocked).toEqual(NOT_FOUND)
    expect(shared.ok).toBe(true)

    const flow = directSvc('manager', { flow: null })
    expect(await authorizeChatUpload(req(), flow, manual({
      purpose: 'automation_audio',
      conversationId: null,
      flowId: FLOW_ID,
      messageType: 'audio',
    }))).toEqual(NOT_FOUND)
  })

  it('rejeita finalidade adulterada, áudio de automação incorreto e falha de consulta', async () => {
    expect(await authorizeChatUpload(req(), directSvc('admin'), manual({ purpose: 'catalog' })))
      .toEqual({ ok: false, status: 400, error: 'Pedido inválido' })
    expect(await authorizeChatUpload(req(), directSvc('admin'), manual({ flowId: FLOW_ID })))
      .toEqual({ ok: false, status: 400, error: 'Pedido inválido' })

    const wrongType = await authorizeChatUpload(req(), directSvc('manager', {
      flow: { id: FLOW_ID, company_id: COMPANY_ID },
    }), manual({
      purpose: 'automation_audio',
      conversationId: null,
      flowId: FLOW_ID,
      messageType: 'image',
    }))
    expect(wrongType).toEqual({ ok: false, status: 415, error: 'Tipo de arquivo não permitido' })

    const broken = directSvc('admin')
    broken.from.mockImplementation((table) => {
      if (table === 'chat_conversations') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockRejectedValue(new Error('timeout')),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === 'company_users' ? { role: 'admin' } : null,
          error: null,
        }),
      }
    })
    expect(await authorizeChatUpload(req(), broken, manual())).toEqual({
      ok: false,
      status: 503,
      error: AUTHORIZATION_UNAVAILABLE,
    })
    expect(JSON.stringify(await authorizeChatUpload(req(), broken, manual()))).not.toContain('timeout')

    const queryError = directSvc('admin')
    queryError.from.mockImplementation((table) => makeChain(
      table === 'company_users' ? { role: 'admin' } : null,
      table === 'chat_conversations' ? { message: 'db down token secret' } : null,
    ))
    const failed = await authorizeChatUpload(req(), queryError, manual())
    expect(failed).toEqual({ ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE })
    expect(JSON.stringify(failed)).not.toContain('db down')
    expect(JSON.stringify(failed)).not.toContain('secret')
  })

  it('aceita system_admin da pai e nega admin da pai e partner na automação', async () => {
    for (const role of ['super_admin', 'system_admin']) {
      const chat = parentCaller(role, 'chat')
      expect(await authorizeChatUpload(req(), chat, manual())).toMatchObject({
        ok: true,
        role,
        accessPath: 'parent',
      })
      const automation = parentCaller(role, 'automation')
      expect(await authorizeChatUpload(req(), automation, automationRequest())).toMatchObject({
        ok: true,
        role,
        accessPath: 'parent',
      })
    }

    const parentAdmin = parentCaller('admin', 'chat')
    expect(await authorizeChatUpload(req(), parentAdmin, manual())).toEqual({
      ok: false,
      status: 403,
      error: 'Acesso negado a esta empresa',
    })
    expect(parentAdmin.from).not.toHaveBeenCalledWith('chat_conversations')

    const inheritedPartner = makeSvc({
      tableSeq: {
        company_users: [
          makeChain(null),
          makeChain({
            role: 'partner',
            company_id: PARENT_ID,
            companies: { company_type: 'parent' },
          }),
        ],
        companies: [makeChain({ parent_company_id: PARENT_ID })],
      },
      tables: {
        partner_company_assignments: makeChain({ id: ASSIGNMENT_ID }),
        automation_flows: makeChain({ id: FLOW_ID, company_id: COMPANY_ID }),
      },
    })
    expect(await authorizeChatUpload(req(), inheritedPartner, automationRequest())).toEqual({
      ok: false,
      status: 403,
      error: 'Acesso negado a esta empresa',
    })
    expect(inheritedPartner.from).not.toHaveBeenCalledWith('automation_flows')
    expect(inheritedPartner.from).not.toHaveBeenCalledWith('partner_company_assignments')
  })

  it('reaplica a flag, a instância selecionada e a instância vinculada a cada consulta', async () => {
    const schedule = manual({ purpose: 'chat_schedule', instanceId: INSTANCE_ID })
    const unrestricted = await authorizeChatUpload(req(), directSvc('admin', {
      flag: true,
      conv: conversation({ assigned_to: null }),
      inst: instance({ assigned_user_id: OTHER_ID, available_to_all: false }),
    }), schedule)
    const sellerOpen = await authorizeChatUpload(req(), directSvc('seller', {
      flag: false,
      conv: conversation({ assigned_to: null }),
      inst: instance({ assigned_user_id: OTHER_ID, available_to_all: false }),
    }), schedule)
    const ownInstance = await authorizeChatUpload(req(), directSvc('seller', {
      flag: true,
      conv: conversation({ assigned_to: USER_ID }),
      inst: instance({ assigned_user_id: USER_ID, available_to_all: false }),
    }), schedule)
    expect(unrestricted.ok).toBe(true)
    expect(sellerOpen.ok).toBe(true)
    expect(ownInstance.ok).toBe(true)

    const selected = makeChain(null)
    const foreignInstance = makeSvc({
      tables: {
        company_users: makeChain({ role: 'manager' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
        chat_conversations: makeChain(conversation({ assigned_to: USER_ID })),
        whatsapp_life_instances: selected,
      },
    })
    expect(await authorizeChatUpload(req(), foreignInstance, schedule)).toEqual(NOT_FOUND)
    expect(selected.eq).toHaveBeenCalledWith('id', INSTANCE_ID)
    expect(selected.eq).toHaveBeenCalledWith('company_id', COMPANY_ID)

    const manualInstance = makeChain(instance({ assigned_user_id: OTHER_ID, available_to_all: false }))
    const linked = makeSvc({
      tables: {
        company_users: makeChain({ role: 'seller' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: true }),
        chat_conversations: makeChain(conversation({
          assigned_to: USER_ID,
          instance_id: null,
          last_instance_id: INSTANCE_ID,
        })),
        whatsapp_life_instances: manualInstance,
      },
    })
    expect(await authorizeChatUpload(req(), linked, manual())).toMatchObject({ ok: true, role: 'seller' })
    expect(manualInstance.eq).toHaveBeenCalledWith('id', INSTANCE_ID)
    expect(manualInstance.eq).toHaveBeenCalledWith('company_id', COMPANY_ID)

    let assignee = USER_ID
    const liveConversation = {
      select: vi.fn(() => liveConversation),
      eq: vi.fn(() => liveConversation),
      in: vi.fn(() => liveConversation),
      maybeSingle: vi.fn(async () => ({
        data: conversation({ assigned_to: assignee }),
        error: null,
      })),
    }
    const transferred = makeSvc({
      tables: {
        company_users: makeChain({ role: 'seller' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: true }),
        chat_conversations: liveConversation,
        whatsapp_life_instances: makeChain(instance()),
      },
    })
    expect((await authorizeChatUpload(req(), transferred, manual())).ok).toBe(true)
    assignee = OTHER_ID
    expect(await authorizeChatUpload(req(), transferred, manual())).toEqual(NOT_FOUND)
  })

  it('nega credencial ausente, sessão inválida, identificadores misturados e fluxo de outra empresa', async () => {
    const anonymous = directSvc('admin')
    expect(await authorizeChatUpload({ headers: {} }, anonymous, manual())).toEqual({
      ok: false,
      status: 401,
      error: 'Autenticação necessária',
    })
    expect(anonymous.auth.getUser).not.toHaveBeenCalled()

    const expired = directSvc('admin')
    expired.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'jwt' } })
    expect(await authorizeChatUpload(req(), expired, manual())).toEqual({
      ok: false,
      status: 401,
      error: 'Sessão inválida ou expirada',
    })
    expect(expired.from).not.toHaveBeenCalled()

    const structural = directSvc('admin')
    expect(await authorizeChatUpload(req(), structural, manual({
      purpose: 'chat_schedule',
      instanceId: null,
    }))).toEqual({ ok: false, status: 400, error: 'Pedido inválido' })
    expect(await authorizeChatUpload(req(), structural, manual({
      purpose: 'automation_audio',
      conversationId: CONVERSATION_ID,
      flowId: FLOW_ID,
      messageType: 'audio',
    }))).toEqual({ ok: false, status: 400, error: 'Pedido inválido' })
    expect(structural.auth.getUser).not.toHaveBeenCalled()

    const foreignFlow = await authorizeChatUpload(req(), directSvc('admin', {
      flow: { id: FLOW_ID, company_id: OTHER_ID },
    }), automationRequest())
    expect(foreignFlow).toEqual(NOT_FOUND)
  })

  it('nega flag ausente ou inválida do seller e preserva empresa ausente', async () => {
    const assigned = conversation({ assigned_to: USER_ID })
    const cases = [
      { id: COMPANY_ID, chat_visibility_by_assigned_to: null },
      { id: COMPANY_ID },
      { id: COMPANY_ID, chat_visibility_by_assigned_to: 'false' },
      { id: COMPANY_ID, chat_visibility_by_assigned_to: 1 },
    ]
    for (const companyData of cases) {
      const svc = sellerCompanySvc(companyData, assigned)
      const result = await authorizeChatUpload(req(), svc, manual())
      expect(result).toEqual({ ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE })
      expect(svc.from).not.toHaveBeenCalledWith('whatsapp_life_instances')
      expect(result.error).not.toContain(String(companyData.chat_visibility_by_assigned_to))
    }

    const unassigned = sellerCompanySvc(
      { id: COMPANY_ID, chat_visibility_by_assigned_to: null },
      conversation({ assigned_to: null }),
    )
    expect(await authorizeChatUpload(req(), unassigned, manual())).toEqual({
      ok: false,
      status: 503,
      error: AUTHORIZATION_UNAVAILABLE,
    })

    const missingCompany = sellerCompanySvc(null, assigned)
    expect(await authorizeChatUpload(req(), missingCompany, manual())).toEqual(NOT_FOUND)
    expect(missingCompany.from).not.toHaveBeenCalledWith('whatsapp_life_instances')

    const foreignCompany = sellerCompanySvc(
      { id: OTHER_ID, chat_visibility_by_assigned_to: false },
      assigned,
    )
    expect(await authorizeChatUpload(req(), foreignCompany, manual())).toEqual(NOT_FOUND)
    expect(foreignCompany.from).not.toHaveBeenCalledWith('whatsapp_life_instances')
  })

  it('nega erro e exceção na consulta da flag sem abrir acesso', async () => {
    const errored = sellerCompanySvc(
      { id: COMPANY_ID, chat_visibility_by_assigned_to: false },
      conversation({ assigned_to: null }),
    )
    errored.from.mockImplementation((table) => {
      if (table === 'companies') {
        return makeChain(
          { id: COMPANY_ID, chat_visibility_by_assigned_to: false },
          { message: 'flag secret' },
        )
      }
      return erroredTable(table)
    })
    const failed = await authorizeChatUpload(req(), errored, manual())
    expect(failed).toEqual({ ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE })
    expect(JSON.stringify(failed)).not.toContain('flag secret')
    expect(errored.from).not.toHaveBeenCalledWith('whatsapp_life_instances')

    const exploded = sellerCompanySvc(
      { id: COMPANY_ID, chat_visibility_by_assigned_to: false },
      conversation({ assigned_to: null }),
    )
    exploded.from.mockImplementation((table) => {
      if (table === 'companies') {
        const chain = makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false })
        chain.maybeSingle.mockRejectedValue(new Error('flag exploded'))
        return chain
      }
      return erroredTable(table)
    })
    const thrown = await authorizeChatUpload(req(), exploded, manual())
    expect(thrown).toEqual({ ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE })
    expect(JSON.stringify(thrown)).not.toContain('exploded')
  })

  it('não consulta last_instance_id quando a instância principal está presente', async () => {
    const blankPrimary = makeSvc({
      tables: {
        company_users: makeChain({ role: 'admin' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
        chat_conversations: makeChain(conversation({
          instance_id: '',
          last_instance_id: OTHER_INSTANCE_ID,
        })),
        whatsapp_life_instances: instanceById(() => ({
          data: instance({ id: OTHER_INSTANCE_ID }),
          error: null,
        })),
      },
    })
    expect(await authorizeChatUpload(req(), blankPrimary, manual())).toEqual(NOT_FOUND)
    expect(blankPrimary.from).not.toHaveBeenCalledWith('whatsapp_life_instances')

    const instances = instanceById((id) => {
      if (id === OTHER_INSTANCE_ID) {
        return { data: instance({ id: OTHER_INSTANCE_ID }), error: null }
      }
      return { data: null, error: null }
    })
    const missingPrimary = makeSvc({
      tables: {
        company_users: makeChain({ role: 'admin' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
        chat_conversations: makeChain(conversation({
          instance_id: INSTANCE_ID,
          last_instance_id: OTHER_INSTANCE_ID,
        })),
        whatsapp_life_instances: instances,
      },
    })
    expect(await authorizeChatUpload(req(), missingPrimary, manual())).toEqual(NOT_FOUND)
    expect(instances.eq).toHaveBeenCalledWith('id', INSTANCE_ID)
    expect(instances.eq).not.toHaveBeenCalledWith('id', OTHER_INSTANCE_ID)
  })

  it('nega company_id divergente e falha de consulta de instância e fluxo', async () => {
    const foreignConversation = makeSvc({
      tables: {
        company_users: makeChain({ role: 'admin' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
        chat_conversations: makeChain(conversation({
          company_id: OTHER_ID,
          last_instance_id: OTHER_INSTANCE_ID,
        })),
        whatsapp_life_instances: instanceById(() => ({
          data: instance({ id: OTHER_INSTANCE_ID }),
          error: null,
        })),
      },
    })
    expect(await authorizeChatUpload(req(), foreignConversation, manual())).toEqual(NOT_FOUND)
    expect(foreignConversation.from).not.toHaveBeenCalledWith('companies')
    expect(foreignConversation.from).not.toHaveBeenCalledWith('whatsapp_life_instances')

    const foreignInstance = instanceById((id) => {
      if (id === OTHER_INSTANCE_ID) {
        return { data: instance({ id: OTHER_INSTANCE_ID, company_id: COMPANY_ID }), error: null }
      }
      return { data: instance({ id: INSTANCE_ID, company_id: OTHER_ID }), error: null }
    })
    const divergentInstance = makeSvc({
      tables: {
        company_users: makeChain({ role: 'manager' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
        chat_conversations: makeChain(conversation({
          instance_id: INSTANCE_ID,
          last_instance_id: OTHER_INSTANCE_ID,
        })),
        whatsapp_life_instances: foreignInstance,
      },
    })
    expect(await authorizeChatUpload(req(), divergentInstance, manual())).toEqual(NOT_FOUND)
    expect(foreignInstance.eq).toHaveBeenCalledWith('id', INSTANCE_ID)
    expect(foreignInstance.eq).not.toHaveBeenCalledWith('id', OTHER_INSTANCE_ID)

    let instanceCalls = 0
    const brokenInstance = instanceById((id) => {
      instanceCalls += 1
      if (id === OTHER_INSTANCE_ID) {
        return { data: instance({ id: OTHER_INSTANCE_ID }), error: null }
      }
      return { data: null, error: { message: 'instance secret token' } }
    })
    const instanceFailure = makeSvc({
      tables: {
        company_users: makeChain({ role: 'admin' }),
        companies: makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: false }),
        chat_conversations: makeChain(conversation({
          instance_id: INSTANCE_ID,
          last_instance_id: OTHER_INSTANCE_ID,
        })),
        whatsapp_life_instances: brokenInstance,
      },
    })
    const instanceResult = await authorizeChatUpload(req(), instanceFailure, manual())
    expect(instanceResult).toEqual({ ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE })
    expect(instanceCalls).toBe(1)
    expect(JSON.stringify(instanceResult)).not.toContain('instance secret')
    expect(JSON.stringify(instanceResult)).not.toContain('token')

    const flowError = makeSvc({
      tables: {
        company_users: makeChain({ role: 'manager' }),
        automation_flows: makeChain(
          { id: FLOW_ID, company_id: COMPANY_ID },
          { message: 'flow secret' },
        ),
      },
    })
    const flowFailed = await authorizeChatUpload(req(), flowError, automationRequest())
    expect(flowFailed).toEqual({ ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE })
    expect(JSON.stringify(flowFailed)).not.toContain('flow secret')

    const flowThrow = makeChain({ id: FLOW_ID, company_id: COMPANY_ID })
    flowThrow.maybeSingle.mockRejectedValue(new Error('flow exploded'))
    const flowExploded = makeSvc({
      tables: {
        company_users: makeChain({ role: 'admin' }),
        automation_flows: flowThrow,
      },
    })
    const flowThrown = await authorizeChatUpload(req(), flowExploded, automationRequest())
    expect(flowThrown).toEqual({ ok: false, status: 503, error: AUTHORIZATION_UNAVAILABLE })
    expect(JSON.stringify(flowThrown)).not.toContain('exploded')
  })
})

function sellerCompanySvc(companyData, conv) {
  return makeSvc({
    tables: {
      company_users: makeChain({ role: 'seller' }),
      companies: makeChain(companyData),
      chat_conversations: makeChain(conv),
      whatsapp_life_instances: makeChain(instance()),
    },
  })
}

function erroredTable(table) {
  if (table === 'company_users') return makeChain({ role: 'seller' })
  if (table === 'chat_conversations') {
    return makeChain(conversation({ assigned_to: null }))
  }
  return makeChain(instance())
}

function instanceById(handler) {
  let requestedId = null
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((column, value) => {
      if (column === 'id') requestedId = value
      return chain
    }),
    in: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => handler(requestedId)),
  }
  return chain
}

function automationRequest() {
  return manual({
    purpose: 'automation_audio',
    conversationId: null,
    flowId: FLOW_ID,
    messageType: 'audio',
  })
}

function parentCaller(role, purpose) {
  const companyUsers = [makeChain(null)]
  if (purpose !== 'automation') companyUsers.push(makeChain(null))
  companyUsers.push(makeChain({
    role,
    company_id: PARENT_ID,
    companies: { company_type: 'parent' },
  }))
  const companies = [
    makeChain({ parent_company_id: PARENT_ID }),
    makeChain({ id: COMPANY_ID }),
  ]
  if (purpose !== 'automation') {
    companies.push(makeChain({ id: COMPANY_ID, chat_visibility_by_assigned_to: true }))
  }
  return makeSvc({
    tableSeq: { company_users: companyUsers, companies },
    tables: {
      chat_conversations: makeChain(conversation({ assigned_to: null })),
      whatsapp_life_instances: makeChain(instance()),
      automation_flows: makeChain({ id: FLOW_ID, company_id: COMPANY_ID }),
    },
  })
}
