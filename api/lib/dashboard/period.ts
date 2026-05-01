export type PeriodKey =
  | 'today'
  | 'yesterday'
  | '7d'
  | '15d'
  | '30d'
  | 'month'
  | 'last_month'
  | '90d'
  | 'quarter'
  | 'year'
  | 'custom'

export interface ResolvedRange {
  start: string // ISO UTC
  end: string   // ISO UTC
}

const VALID_PERIODS = new Set<PeriodKey>([
  'today', 'yesterday', '7d', '15d', '30d',
  'month', 'last_month', '90d', 'quarter', 'year', 'custom',
])

const MAX_RANGE_DAYS = 365

/**
 * Retorna o início do dia corrente em UTC como objeto Date.
 */
function startOfTodayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Subtrai N dias de uma data.
 */
function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 86_400_000)
}

/**
 * Calcula diferença em dias entre duas datas.
 */
function diffDays(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000)
}

/**
 * Resolve um período nomeado ou customizado em um intervalo de datas UTC.
 *
 * Regras:
 * - Sempre retorna strings ISO 8601 em UTC
 * - start <= end obrigatório
 * - Intervalo máximo: 365 dias
 * - period = 'custom': start_date e end_date obrigatórios
 * - period != 'custom': start_date e end_date são ignorados
 */
export function resolvePeriod(
  period: string,
  start_date?: string,
  end_date?: string,
): ResolvedRange {
  if (!VALID_PERIODS.has(period as PeriodKey)) {
    throw new Error(`Período inválido: "${period}". Valores aceitos: ${[...VALID_PERIODS].join(', ')}`)
  }

  const key = period as PeriodKey
  const now = new Date()
  const todayStart = startOfTodayUTC()

  let start: Date
  let end: Date

  switch (key) {
    case 'today': {
      start = todayStart
      end = now
      break
    }

    case 'yesterday': {
      start = subDays(todayStart, 1)
      end = new Date(todayStart.getTime() - 1) // 23:59:59.999 do dia anterior
      break
    }

    case '7d': {
      start = subDays(now, 7)
      end = now
      break
    }

    case '15d': {
      start = subDays(now, 15)
      end = now
      break
    }

    case '30d': {
      start = subDays(now, 30)
      end = now
      break
    }

    case '90d': {
      start = subDays(now, 90)
      end = now
      break
    }

    case 'month': {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      end = now
      break
    }

    case 'last_month': {
      const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
      const month = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1
      start = new Date(Date.UTC(year, month, 1))
      // Último millisegundo do mês anterior
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1)
      break
    }

    case 'quarter': {
      const currentQuarterMonth = Math.floor(now.getUTCMonth() / 3) * 3
      start = new Date(Date.UTC(now.getUTCFullYear(), currentQuarterMonth, 1))
      end = now
      break
    }

    case 'year': {
      start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
      end = now
      break
    }

    case 'custom': {
      if (!start_date || !end_date) {
        throw new Error('period = "custom" exige start_date e end_date')
      }

      start = new Date(start_date)
      end = new Date(end_date)

      if (isNaN(start.getTime())) {
        throw new Error(`start_date inválida: "${start_date}"`)
      }
      if (isNaN(end.getTime())) {
        throw new Error(`end_date inválida: "${end_date}"`)
      }
      break
    }
  }

  if (start > end) {
    throw new Error(`start (${start.toISOString()}) deve ser anterior a end (${end.toISOString()})`)
  }

  const days = diffDays(start, end)
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`Intervalo de ${days} dias excede o máximo permitido de ${MAX_RANGE_DAYS} dias`)
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}
