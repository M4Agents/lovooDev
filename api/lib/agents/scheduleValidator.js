// =====================================================
// scheduleValidator
// Validador de operating_schedule para company_agent_assignments.
//
// Exporta: validateOperatingSchedule(schedule)
//
// Regras:
//   - null/undefined → válido (sem restrição)
//   - enabled: boolean obrigatório
//   - timezone: string IANA válida
//   - windows: array (pode ser vazio)
//   - Por window: day 0-6, start/end HH:MM, start < end
//   - Sem sobreposição por dia, máximo 10 janelas por dia
//
// Sem dependências externas — lógica pura.
// Reutilizável em company-config-create-assignment.js e
// company-config-update-assignment.js.
// =====================================================

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_WINDOWS_PER_DAY = 10;

/**
 * Valida um timezone IANA usando Intl.DateTimeFormat.
 * @param {string} tz
 * @returns {boolean}
 */
function isValidTimezone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifica se dois intervalos [s1,e1) e [s2,e2) se sobrepõem.
 * Ambos no formato HH:MM — comparação lexicográfica é válida.
 * @param {string} s1 @param {string} e1
 * @param {string} s2 @param {string} e2
 * @returns {boolean}
 */
function overlaps(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

/**
 * Valida a estrutura de operating_schedule.
 *
 * @param {unknown} schedule
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateOperatingSchedule(schedule) {
  if (schedule === null || schedule === undefined) {
    return { valid: true };
  }

  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    return { valid: false, reason: 'operating_schedule deve ser um objeto ou null.' };
  }

  // enabled
  if (typeof schedule.enabled !== 'boolean') {
    return { valid: false, reason: 'operating_schedule.enabled deve ser um boolean.' };
  }

  // timezone
  if (typeof schedule.timezone !== 'string' || schedule.timezone.trim() === '') {
    return { valid: false, reason: 'operating_schedule.timezone deve ser uma string não vazia.' };
  }
  if (!isValidTimezone(schedule.timezone)) {
    return { valid: false, reason: `operating_schedule.timezone inválido: "${schedule.timezone}". Use um timezone IANA válido (ex: "America/Sao_Paulo").` };
  }

  // windows
  if (!Array.isArray(schedule.windows)) {
    return { valid: false, reason: 'operating_schedule.windows deve ser um array.' };
  }

  // Validar cada window
  for (let i = 0; i < schedule.windows.length; i++) {
    const w = schedule.windows[i];
    const prefix = `operating_schedule.windows[${i}]`;

    if (typeof w !== 'object' || w === null || Array.isArray(w)) {
      return { valid: false, reason: `${prefix} deve ser um objeto.` };
    }

    if (!Number.isInteger(w.day) || w.day < 0 || w.day > 6) {
      return { valid: false, reason: `${prefix}.day deve ser um inteiro entre 0 (Dom) e 6 (Sab).` };
    }

    if (typeof w.start !== 'string' || !TIME_REGEX.test(w.start)) {
      return { valid: false, reason: `${prefix}.start deve estar no formato HH:MM (ex: "08:00").` };
    }

    if (typeof w.end !== 'string' || !TIME_REGEX.test(w.end)) {
      return { valid: false, reason: `${prefix}.end deve estar no formato HH:MM (ex: "18:00").` };
    }

    if (w.start >= w.end) {
      return { valid: false, reason: `${prefix}: start ("${w.start}") deve ser anterior a end ("${w.end}").` };
    }
  }

  // Verificar limite e sobreposição por dia
  const byDay = {};
  for (const w of schedule.windows) {
    if (!byDay[w.day]) byDay[w.day] = [];
    byDay[w.day].push(w);
  }

  for (const [day, windows] of Object.entries(byDay)) {
    if (windows.length > MAX_WINDOWS_PER_DAY) {
      return {
        valid: false,
        reason: `Dia ${day}: máximo de ${MAX_WINDOWS_PER_DAY} janelas permitidas por dia.`
      };
    }

    // Ordenar por start e verificar sobreposição entre pares consecutivos
    const sorted = [...windows].sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (overlaps(sorted[i].start, sorted[i].end, sorted[i + 1].start, sorted[i + 1].end)) {
        return {
          valid: false,
          reason: `Dia ${day}: janelas sobrepostas detectadas ("${sorted[i].start}–${sorted[i].end}" e "${sorted[i + 1].start}–${sorted[i + 1].end}"). Remova a sobreposição.`
        };
      }
    }
  }

  return { valid: true };
}
