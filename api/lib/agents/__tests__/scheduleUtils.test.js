// =============================================================================
// scheduleUtils.test.js
//
// Testes unitários para api/lib/agents/scheduleUtils.js
// — getNextAllowedScheduleAt (novos, Etapa 13)
// — isWithinSchedule (regressão mínima)
//
// Todos os testes são determinísticos: usam datas fixas como referência.
// Sem I/O real.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { isWithinSchedule, getNextAllowedScheduleAt } from '../scheduleUtils.js';

// ── Helpers para criar schedules de teste ─────────────────────────────────────

function makeSchedule({ enabled = true, timezone = 'America/Sao_Paulo', windows = [] } = {}) {
  return { enabled, timezone, windows };
}

// Dia da semana: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

// Retorna uma Date UTC para "YYYY-MM-DD HH:MM" em America/Sao_Paulo (UTC-3)
function spDate(dateStr, hhMM) {
  const [h, m] = hhMM.split(':').map(Number);
  return new Date(`${dateStr}T${String(h + 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
}

// 2026-07-14 é uma terça-feira (Tue = day 2)
const TUESDAY_09 = spDate('2026-07-14', '09:00'); // 2026-07-14 09:00 SP = 12:00Z
const TUESDAY_14 = spDate('2026-07-14', '14:00'); // 14:00 SP = 17:00Z
const TUESDAY_21 = spDate('2026-07-14', '21:00'); // 21:00 SP = 00:00Z next day UTC

// ── Testes: isWithinSchedule (regressão) ──────────────────────────────────────

describe('isWithinSchedule — regressão', () => {
  it('TC-SCH-R1: schedule null → allowed', () => {
    expect(isWithinSchedule(null).allowed).toBe(true);
  });

  it('TC-SCH-R2: enabled=false → allowed', () => {
    expect(isWithinSchedule({ enabled: false }).allowed).toBe(true);
  });

  it('TC-SCH-R3: enabled=true + windows vazio → bloqueado', () => {
    expect(isWithinSchedule({ enabled: true, timezone: 'UTC', windows: [] }).allowed).toBe(false);
  });
});

// ── Testes: getNextAllowedScheduleAt ─────────────────────────────────────────

describe('getNextAllowedScheduleAt', () => {

  // ── Casos sem restrição ──────────────────────────────────────────────────

  it('TC-GNXT-1: schedule=null → null (sem restrição)', () => {
    expect(getNextAllowedScheduleAt(null)).toBeNull();
  });

  it('TC-GNXT-2: enabled=false → null (sem restrição)', () => {
    expect(getNextAllowedScheduleAt({ enabled: false })).toBeNull();
  });

  it('TC-GNXT-3: enabled=true + windows=[] → undefined (nenhuma janela configurada)', () => {
    expect(getNextAllowedScheduleAt({ enabled: true, timezone: 'America/Sao_Paulo', windows: [] })).toBeUndefined();
  });

  // ── Próxima janela no mesmo dia ──────────────────────────────────────────

  it('TC-GNXT-4: janela mais tarde no mesmo dia (terça, 16:00)', () => {
    // Agora: terça 14:00 SP. Janela das 16:00-18:00 no dia 2 (Tue).
    const schedule = makeSchedule({
      windows: [{ day: 2, start: '16:00', end: '18:00' }],
    });
    const now = TUESDAY_14;

    const result = getNextAllowedScheduleAt(schedule, now);

    expect(result).toBeInstanceOf(Date);
    // Deve ser 16:00 SP = 19:00Z
    const expectedUTC = spDate('2026-07-14', '16:00');
    expect(Math.abs(result.getTime() - expectedUTC.getTime())).toBeLessThan(60_000);
  });

  it('TC-GNXT-5: janela no início do dia (terça, 09:00 — antes da hora atual)', () => {
    // Agora: terça 14:00 SP. Janela das 09:00-11:00 já passou.
    // Próxima deve ser na próxima terça (daqui a 7 dias).
    const schedule = makeSchedule({
      windows: [{ day: 2, start: '09:00', end: '11:00' }],
    });
    const now = TUESDAY_14;

    const result = getNextAllowedScheduleAt(schedule, now);

    expect(result).toBeInstanceOf(Date);
    // Deve ser na próxima terça (2026-07-21)
    const nextTuesdayStart = spDate('2026-07-21', '09:00');
    expect(Math.abs(result.getTime() - nextTuesdayStart.getTime())).toBeLessThan(60_000);
  });

  // ── Próxima janela no dia seguinte ───────────────────────────────────────

  it('TC-GNXT-6: nenhuma janela restante hoje — próxima janela amanhã (quarta)', () => {
    // Agora: terça 21:00 SP (último horário do dia praticamente).
    // Schedule: quarta (day 3) das 10:00-12:00.
    const schedule = makeSchedule({
      windows: [{ day: 3, start: '10:00', end: '12:00' }],
    });
    const now = TUESDAY_21;

    const result = getNextAllowedScheduleAt(schedule, now);

    expect(result).toBeInstanceOf(Date);
    // 2026-07-15 (quarta) 10:00 SP
    const expectedUTC = spDate('2026-07-15', '10:00');
    expect(Math.abs(result.getTime() - expectedUTC.getTime())).toBeLessThan(60_000);
  });

  // ── Múltiplas janelas ────────────────────────────────────────────────────

  it('TC-GNXT-7: múltiplas janelas — retorna a mais próxima', () => {
    // Agora: terça 09:00 SP. Duas janelas na terça: 11:00-12:00 e 15:00-16:00.
    const schedule = makeSchedule({
      windows: [
        { day: 2, start: '15:00', end: '16:00' },
        { day: 2, start: '11:00', end: '12:00' },
      ],
    });
    const now = TUESDAY_09;

    const result = getNextAllowedScheduleAt(schedule, now);

    // Mais próxima = 11:00 SP
    const expectedUTC = spDate('2026-07-14', '11:00');
    expect(Math.abs(result.getTime() - expectedUTC.getTime())).toBeLessThan(60_000);
  });

  it('TC-GNXT-8: múltiplos dias — encontra o mais próximo entre hoje e amanhã', () => {
    // Agora: terça 14:00 SP.
    // Janela terça 16:00 e quarta 09:00. Terça 16:00 é mais próxima.
    const schedule = makeSchedule({
      windows: [
        { day: 2, start: '16:00', end: '17:00' },
        { day: 3, start: '09:00', end: '10:00' },
      ],
    });
    const now = TUESDAY_14;

    const result = getNextAllowedScheduleAt(schedule, now);

    const tuesdayWindow = spDate('2026-07-14', '16:00');
    expect(Math.abs(result.getTime() - tuesdayWindow.getTime())).toBeLessThan(60_000);
  });

  // ── Timezone ─────────────────────────────────────────────────────────────

  it('TC-GNXT-9: timezone UTC funciona corretamente', () => {
    // Agora: 10:00 UTC. Janela: dia 2 (Tue) 12:00-14:00 UTC.
    const now = new Date('2026-07-14T10:00:00Z'); // terça 10:00 UTC
    const schedule = makeSchedule({
      timezone: 'UTC',
      windows:  [{ day: 2, start: '12:00', end: '14:00' }],
    });

    const result = getNextAllowedScheduleAt(schedule, now);

    expect(result).toBeInstanceOf(Date);
    const expected = new Date('2026-07-14T12:00:00Z');
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(60_000);
  });

  it('TC-GNXT-10: timezone inválido → undefined (fail-safe)', () => {
    const schedule = makeSchedule({
      timezone: 'INVALID/TIMEZONE',
      windows:  [{ day: 2, start: '10:00', end: '12:00' }],
    });

    const result = getNextAllowedScheduleAt(schedule, TUESDAY_09);

    expect(result).toBeUndefined();
  });

  // ── Sem janela nos próximos 7 dias ───────────────────────────────────────

  it('TC-GNXT-11: schedule só tem uma janela já passada hoje — retorna na semana seguinte', () => {
    // Agora: terça 21:00 SP. Janela: terça 08:00-09:00 (passou).
    // Próxima janela: próxima terça (2026-07-21) 08:00.
    const schedule = makeSchedule({
      windows: [{ day: 2, start: '08:00', end: '09:00' }],
    });
    const now = TUESDAY_21;

    const result = getNextAllowedScheduleAt(schedule, now);

    expect(result).toBeInstanceOf(Date);
    const nextTuesdayWindow = spDate('2026-07-21', '08:00');
    expect(Math.abs(result.getTime() - nextTuesdayWindow.getTime())).toBeLessThan(60_000);
  });

  it('TC-GNXT-12: horário exatamente no início da janela futura', () => {
    // A função não considera a janela se start === currentHHMM (comparação <=)
    // Agora: terça 16:00 SP exatamente. Janela 16:00-18:00.
    // isWithinSchedule retornaria true nesse caso (estamos dentro).
    // getNextAllowedScheduleAt deve retornar a próxima ocorrência (próxima terça).

    const now = spDate('2026-07-14', '16:00');
    const schedule = makeSchedule({
      windows: [{ day: 2, start: '16:00', end: '18:00' }],
    });

    const result = getNextAllowedScheduleAt(schedule, now);

    // 16:00 <= currentHHMM=16:00, então a janela de hoje é pulada
    // Próxima janela: próxima terça 16:00
    expect(result).toBeInstanceOf(Date);
    const nextTuesdayWindow = spDate('2026-07-21', '16:00');
    expect(Math.abs(result.getTime() - nextTuesdayWindow.getTime())).toBeLessThan(60_000);
  });

  it('TC-GNXT-13: janela imediatamente após o momento atual (start > currentHHMM por 1 min)', () => {
    // Agora: terça 15:59 SP. Janela: 16:00-18:00.
    const nowMs = spDate('2026-07-14', '16:00').getTime() - 60_000; // 15:59 SP
    const now   = new Date(nowMs);
    const schedule = makeSchedule({
      windows: [{ day: 2, start: '16:00', end: '18:00' }],
    });

    const result = getNextAllowedScheduleAt(schedule, now);

    // Deve encontrar 16:00 hoje (start > currentHHMM)
    const expected = spDate('2026-07-14', '16:00');
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(60_000);
  });

  // ── Schedule sem janelas → undefined ─────────────────────────────────────

  it('TC-GNXT-14: enabled=true mas windows=[] → undefined', () => {
    const schedule = makeSchedule({ windows: [] });
    expect(getNextAllowedScheduleAt(schedule, TUESDAY_14)).toBeUndefined();
  });
});
