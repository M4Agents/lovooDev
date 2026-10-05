import type { CreateActivityForm, CustomActivityType } from '../types/calendar'
import { companyWallFromInstant } from './companyTime'

export const PRESET_OFFSET_LIMIT_MINUTES = 365 * 24 * 60

export function presetOffsetValidationError(
  hours: number | null,
  minutes: number | null
): string | null {
  if (hours == null && minutes == null) return null
  if (hours != null && (!Number.isInteger(hours) || hours < 0)) {
    return 'Horas do prazo precisam ser um inteiro a partir de zero.'
  }
  if (minutes != null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 59)) {
    return 'Minutos do prazo precisam ser um inteiro de 0 a 59.'
  }
  const total = (hours ?? 0) * 60 + (minutes ?? 0)
  if (total > PRESET_OFFSET_LIMIT_MINUTES) {
    return 'O prazo não pode passar de 365 dias.'
  }
  return null
}

function filledText(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function presetOffset(type: CustomActivityType | undefined): { hours: number; minutes: number } | null {
  if (!type) return null
  const hours = type.preset_offset_hours
  const minutes = type.preset_offset_minutes
  if (hours == null && minutes == null) return null
  return { hours: hours ?? 0, minutes: minutes ?? 0 }
}

export function typeHasPreset(type: CustomActivityType | undefined): boolean {
  if (!type) return false
  return filledText(type.preset_title) != null
    || filledText(type.preset_description) != null
    || presetOffset(type) != null
    || type.preset_duration_minutes != null
    || type.preset_reminder_minutes != null
}

/** Aplica só os campos que a regra tem. Zero é valor. Null não altera. */
export function applyActivityTypePreset(
  form: CreateActivityForm,
  type: CustomActivityType | undefined,
  timeZone: string,
  now: Date = new Date()
): CreateActivityForm {
  if (!type) return form
  const next: CreateActivityForm = { ...form, activity_type: type.id as CreateActivityForm['activity_type'] }

  const title = filledText(type.preset_title)
  if (title != null) next.title = title

  const description = filledText(type.preset_description)
  if (description != null) next.description = description

  const offset = presetOffset(type)
  if (offset) {
    const instant = new Date(now.getTime() + (offset.hours * 60 + offset.minutes) * 60_000)
    const wall = companyWallFromInstant(instant, timeZone)
    next.scheduled_date = wall.date
    next.scheduled_time = wall.time
  }

  if (type.preset_duration_minutes != null) next.duration_minutes = type.preset_duration_minutes
  if (type.preset_reminder_minutes != null) next.reminder_minutes = type.preset_reminder_minutes

  return next
}
