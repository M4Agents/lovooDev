import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  COMPANY_TASK_ROLES,
  buildAssigneeOr,
  buildTitleOrLeadFilter,
  compareTasks,
  decideLeadIds,
  effectiveAssignee,
  effectiveAssigneeFilter,
  escapeIlikeLiteral,
  handlerTimedOut,
  isStaleResponse,
  listPresentation,
  normalizeSearchTerm,
  readWindowMinutes,
  resolveCardBounds,
  resolveDateBounds,
  resolveTaskScope,
  searchTimedOut,
  shouldPoll,
  urlByteLength,
  urlExceedsLimit,
  TASK_SEARCH_LIMITS,
} from '../taskBoardContract'

const SP = 'America/Sao_Paulo'

describe('escopo', () => {
  it('admin, system_admin e super_admin veem a empresa', () => {
    for (const role of COMPANY_TASK_ROLES) {
      expect(resolveTaskScope(role)).toBe('company')
    }
  })

  it('manager, seller, partner e admin não listado na trilha veem só as próprias', () => {
    expect(resolveTaskScope('manager')).toBe('own')
    expect(resolveTaskScope('seller')).toBe('own')
    expect(resolveTaskScope('partner')).toBe('own')
    expect(COMPANY_TASK_ROLES).not.toContain('partner')
    expect(COMPANY_TASK_ROLES).not.toContain('manager')
  })

  it('visão própria ignora user_id enviado', () => {
    const other = '11111111-1111-4111-8111-111111111111'
    const self = '22222222-2222-4222-8222-222222222222'
    expect(effectiveAssigneeFilter('own', self, other)).toEqual({ userId: self })
  })

  it('visão da empresa usa o user_id e recusa valor inválido', () => {
    const other = '11111111-1111-4111-8111-111111111111'
    const self = '22222222-2222-4222-8222-222222222222'
    expect(effectiveAssigneeFilter('company', self, other)).toEqual({ userId: other })
    expect(effectiveAssigneeFilter('company', self, '')).toEqual({ userId: null })
    expect(effectiveAssigneeFilter('company', self, 'nao-uuid')).toEqual({ error: 'user_id inválido' })
  })
})

describe('responsável efetivo', () => {
  it('assigned_to preenchido prevalece', () => {
    expect(effectiveAssignee('assigned', 'owner')).toBe('assigned')
  })

  it('assigned_to nulo usa owner_user_id', () => {
    expect(effectiveAssignee(null, 'owner')).toBe('owner')
  })

  it('sem os dois não há responsável efetivo', () => {
    expect(effectiveAssignee(null, null)).toBeNull()
  })

  it('o filtro pede assigned_to ou owner só quando assigned_to é nulo', () => {
    const id = '22222222-2222-4222-8222-222222222222'
    expect(buildAssigneeOr(id)).toBe(
      `assigned_to.eq.${id},and(assigned_to.is.null,owner_user_id.eq.${id})`,
    )
  })
})

describe('busca', () => {
  it('trata o texto como literal', () => {
    expect(escapeIlikeLiteral('100%_a\\b')).toBe('100\\%\\_a\\\\b')
    const built = buildTitleOrLeadFilter('a,b"(c)', [12])
    expect(built).toEqual({
      filter: 'title.ilike."%a,b\\"(c)%",lead_id.in.(12)',
    })
  })

  it('tarefa sem lead continua só pelo título quando não há ids', () => {
    expect(buildTitleOrLeadFilter('ligação', [])).toEqual({
      filter: 'title.ilike."%ligação%"',
    })
  })

  it('interrompe quando passa de 100 leads, sem usar a página parcial', () => {
    const page = Array.from({ length: 100 }, (_, index) => index + 1)
    expect(decideLeadIds(page, null)).toEqual({ action: 'probe' })
    expect(decideLeadIds(page, [101])).toEqual({ action: 'exceeded' })
    expect(decideLeadIds(page, [])).toEqual({ action: 'use', ids: page })
    expect(decideLeadIds(page.slice(0, 3), null)).toEqual({ action: 'use', ids: [1, 2, 3] })
  })

  it('recusa termo longo, filtro grande e tempo estourado', () => {
    expect(normalizeSearchTerm('  a  ')).toBe('a')
    expect(normalizeSearchTerm('')).toBeNull()
    expect(normalizeSearchTerm('x'.repeat(81))).toEqual({ error: 'too_long' })
    expect(searchTimedOut(0, TASK_SEARCH_LIMITS.maxSearchMs + 1)).toBe(true)
    expect(searchTimedOut(0, TASK_SEARCH_LIMITS.maxSearchMs)).toBe(false)
    const huge = buildTitleOrLeadFilter('a', Array.from({ length: 5000 }, (_, i) => i + 1))
    expect(huge).toEqual({ error: 'filter_too_long' })
  })
})

describe('datas no fuso da empresa', () => {
  const asOf = new Date('2026-10-05T15:00:00.000Z')

  it('hoje inclui a atrasada de hoje e exclui a de ontem', () => {
    const bounds = resolveDateBounds('today', asOf, SP, '', '')
    expect(bounds).toEqual({
      kind: 'range',
      start: '2026-10-05T03:00:00.000Z',
      end: '2026-10-06T03:00:00.000Z',
    })
  })

  it('amanhã é o dia civil seguinte', () => {
    expect(resolveDateBounds('tomorrow', asOf, SP, '', '')).toEqual({
      kind: 'range',
      start: '2026-10-06T03:00:00.000Z',
      end: '2026-10-07T03:00:00.000Z',
    })
  })

  it('período inclui os dois dias e recusa De maior que Até', () => {
    expect(resolveDateBounds('range', asOf, SP, '2026-10-01', '2026-10-02')).toEqual({
      kind: 'range',
      start: '2026-10-01T03:00:00.000Z',
      end: '2026-10-03T03:00:00.000Z',
    })
    expect(resolveDateBounds('range', asOf, SP, '2026-10-03', '2026-10-01')).toEqual({
      error: 'De não pode ser maior que Até',
    })
  })

  it('sem data não usa intervalo', () => {
    expect(resolveDateBounds('undated', asOf, SP, '', '')).toEqual({ kind: 'undated' })
    expect(resolveDateBounds('all', asOf, SP, '', '')).toEqual({ kind: 'all' })
  })

  it('perto da meia-noite o dia da empresa não segue outro fuso', () => {
    const late = new Date('2026-10-06T02:30:00.000Z')
    expect(resolveDateBounds('today', late, SP, '', '')).toEqual({
      kind: 'range',
      start: '2026-10-05T03:00:00.000Z',
      end: '2026-10-06T03:00:00.000Z',
    })
  })

  it('a vencer hoje termina no início do dia seguinte e os próximos minutos atravessam a meia-noite', () => {
    const late = new Date('2026-10-06T02:30:00.000Z')
    expect(resolveCardBounds('due_today', late, SP, 15)).toEqual({
      kind: 'between',
      start: '2026-10-06T02:30:00.000Z',
      end: '2026-10-06T03:00:00.000Z',
    })
    expect(resolveCardBounds('upcoming', late, SP, 60)).toEqual({
      kind: 'between',
      start: '2026-10-06T02:30:00.000Z',
      end: '2026-10-06T03:30:00.000Z',
    })
  })

  it('um dia com horário de verão não é tratado como 24 horas', () => {
    const bounds = resolveDateBounds('range', asOf, 'America/New_York', '2026-11-01', '2026-11-01')
    if ('error' in bounds || bounds.kind !== 'range') {
      throw new Error('esperava o intervalo do dia')
    }
    const hours = (Date.parse(bounds.end) - Date.parse(bounds.start)) / 3_600_000
    expect(hours).toBe(25)
  })
})

describe('lista, ordenação e atualização', () => {
  it('ordena horário crescente, sem data no fim e desempata pelo id', () => {
    const rows = [
      { id: 'b', scheduled_datetime: null },
      { id: 'c', scheduled_datetime: '2026-10-06T12:00:00.000Z' },
      { id: 'a', scheduled_datetime: '2026-10-05T12:00:00.000Z' },
      { id: 'd', scheduled_datetime: '2026-10-05T12:00:00.000Z' },
    ]
    expect([...rows].sort(compareTasks).map(row => row.id)).toEqual(['a', 'd', 'c', 'b'])
  })

  it('informa 200 de X sem tratar o total como o tamanho da página', () => {
    expect(listPresentation(240)).toEqual({ shown: 200, truncated: true })
    expect(listPresentation(20)).toEqual({ shown: 20, truncated: false })
    expect(TASK_SEARCH_LIMITS.listLimit).toBe(200)
  })

  it('descarta resposta antiga e não consulta com a aba inativa', () => {
    expect(isStaleResponse(1, 2)).toBe(true)
    expect(isStaleResponse(2, 2)).toBe(false)
    expect(shouldPoll(false, true, false)).toBe(false)
    expect(shouldPoll(true, false, false)).toBe(false)
    expect(shouldPoll(true, true, true)).toBe(false)
    expect(shouldPoll(true, true, false)).toBe(true)
  })

  it('mede a URL codificada inteira e recusa acima de 8192 bytes', () => {
    const supabase = createClient('https://example.supabase.co', 'public-anon-key')
    const ids = Array.from({ length: 100 }, (_, index) => 100_000_000 + index)
    const built = buildTitleOrLeadFilter('á'.repeat(80), ids)
    expect(built).toHaveProperty('filter')
    if (!('filter' in built)) return
    const query = supabase
      .from('lead_activities')
      .select('id,title,description,scheduled_datetime,lead:leads(id,name)', { count: 'exact' })
      .eq('company_id', '11111111-1111-4111-8111-111111111111')
      .in('status', ['pending', 'in_progress'])
      .or(built.filter)
      .order('scheduled_datetime', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(0, 199)
    const href = (query as unknown as { url: URL }).url.toString()
    const bytes = urlByteLength(href)
    expect(bytes).toBeGreaterThan(built.filter.length)
    expect(href).toContain('/rest/v1/lead_activities')
    expect(href).toContain('select=')
    expect(href).toContain('order=')
    expect(bytes).toBeLessThanOrEqual(TASK_SEARCH_LIMITS.maxUrlBytes)
    expect(urlExceedsLimit(`${href}${'x'.repeat(TASK_SEARCH_LIMITS.maxUrlBytes)}`)).toBe(true)
  })

  it('o orçamento cobre a função inteira e fica abaixo do maxDuration declarado', () => {
    expect(TASK_SEARCH_LIMITS.maxSearchMs).toBe(4000)
    expect(TASK_SEARCH_LIMITS.handlerBudgetMs).toBeLessThan(TASK_SEARCH_LIMITS.functionMaxDurationSeconds * 1000)
    expect(TASK_SEARCH_LIMITS.maxSearchMs).toBeLessThan(TASK_SEARCH_LIMITS.handlerBudgetMs)
    expect(handlerTimedOut(0, TASK_SEARCH_LIMITS.handlerBudgetMs + 1)).toBe(true)
    expect(handlerTimedOut(0, TASK_SEARCH_LIMITS.handlerBudgetMs)).toBe(false)
  })

  it('a janela padrão é 15 e fica restrita a 15, 30 ou 60', () => {
    expect(readWindowMinutes(null)).toBe(15)
    expect(readWindowMinutes('30')).toBe(30)
    expect(readWindowMinutes('90')).toBe(15)
  })
})
