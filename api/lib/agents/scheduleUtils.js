// =============================================================================
// api/lib/agents/scheduleUtils.js
//
// ScheduleUtils — Utilitário compartilhado de verificação de horário
//
// RESPONSABILIDADE ÚNICA:
//   Funções puras para verificar e calcular janelas de horário a partir de
//   operating_schedule. Sem I/O, sem efeitos colaterais.
//
// EXTRAÍDO DE: conversationRouter.js (Etapa 4 MVP)
// USADO EM:
//   - conversationRouter.js (roteamento de eventos individuais)
//   - batchExecutionPipeline.js (revalidação de lotes agrupados)
//
// FUNÇÕES EXPORTADAS:
//   isWithinSchedule         — verifica se o momento atual está numa janela
//   getNextAllowedScheduleAt — calcula a próxima janela válida após um momento
//
// REGRAS isWithinSchedule:
//   - schedule null ou undefined → true (sem restrição)
//   - enabled = false            → true (sem restrição)
//   - enabled = true + windows=[]→ false (fail-safe: restrição ativa sem janelas = bloqueio)
//   - timezone inválido          → false (fail-safe: configuração corrompida = bloqueio)
//   - enabled = true + windows   → verifica se start <= agora < end no dia atual do schedule
//
// REGRAS getNextAllowedScheduleAt:
//   - schedule null ou enabled=false → null (sem restrição — sempre permitido)
//   - enabled=true + windows=[]      → undefined (habilitado mas sem janelas configuradas)
//   - timezone inválido              → undefined (fail-safe: não propaga data inválida)
//   - encontrou próxima janela       → Date (UTC) da abertura da próxima janela
//   - nenhuma janela em 8 dias       → undefined
//
// ALGORITMO getNextAllowedScheduleAt:
//   Itera de hoje (dayOffset=0) até hoje+7 inclusive (8 dias no total),
//   cobrindo um ciclo semanal completo mais o dia de hoje.
//   Para o dia de hoje (dayOffset=0), considera apenas janelas que COMEÇAM
//   estritamente após o momento atual.
//   Converte "HH:MM no timezone X" para timestamp UTC de forma segura.
//
// LIMITAÇÃO — JANELAS QUE ATRAVESSAM MEIA-NOITE:
//   O formato atual { day, start, end } não suporta janelas do tipo 22:00–02:00.
//   A comparação start <= currentTime < end falha quando end < start.
//   Janelas que cruzam meia-noite devem ser divididas em duas:
//     { day: 1, start: '22:00', end: '23:59' }
//     { day: 2, start: '00:00', end: '02:00' }
//   Esta limitação é documentada e não será corrigida nesta versão.
//   Validação de configuração incorreta é responsabilidade do caller.
//
// Comparação: start <= horaAtual < end  (HH:MM lexicográfico)
// Referência de tempo: sempre o timezone do schedule, nunca o servidor.
// =============================================================================

/**
 * Verifica se o momento atual está dentro de alguma janela do operating_schedule.
 *
 * @param {object|null} schedule - operating_schedule do banco
 * @param {{ assignmentId?: string, conversationId?: string, companyId?: string }} context - Para log
 * @returns {{ allowed: boolean, reason?: string, meta?: object }}
 */
export function isWithinSchedule(schedule, context = {}) {
  if (!schedule || schedule.enabled === false) {
    return { allowed: true };
  }

  const windows = schedule.windows ?? [];
  if (windows.length === 0) {
    const meta = {
      assignment_id:   context.assignmentId,
      company_id:      context.companyId,
      conversation_id: context.conversationId,
    };
    console.warn('🤖 [SCHEDULE] ⏰ schedule bloqueado — enabled=true mas windows vazio:', meta);
    return { allowed: false, reason: 'empty_schedule', meta };
  }

  const tz = schedule.timezone;
  let dayOfWeek, currentTime;

  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone:  tz,
      weekday:   'short',
      hour:      '2-digit',
      minute:    '2-digit',
      hour12:    false
    }).formatToParts(now);

    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
    dayOfWeek = dayMap[weekdayStr];

    if (dayOfWeek === undefined) throw new Error(`weekday desconhecido: "${weekdayStr}"`);

    const hour   = parts.find((p) => p.type === 'hour')?.value   ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    // Intl pode retornar '24' para meia-noite em alguns ambientes — normalizar
    const h = String(parseInt(hour, 10) % 24).padStart(2, '0');
    const m = String(parseInt(minute, 10)).padStart(2, '0');
    currentTime = `${h}:${m}`;

  } catch (err) {
    const meta = {
      assignment_id:   context.assignmentId,
      company_id:      context.companyId,
      conversation_id: context.conversationId,
      timezone_used:   tz,
    };
    console.error('🤖 [SCHEDULE] ⚠️  schedule com timezone inválido — bloqueando (fail-safe):', {
      ...meta,
      error: err.message,
    });
    return { allowed: false, reason: 'invalid_timezone', meta };
  }

  const todayWindows = windows.filter((w) => w.day === dayOfWeek);
  const matched = todayWindows.some((w) => w.start <= currentTime && currentTime < w.end);

  const meta = {
    assignment_id:   context.assignmentId,
    company_id:      context.companyId,
    conversation_id: context.conversationId,
    timezone_used:   tz,
    day_calculated:  dayOfWeek,
    time_calculated: currentTime,
    windows_checked: todayWindows,
  };

  if (!matched) {
    console.log('🤖 [SCHEDULE] ⏰ schedule bloqueado — fora da janela:', {
      ...meta,
      reason: 'no_window_matched',
    });
    return { allowed: false, reason: 'no_window_matched', meta };
  }

  return { allowed: true };
}


// =============================================================================
// getNextAllowedScheduleAt
// =============================================================================

/**
 * Calcula a próxima data/hora em que o operating_schedule permitirá execução.
 *
 * Função pura — não usa Date.now() internamente; recebe `now` como parâmetro
 * para facilitar testes determinísticos.
 *
 * Algoritmo:
 *   Para cada dia (dayOffset = 0..7), determina o dia da semana no timezone
 *   do schedule, filtra janelas do dia e calcula o timestamp UTC de abertura.
 *   Para dayOffset=0 considera apenas janelas que COMEÇAM após now.
 *   Retorna a janela mais próxima encontrada.
 *
 * @param {object|null} schedule - operating_schedule do banco
 * @param {Date}        [now]    - Momento de referência (padrão: new Date())
 * @returns {Date|null|undefined}
 *   - null      → schedule sem restrição (null, undefined ou enabled=false)
 *   - Date      → próxima janela válida encontrada (timestamp UTC)
 *   - undefined → nenhuma janela nos próximos 8 dias, ou timezone inválido, ou
 *                 enabled=true mas windows=[]
 */
export function getNextAllowedScheduleAt(schedule, now = new Date()) {
  if (!schedule || schedule.enabled === false) return null;

  const windows = schedule.windows ?? [];
  if (windows.length === 0) return undefined;

  const tz = schedule.timezone;
  let earliest = null;

  // dayOffset 0..7 inclusive = 8 dias (hoje + 7 dias futuros).
  // Cobre um ciclo semanal completo para garantir que janelas no mesmo
  // dia da semana seguinte sejam encontradas mesmo que nenhuma outra ocorra antes.
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const refDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);

    let dayOfWeek;
    let currentHHMM;

    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday:  'short',
        hour:     '2-digit',
        minute:   '2-digit',
        hour12:   false,
      }).formatToParts(refDate);

      const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
      dayOfWeek = dayMap[weekdayStr];
      if (dayOfWeek === undefined) return undefined;

      const h = String(parseInt(parts.find((p) => p.type === 'hour')?.value   ?? '0', 10) % 24).padStart(2, '0');
      const m = String(parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)).padStart(2, '0');
      currentHHMM = `${h}:${m}`;
    } catch {
      return undefined; // timezone inválido — comportamento fail-safe
    }

    const dayWindows = windows.filter((w) => w.day === dayOfWeek);

    for (const w of dayWindows) {
      // Hoje: apenas janelas cujo START é estritamente APÓS o momento atual.
      // Dias futuros: todas as janelas (sem filtro de tempo).
      if (dayOffset === 0 && w.start <= currentHHMM) continue;

      const windowUTC = _buildWindowUTC(refDate, w.start, tz);
      if (!windowUTC || windowUTC <= now) continue;

      if (!earliest || windowUTC < earliest) {
        earliest = windowUTC;
      }
    }

    // Otimização: qualquer janela de um dia futuro (dayOffset ≥ 1) é obrigatoriamente
    // posterior a qualquer janela de hoje que já tenhamos encontrado.
    // Logo, assim que encontramos pelo menos uma janela em um dia futuro, podemos parar.
    if (earliest && dayOffset >= 1) break;
  }

  return earliest ?? undefined;
}

/**
 * Converte "HH:MM no timezone tz no dia de refDate" para um timestamp UTC.
 * Usado internamente por getNextAllowedScheduleAt.
 *
 * Algoritmo:
 *   1. Obtém a data (YYYY-MM-DD) no timezone tz para refDate.
 *   2. Constrói naiveUTC = essa data + HH:MM tratada como UTC.
 *   3. Verifica em que hora local (em tz) naiveUTC corresponde.
 *   4. Calcula a diferença entre a hora desejada e a hora real, e ajusta.
 *
 * @param {Date}   refDate     - Data de referência (UTC)
 * @param {string} windowStart - "HH:MM" no timezone tz
 * @param {string} tz          - Timezone IANA (ex: "America/Sao_Paulo")
 * @returns {Date|null}
 */
function _buildWindowUTC(refDate, windowStart, tz) {
  try {
    const [wH, wM] = windowStart.split(':').map(Number);

    // Obter data local (YYYY-MM-DD) no timezone do schedule para o dia de refDate.
    // `en-CA` usa formato ISO: YYYY-MM-DD.
    const localDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
    }).format(refDate);

    // Tratar o datetime local como UTC para ter um ponto de partida numérico.
    const naiveUTC = new Date(
      `${localDateStr}T${String(wH).padStart(2, '0')}:${String(wM).padStart(2, '0')}:00Z`
    );

    // Descobrir em que hora tz naiveUTC realmente cai.
    const tzParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
    }).formatToParts(naiveUTC);

    const tzH = parseInt(tzParts.find((p) => p.type === 'hour')?.value   ?? '0', 10) % 24;
    const tzM = parseInt(tzParts.find((p) => p.type === 'minute')?.value ?? '0', 10);

    // Diferença entre hora desejada e hora que naiveUTC representa em tz.
    const desiredMs = (wH * 60 + wM) * 60 * 1000;
    const gotMs     = (tzH * 60 + tzM) * 60 * 1000;
    const deltaMs   = desiredMs - gotMs;

    // Ajustar naiveUTC pela diferença → resultado é o UTC correto para "HH:MM em tz".
    return new Date(naiveUTC.getTime() + deltaMs);
  } catch {
    return null;
  }
}
