import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brMobilePhoneLookupValues } from '../../lib/phone/canonicalizeBrMobile'
import { supabase } from '../../lib/supabase'
import { api } from '../api'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}))

const COMPANY = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const TAG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const START = '2026-10-16T03:00:00.000Z'
const END = '2026-11-16T02:59:59.000Z'

type QueryResult = { data: unknown; error: unknown; count?: number | null }
type Step = { method: string; args: unknown[] }

function variantsOf(value: string) {
  return brMobilePhoneLookupValues(value).filter((item) => /^\d{10,}$/.test(item))
}

function queryBuilder(result: QueryResult) {
  const steps: Step[] = []
  const builder = {
    then(
      onFulfilled?: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }
  const chain = (method: string) => (...args: unknown[]) => {
    steps.push({ method, args })
    return builder
  }
  return {
    steps,
    builder: Object.assign(builder, {
      select: chain('select'),
      eq: chain('eq'),
      is: chain('is'),
      in: chain('in'),
      gte: chain('gte'),
      lte: chain('lte'),
      ilike: chain('ilike'),
      or: chain('or'),
      order: chain('order'),
      limit: chain('limit'),
      range: chain('range'),
    }),
  }
}

const queries: { table: string; steps: Step[] }[] = []
const queue: QueryResult[] = []

function enqueue(result: QueryResult) {
  queue.push(result)
}

function lead(id: number, overPlan = false) {
  return {
    id,
    name: `Lead ${id}`,
    phone: '5511999998888',
    email: 'lead@example.com',
    company_cnpj: '000',
    company_phone: '1133334444',
    company_email: 'empresa@example.com',
    is_over_plan: overPlan,
    lead_custom_values: [{
      field_id: 'field-1',
      value: 'valor',
      lead_custom_fields: { field_name: 'origem_extra', field_label: 'Origem', field_type: 'text' },
    }],
    lead_tag_assignments: [{
      tag_id: TAG_A,
      lead_tags: {
        id: TAG_A,
        name: 'Quente',
        color: '#f00',
        description: null,
        is_active: true,
        created_at: START,
        updated_at: END,
      },
    }],
  }
}

function argsOf(steps: Step[], method: string) {
  return steps.filter((step) => step.method === method).map((step) => step.args)
}

function tables() {
  return queries.map((query) => query.table)
}

beforeEach(() => {
  queries.length = 0
  queue.length = 0
  vi.mocked(supabase.rpc).mockReset()
  vi.mocked(supabase.from).mockReset()
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const result = queue.shift() ?? { data: [], error: null, count: 0 }
    const built = queryBuilder(result)
    queries.push({ table, steps: built.steps })
    return built.builder as never
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('getLeads sem tags', () => {
  it('preserva a consulta anterior e não chama a RPC', async () => {
    enqueue({ data: [lead(2), lead(1)], error: null })
    enqueue({ data: null, error: null, count: 2 })

    const result = await api.getLeads(COMPANY, {
      status: 'novo',
      origin: 'whatsapp',
      search: '11988887777',
      name: 'Maria',
      phone: '21977776666',
      email: 'maria@example.com',
      responsible_user_id: 'unassigned',
      dateRange: { start: START, end: END },
      limit: 100,
    })

    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(tables()).toEqual(['leads', 'leads'])
    const dataSteps = queries[0].steps
    const countSteps = queries[1].steps
    expect(String(argsOf(dataSteps, 'select')[0][0])).toContain('lead_custom_fields')
    expect(String(argsOf(dataSteps, 'select')[0][0])).toContain('lead_tags')
    expect(argsOf(dataSteps, 'eq')).toContainEqual(['company_id', COMPANY])
    expect(argsOf(dataSteps, 'is')).toContainEqual(['deleted_at', null])
    expect(argsOf(dataSteps, 'order')).toContainEqual(['created_at', { ascending: false }])
    expect(argsOf(dataSteps, 'eq')).toContainEqual(['status', 'novo'])
    expect(argsOf(dataSteps, 'eq')).toContainEqual(['origin', 'whatsapp'])
    expect(argsOf(dataSteps, 'ilike')).toContainEqual(['name', '%Maria%'])
    expect(argsOf(dataSteps, 'ilike')).toContainEqual(['email', '%maria@example.com%'])
    expect(argsOf(dataSteps, 'is')).toContainEqual(['responsible_user_id', null])
    expect(argsOf(dataSteps, 'gte')).toContainEqual(['created_at', START])
    expect(argsOf(dataSteps, 'lte')).toContainEqual(['created_at', END])
    expect(argsOf(dataSteps, 'limit')).toContainEqual([100])
    const search = String(argsOf(dataSteps, 'or')[0][0])
    const phone = String(argsOf(dataSteps, 'or')[1][0])
    expect(search).toContain('name.ilike.%11988887777%')
    expect(phone).toContain('phone.ilike.%21977776666%')
    expect(search).not.toContain('21977776666')
    expect(phone).not.toContain('11988887777')
    for (const value of variantsOf('11988887777')) expect(search).toContain(value)
    for (const value of variantsOf('21977776666')) expect(phone).toContain(value)
    expect(argsOf(countSteps, 'select')[0][1]).toEqual({ count: 'exact', head: true })
    expect(result.total).toBe(2)
    expect(result.data.map((row) => row.id)).toEqual([2, 1])
    expect(result.data[0].tags[0].name).toBe('Quente')
    expect(result.data[0].lead_custom_values[0].value).toBe('valor')
  })

  it('pagina com range quando há offset e mascara lead acima do plano', async () => {
    enqueue({ data: [lead(9, true)], error: null })
    enqueue({ data: null, error: null, count: 150 })

    const result = await api.getLeads(COMPANY, {
      responsible_user_id: USER,
      limit: 100,
      offset: 100,
    })

    expect(argsOf(queries[0].steps, 'eq')).toContainEqual(['responsible_user_id', USER])
    expect(argsOf(queries[0].steps, 'range')).toContainEqual([100, 199])
    expect(result.total).toBe(150)
    expect(result.data[0].phone).toBeNull()
    expect(result.data[0].email).toBeNull()
    expect(result.data[0].company_cnpj).toBeNull()
    expect(result.data[0].company_phone).toBeNull()
    expect(result.data[0].company_email).toBeNull()
    expect(result.data[0].tags).toHaveLength(1)
  })
})

describe('getLeads com tags', () => {
  it('envia uma ou mais tags, período e demais filtros para a RPC', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [
        { lead_id: 30, total_count: 2 },
        { lead_id: 10, total_count: 2 },
      ],
      error: null,
    } as never)
    enqueue({ data: [lead(10), lead(30, true)], error: null })

    const result = await api.getLeads(COMPANY, {
      tag_ids: [TAG_A, TAG_B],
      dateRange: { start: START, end: END },
      status: 'novo',
      origin: 'manual',
      responsible_user_id: USER,
      search: '11988887777',
      name: 'Maria',
      phone: '21977776666',
      email: 'maria@example.com',
      limit: 100,
      offset: 100,
    })

    expect(supabase.rpc).toHaveBeenCalledWith('list_lead_ids_for_filters', {
      p_company_id: COMPANY,
      p_tag_ids: [TAG_A, TAG_B],
      p_start: START,
      p_end: END,
      p_status: 'novo',
      p_origin: 'manual',
      p_responsible_user_id: USER,
      p_search: '11988887777',
      p_search_phone_variants: variantsOf('11988887777'),
      p_name: 'Maria',
      p_phone: '21977776666',
      p_phone_variants: variantsOf('21977776666'),
      p_email: 'maria@example.com',
      p_limit: 100,
      p_offset: 100,
    })
    expect(variantsOf('11988887777')).not.toEqual(variantsOf('21977776666'))
    expect(tables()).toEqual(['leads'])
    expect(tables()).not.toContain('lead_tag_assignments')
    const detail = queries[0].steps
    expect(argsOf(detail, 'in')).toContainEqual(['id', [30, 10]])
    expect(argsOf(detail, 'eq')).toEqual([['company_id', COMPANY]])
    expect(argsOf(detail, 'is')).toEqual([['deleted_at', null]])
    expect(argsOf(detail, 'order')).toEqual([])
    expect(String(argsOf(detail, 'select')[0][0])).toContain('lead_custom_fields')
    expect(result.data.map((row) => row.id)).toEqual([30, 10])
    expect(result.total).toBe(2)
    expect(result.data[0].tags[0].id).toBe(TAG_A)
    expect(result.data[0].lead_custom_values).toHaveLength(1)
    expect(result.data[0].phone).toBeNull()
    expect(result.data[0].company_email).toBeNull()
    expect(result.data[1].phone).toBe('5511999998888')
  })

  it('trata página vazia sem consultar detalhes', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ lead_id: null, total_count: '18' }],
      error: null,
    } as never)

    const result = await api.getLeads(COMPANY, { tag_ids: [TAG_A], limit: 100, offset: 200 })

    expect(result).toEqual({ data: [], total: 18 })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejeita erro da RPC sem ler atribuições', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'função ausente' },
    } as never)

    await expect(api.getLeads(COMPANY, { tag_ids: [TAG_A] })).rejects.toEqual({ message: 'função ausente' })
    expect(tables()).not.toContain('lead_tag_assignments')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejeita resposta inesperada da RPC', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [{ lead_id: 1 }], error: null } as never)

    await expect(api.getLeads(COMPANY, { tag_ids: [TAG_A, TAG_A] })).rejects.toThrow(
      'Resposta inválida de list_lead_ids_for_filters',
    )
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejeita erro da consulta de detalhes', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ lead_id: 4, total_count: 1 }],
      error: null,
    } as never)
    enqueue({ data: null, error: { message: 'detalhe falhou' } })

    await expect(api.getLeads(OTHER, { tag_ids: [TAG_B] })).rejects.toEqual({ message: 'detalhe falhou' })
    expect(argsOf(queries[0].steps, 'eq')).toContainEqual(['company_id', OTHER])
    expect(argsOf(queries[0].steps, 'in')).toContainEqual(['id', [4]])
  })
})
