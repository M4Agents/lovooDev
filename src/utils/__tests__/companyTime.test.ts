import { describe, expect, it } from 'vitest'
import {
  activityCompanyDate,
  addCalendarDays,
  companyWallFromInstant,
  companyWallToUtc,
  companyWeekDates,
  shiftMonth,
} from '../companyTime'
import { applyActivityTypePreset, presetOffsetValidationError } from '../applyActivityTypePreset'
import type { CreateActivityForm, CustomActivityType } from '../../types/calendar'

const baseForm: CreateActivityForm = {
  title: 'Original',
  description: 'Texto',
  activity_type: 'task',
  scheduled_date: '2026-10-05',
  scheduled_time: '09:00',
  duration_minutes: 30,
  reminder_minutes: 15,
  priority: 'medium',
  visibility: 'public',
}

function preset(partial: Partial<CustomActivityType>): CustomActivityType {
  return {
    id: 'type-1',
    company_id: 'company-1',
    name: 'Ligação',
    icon: '📞',
    color: 'blue',
    display_order: 1,
    is_active: true,
    is_system: false,
    ...partial,
  }
}

describe('companyTime', () => {
  it('mostra 22h de São Paulo no dia civil, mesmo com data UTC no dia seguinte', () => {
    const instant = new Date('2026-10-06T01:00:00.000Z')
    expect(companyWallFromInstant(instant, 'America/Sao_Paulo')).toEqual({
      date: '2026-10-05',
      time: '22:00',
    })
    expect(activityCompanyDate({
      scheduled_datetime: '2026-10-06T01:00:00.000Z',
      scheduled_date: '2026-10-06',
      scheduled_time: '01:00:00',
    }, 'America/Sao_Paulo')).toBe('2026-10-05')
  })

  it('converte 22h de São Paulo para 01h UTC do dia seguinte', () => {
    const converted = companyWallToUtc('2026-10-05', '22:00', 'America/Sao_Paulo')
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    expect(converted.utcDate).toBe('2026-10-06')
    expect(converted.utcTime).toBe('01:00:00')
  })

  it('cruza mês e ano a partir do instante, não da soma de texto', () => {
    const instant = new Date('2026-12-31T22:30:00.000Z')
    const plus = new Date(instant.getTime() + (5 * 60 + 45) * 60_000)
    expect(companyWallFromInstant(plus, 'America/Sao_Paulo')).toEqual({
      date: '2027-01-01',
      time: '01:15',
    })
  })

  it('recusa horário inexistente no avanço do horário de verão', () => {
    const converted = companyWallToUtc('2026-03-08', '02:30', 'America/New_York')
    expect(converted).toEqual({ ok: false, reason: 'nonexistent' })
  })

  it('grava a primeira ocorrência de um horário ambíguo', () => {
    const converted = companyWallToUtc('2026-11-01', '01:30', 'America/New_York')
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    expect(converted.instant.toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })

  it('soma dias e meses civis sem depender do fuso do processo', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftMonth('2026-10-05', 1)).toBe('2026-11-01')
    expect(companyWeekDates('2026-10-07')).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ])
  })
})

describe('limite de 365 dias', () => {
  it('aceita 8760h 0min e 8759h 59min', () => {
    expect(presetOffsetValidationError(8760, 0)).toBeNull()
    expect(presetOffsetValidationError(8759, 59)).toBeNull()
    expect(presetOffsetValidationError(null, null)).toBeNull()
    expect(presetOffsetValidationError(0, 0)).toBeNull()
    expect(presetOffsetValidationError(24, null)).toBeNull()
  })

  it('recusa 8760h 1min e valores negativos', () => {
    expect(presetOffsetValidationError(8760, 1)).toBe('O prazo não pode passar de 365 dias.')
    expect(presetOffsetValidationError(-1, 0)).toBe('Horas do prazo precisam ser um inteiro a partir de zero.')
    expect(presetOffsetValidationError(0, -1)).toBe('Minutos do prazo precisam ser um inteiro de 0 a 59.')
    expect(presetOffsetValidationError(1, 60)).toBe('Minutos do prazo precisam ser um inteiro de 0 a 59.')
  })
})

describe('applyActivityTypePreset', () => {
  const now = new Date('2026-10-05T15:00:00.000Z')

  it('não altera o formulário quando a regra está vazia', () => {
    const next = applyActivityTypePreset(baseForm, preset({}), 'America/Sao_Paulo', now)
    expect(next.title).toBe('Original')
    expect(next.description).toBe('Texto')
    expect(next.scheduled_date).toBe('2026-10-05')
    expect(next.scheduled_time).toBe('09:00')
    expect(next.duration_minutes).toBe(30)
    expect(next.reminder_minutes).toBe(15)
  })

  it('trata zero como valor e completa o campo de prazo que faltou com zero', () => {
    const next = applyActivityTypePreset(baseForm, preset({
      preset_offset_hours: 0,
      preset_offset_minutes: 0,
      preset_reminder_minutes: 0,
    }), 'America/Sao_Paulo', now)
    expect(next.scheduled_date).toBe('2026-10-05')
    expect(next.scheduled_time).toBe('12:00')
    expect(next.reminder_minutes).toBe(0)
    expect(next.title).toBe('Original')
  })

  it('aplica só o que está preenchido e soma 26 horas no fuso da empresa', () => {
    const next = applyActivityTypePreset(baseForm, preset({
      preset_title: 'Retorno',
      preset_description: '',
      preset_offset_hours: 26,
      preset_offset_minutes: null,
      preset_duration_minutes: 45,
    }), 'America/Sao_Paulo', now)
    expect(next.title).toBe('Retorno')
    expect(next.description).toBe('Texto')
    expect(next.scheduled_date).toBe('2026-10-06')
    expect(next.scheduled_time).toBe('14:00')
    expect(next.duration_minutes).toBe(45)
    expect(next.reminder_minutes).toBe(15)
  })
})
