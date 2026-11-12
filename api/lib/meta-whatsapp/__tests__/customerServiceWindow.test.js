// =============================================================================
// customerServiceWindow.test.js
//
// Testes mockados do motor da janela de 24 horas (MVP5.B2.1).
// Relógio injetado. Sem Graph, sem Supabase remoto, sem fetch.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CUSTOMER_SERVICE_WINDOW_MS,
  CUSTOMER_SERVICE_WINDOW_SAFETY_MS,
  resolveCustomerServiceWindow,
  loadLastInboundTimestamp,
} from '../customerServiceWindow.js';

const NOW_ISO         = '2026-11-12T12:00:00.000Z';
const NOW_MS          = Date.parse(NOW_ISO);
const COMPANY_ID      = 'aaaa0000-0000-0000-0000-000000000001';
const INSTANCE_ID     = 'cccc0000-0000-0000-0000-000000000003';
const CONVERSATION_ID = 'dddd0000-0000-0000-0000-000000000004';
const INBOUND_ISO     = '2026-11-12T11:00:00.000Z';

const EFFECTIVE_MS =
  CUSTOMER_SERVICE_WINDOW_MS - CUSTOMER_SERVICE_WINDOW_SAFETY_MS;

function isoAt(ms) {
  return new Date(ms).toISOString();
}

function inboundAgo(ms) {
  return isoAt(NOW_MS - ms);
}

function inboundAhead(ms) {
  return isoAt(NOW_MS + ms);
}

function makeSelectChain({ data = null, error = null, rejectWith = null } = {}) {
  const calls = [];
  const chain = {};
  const record = (name) => vi.fn((...args) => {
    calls.push([name, ...args]);
    return chain;
  });

  chain.select = record('select');
  chain.eq     = record('eq');
  chain.not    = record('not');
  chain.order  = record('order');
  chain.limit  = record('limit');
  chain.maybeSingle = vi.fn(() => {
    calls.push(['maybeSingle']);
    if (rejectWith) return Promise.reject(rejectWith);
    return Promise.resolve({ data, error });
  });
  chain._calls = calls;
  return chain;
}

function makeSvc(chain, { fromImpl } = {}) {
  const from = vi.fn((table) => {
    if (fromImpl) return fromImpl(table);
    if (table !== 'meta_messages') {
      throw new Error(`unexpected table: ${table}`);
    }
    return chain;
  });
  return { from, _chain: chain };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called in B2.1 tests');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('constantes', () => {
  it('expõe 24h e margem de 60s', () => {
    expect(CUSTOMER_SERVICE_WINDOW_MS).toBe(86_400_000);
    expect(CUSTOMER_SERVICE_WINDOW_SAFETY_MS).toBe(60_000);
    expect(EFFECTIVE_MS).toBe(86_340_000);
  });
});

describe('resolveCustomerServiceWindow', () => {
  it('W-01: inbound há 1 hora → open', () => {
    const lastInboundAt = inboundAgo(60 * 60 * 1000);
    const result = resolveCustomerServiceWindow({
      lastInboundAt,
      now: NOW_ISO,
    });

    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(isoAt(Date.parse(lastInboundAt) + EFFECTIVE_MS));
  });

  it('W-02: inbound há 23h58min59s → open, 1s até o corte local', () => {
    const lastInboundAt = inboundAgo(EFFECTIVE_MS - 1000);
    const result = resolveCustomerServiceWindow({
      lastInboundAt,
      now: NOW_ISO,
    });

    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(isoAt(NOW_MS + 1000));
  });

  it('W-03: inbound há exatamente 23h59min → closed', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: inboundAgo(EFFECTIVE_MS),
      now: NOW_ISO,
    });

    expect(result).toEqual({ state: 'closed', expiresAt: null });
  });

  it('W-04: inbound há exatamente 24h → closed', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: inboundAgo(CUSTOMER_SERVICE_WINDOW_MS),
      now: NOW_ISO,
    });

    expect(result).toEqual({ state: 'closed', expiresAt: null });
  });

  it('W-05: inbound há 25h → closed', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: inboundAgo(25 * 60 * 60 * 1000),
      now: NOW_ISO,
    });

    expect(result).toEqual({ state: 'closed', expiresAt: null });
  });

  it('W-06: inbound ausente → unknown', () => {
    expect(resolveCustomerServiceWindow({ now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: undefined, now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
  });

  it('W-07: inbound null → unknown', () => {
    expect(resolveCustomerServiceWindow({ lastInboundAt: null, now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
  });

  it('W-08: timestamp inválido → unknown', () => {
    expect(resolveCustomerServiceWindow({ lastInboundAt: 'foo', now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: '', now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: {}, now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({
      lastInboundAt: new Date(NOW_MS - 3_600_000),
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('W-09: inbound 30s no futuro, tolerância default 0 → unknown', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: inboundAhead(30_000),
      now: NOW_ISO,
    });

    expect(result).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('W-10: inbound 30s no futuro, tolerância 120s → open a partir de now', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: inboundAhead(30_000),
      now: NOW_ISO,
      futureToleranceMs: 120_000,
    });

    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(isoAt(NOW_MS + EFFECTIVE_MS));
  });

  it('W-11: inbound 30 dias no futuro, tolerância 120s → unknown', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: inboundAhead(30 * 24 * 60 * 60 * 1000),
      now: NOW_ISO,
      futureToleranceMs: 120_000,
    });

    expect(result).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('W-12: Unix em segundos (string ou number) → unknown', () => {
    expect(resolveCustomerServiceWindow({ lastInboundAt: '1739321024', now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: 1739321024, now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: 1739321024000, now: NOW_ISO }))
      .toEqual({ state: 'unknown', expiresAt: null });
  });

  it('W-13: safetyMs NaN, negativo ou >= 24h → unknown', () => {
    const recent = inboundAgo(60 * 60 * 1000);
    expect(resolveCustomerServiceWindow({ lastInboundAt: recent, now: NOW_ISO, safetyMs: Number.NaN }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: recent, now: NOW_ISO, safetyMs: -1 }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({
      lastInboundAt: recent,
      now: NOW_ISO,
      safetyMs: CUSTOMER_SERVICE_WINDOW_MS,
    })).toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({
      lastInboundAt: recent,
      now: NOW_ISO,
      safetyMs: CUSTOMER_SERVICE_WINDOW_MS + 1,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('W-14: timestamp extremo/overflow → unknown, sem exceção', () => {
    expect(() => resolveCustomerServiceWindow({
      lastInboundAt: '999999-01-01T00:00:00.000Z',
      now: NOW_ISO,
    })).not.toThrow();

    expect(resolveCustomerServiceWindow({
      lastInboundAt: '999999-01-01T00:00:00.000Z',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });

    expect(resolveCustomerServiceWindow({
      lastInboundAt: '+275760-09-13T00:00:00.000Z',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('now inválido → unknown', () => {
    const recent = inboundAgo(60 * 60 * 1000);
    expect(resolveCustomerServiceWindow({ lastInboundAt: recent, now: 'foo' }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: recent, now: Number.NaN }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: recent, now: Number.POSITIVE_INFINITY }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: recent, now: new Date('invalid') }))
      .toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({ lastInboundAt: recent, now: null }))
      .toEqual({ state: 'unknown', expiresAt: null });
  });

  it('futureToleranceMs inválido → unknown', () => {
    const recent = inboundAgo(60 * 60 * 1000);
    expect(resolveCustomerServiceWindow({
      lastInboundAt: recent,
      now: NOW_ISO,
      futureToleranceMs: Number.NaN,
    })).toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({
      lastInboundAt: recent,
      now: NOW_ISO,
      futureToleranceMs: -1,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('ISO sem timezone → unknown', () => {
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-11-12T11:00:00',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-11-12T11:00:00.000',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('offset timezone válido equivale ao mesmo instante UTC', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: '2026-11-12T08:00:00.000-03:00',
      now: NOW_ISO,
    });

    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(isoAt(Date.parse('2026-11-12T11:00:00.000Z') + EFFECTIVE_MS));
  });

  it('now injetado como Date ou epoch ms produz o mesmo corte', () => {
    const lastInboundAt = inboundAgo(60 * 60 * 1000);
    const fromIso = resolveCustomerServiceWindow({ lastInboundAt, now: NOW_ISO });
    const fromDate = resolveCustomerServiceWindow({ lastInboundAt, now: new Date(NOW_MS) });
    const fromMs = resolveCustomerServiceWindow({ lastInboundAt, now: NOW_MS });

    expect(fromIso).toEqual(fromDate);
    expect(fromIso).toEqual(fromMs);
    expect(fromIso.expiresAt).toBe(isoAt(Date.parse(lastInboundAt) + EFFECTIVE_MS));
  });

  it('não muta o objeto de argumentos', () => {
    const args = Object.freeze({
      lastInboundAt: inboundAgo(60 * 60 * 1000),
      now: NOW_ISO,
      safetyMs: CUSTOMER_SERVICE_WINDOW_SAFETY_MS,
      futureToleranceMs: 0,
    });

    expect(() => resolveCustomerServiceWindow(args)).not.toThrow();
    expect(args.lastInboundAt).toBe(inboundAgo(60 * 60 * 1000));
    expect(args.now).toBe(NOW_ISO);
    expect(args.safetyMs).toBe(CUSTOMER_SERVICE_WINDOW_SAFETY_MS);
    expect(args.futureToleranceMs).toBe(0);
  });

  it('limite de precisão em milissegundos: 1ms antes do corte é open', () => {
    const lastInboundAt = inboundAgo(EFFECTIVE_MS - 1);
    const result = resolveCustomerServiceWindow({
      lastInboundAt,
      now: NOW_ISO,
    });

    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(isoAt(NOW_MS + 1));
  });

  it('now omitido usa o relógio atual apenas no runtime', () => {
    const lastInboundAt = isoAt(Date.now() - 60 * 60 * 1000);
    const result = resolveCustomerServiceWindow({ lastInboundAt });
    expect(result.state).toBe('open');
    expect(typeof result.expiresAt).toBe('string');
  });

  it('T-01: resolveCustomerServiceWindow(null) → unknown, sem throw', () => {
    expect(() => resolveCustomerServiceWindow(null)).not.toThrow();
    expect(resolveCustomerServiceWindow(null))
      .toEqual({ state: 'unknown', expiresAt: null });
  });

  it('T-02: resolveCustomerServiceWindow(undefined) → unknown, sem throw', () => {
    expect(() => resolveCustomerServiceWindow(undefined)).not.toThrow();
    expect(resolveCustomerServiceWindow(undefined))
      .toEqual({ state: 'unknown', expiresAt: null });
  });

  it('T-03: resolveCustomerServiceWindow() → unknown, sem throw', () => {
    expect(() => resolveCustomerServiceWindow()).not.toThrow();
    expect(resolveCustomerServiceWindow())
      .toEqual({ state: 'unknown', expiresAt: null });
  });

  it('T-07: argumentos válidos do helper continuam open', () => {
    const lastInboundAt = inboundAgo(60 * 60 * 1000);
    const result = resolveCustomerServiceWindow({
      lastInboundAt,
      now: NOW_ISO,
    });
    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(isoAt(Date.parse(lastInboundAt) + EFFECTIVE_MS));
  });

  it('T-08: 2026-02-30 → unknown', () => {
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-02-30T00:00:00.000Z',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('T-09: 2026-02-29 → unknown', () => {
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-02-29T00:00:00.000Z',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('T-10: 2026-04-31 → unknown', () => {
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-04-31T12:00:00.000Z',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('T-11: 2026-13-01 e 2026-00-10 → unknown', () => {
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-13-01T00:00:00.000Z',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-00-10T00:00:00.000Z',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('T-12: 2024-02-29 bissexto → open com now adequado', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: '2024-02-29T12:00:00.000Z',
      now: '2024-02-29T13:00:00.000Z',
    });
    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(
      isoAt(Date.parse('2024-02-29T12:00:00.000Z') + EFFECTIVE_MS),
    );
  });

  it('T-13: 2026-02-28 → válido e open', () => {
    const result = resolveCustomerServiceWindow({
      lastInboundAt: '2026-02-28T12:00:00.000Z',
      now: '2026-02-28T13:00:00.000Z',
    });
    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(
      isoAt(Date.parse('2026-02-28T12:00:00.000Z') + EFFECTIVE_MS),
    );
  });

  it('T-14: offset válido que atravessa meia-noite UTC permanece open', () => {
    // Local 2026-11-12 22:00 -03 = 2026-11-13 01:00Z. now = 02:00Z.
    const result = resolveCustomerServiceWindow({
      lastInboundAt: '2026-11-12T22:00:00.000-03:00',
      now: '2026-11-13T02:00:00.000Z',
    });
    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(
      isoAt(Date.parse('2026-11-12T22:00:00.000-03:00') + EFFECTIVE_MS),
    );
  });

  it('T-15: data impossível com offset → unknown', () => {
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-02-30T00:00:00.000-03:00',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
    expect(resolveCustomerServiceWindow({
      lastInboundAt: '2026-04-31T23:00:00.000+02:00',
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });

  it('T-16: corte exato de 23h59min continua closed', () => {
    expect(resolveCustomerServiceWindow({
      lastInboundAt: inboundAgo(EFFECTIVE_MS),
      now: NOW_ISO,
    })).toEqual({ state: 'closed', expiresAt: null });
  });

  it('T-17: 1ms antes do corte continua open', () => {
    const lastInboundAt = inboundAgo(EFFECTIVE_MS - 1);
    const result = resolveCustomerServiceWindow({
      lastInboundAt,
      now: NOW_ISO,
    });
    expect(result.state).toBe('open');
    expect(result.expiresAt).toBe(isoAt(NOW_MS + 1));
  });

  it('T-18: futuro com tolerância default zero continua unknown', () => {
    expect(resolveCustomerServiceWindow({
      lastInboundAt: inboundAhead(30_000),
      now: NOW_ISO,
    })).toEqual({ state: 'unknown', expiresAt: null });
  });
});

describe('loadLastInboundTimestamp', () => {
  const IDS = {
    companyId:      COMPANY_ID,
    instanceId:     INSTANCE_ID,
    conversationId: CONVERSATION_ID,
  };

  it('L-01: erro Supabase → db_error', async () => {
    const chain = makeSelectChain({ data: null, error: { message: 'boom' } });
    const svc = makeSvc(chain);

    await expect(loadLastInboundTimestamp(svc, IDS))
      .resolves.toEqual({ ok: false, reason: 'db_error' });
    expect(svc.from).toHaveBeenCalledTimes(1);
  });

  it('L-02: nenhuma linha → ok true, null', async () => {
    const chain = makeSelectChain({ data: null, error: null });
    const svc = makeSvc(chain);

    await expect(loadLastInboundTimestamp(svc, IDS))
      .resolves.toEqual({ ok: true, lastInboundAt: null });
  });

  it('L-03: inbound válido → retorna ISO sem converter', async () => {
    const chain = makeSelectChain({
      data: { provider_timestamp: INBOUND_ISO },
      error: null,
    });
    const svc = makeSvc(chain);

    await expect(loadLastInboundTimestamp(svc, IDS))
      .resolves.toEqual({ ok: true, lastInboundAt: INBOUND_ISO });
  });

  it('T-04: loadLastInboundTimestamp(svc, null) → invalid_ids, sem from()', async () => {
    const chain = makeSelectChain();
    const svc = makeSvc(chain);
    await expect(loadLastInboundTimestamp(svc, null)).resolves.toEqual({
      ok: false,
      reason: 'invalid_ids',
    });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('T-05: loadLastInboundTimestamp(svc, undefined) → invalid_ids, sem from()', async () => {
    const chain = makeSelectChain();
    const svc = makeSvc(chain);
    await expect(loadLastInboundTimestamp(svc, undefined)).resolves.toEqual({
      ok: false,
      reason: 'invalid_ids',
    });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('T-06: loadLastInboundTimestamp(svc) → invalid_ids, sem from()', async () => {
    const chain = makeSelectChain();
    const svc = makeSvc(chain);
    await expect(loadLastInboundTimestamp(svc)).resolves.toEqual({
      ok: false,
      reason: 'invalid_ids',
    });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('T-07: loader com IDs válidos continua consultando meta_messages', async () => {
    const chain = makeSelectChain({ data: { provider_timestamp: INBOUND_ISO } });
    const svc = makeSvc(chain);
    await expect(loadLastInboundTimestamp(svc, IDS))
      .resolves.toEqual({ ok: true, lastInboundAt: INBOUND_ISO });
    expect(svc.from).toHaveBeenCalledWith('meta_messages');
  });

  it('L-04: companyId ausente/inválido → invalid_ids, sem query', async () => {
    const chain = makeSelectChain();
    const svc = makeSvc(chain);

    await expect(loadLastInboundTimestamp(svc, { ...IDS, companyId: undefined }))
      .resolves.toEqual({ ok: false, reason: 'invalid_ids' });
    await expect(loadLastInboundTimestamp(svc, { ...IDS, companyId: 'not-a-uuid' }))
      .resolves.toEqual({ ok: false, reason: 'invalid_ids' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('L-05: instanceId ausente/inválido → invalid_ids, sem query', async () => {
    const chain = makeSelectChain();
    const svc = makeSvc(chain);

    await expect(loadLastInboundTimestamp(svc, { ...IDS, instanceId: '' }))
      .resolves.toEqual({ ok: false, reason: 'invalid_ids' });
    await expect(loadLastInboundTimestamp(svc, { ...IDS, instanceId: 'zzzz' }))
      .resolves.toEqual({ ok: false, reason: 'invalid_ids' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('L-06: conversationId ausente/inválido → invalid_ids, sem query', async () => {
    const chain = makeSelectChain();
    const svc = makeSvc(chain);

    await expect(loadLastInboundTimestamp(svc, { ...IDS, conversationId: null }))
      .resolves.toEqual({ ok: false, reason: 'invalid_ids' });
    await expect(loadLastInboundTimestamp(svc, { ...IDS, conversationId: 123 }))
      .resolves.toEqual({ ok: false, reason: 'invalid_ids' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('L-07: aplica todos os filtros .eq()', async () => {
    const chain = makeSelectChain({ data: { provider_timestamp: INBOUND_ISO } });
    const svc = makeSvc(chain);

    await loadLastInboundTimestamp(svc, IDS);

    expect(chain.eq).toHaveBeenCalledWith('company_id', COMPANY_ID);
    expect(chain.eq).toHaveBeenCalledWith('instance_id', INSTANCE_ID);
    expect(chain.eq).toHaveBeenCalledWith('conversation_id', CONVERSATION_ID);
    expect(chain.eq).toHaveBeenCalledWith('direction', 'inbound');
    expect(chain.eq).toHaveBeenCalledTimes(4);
  });

  it('L-08: SELECT mínimo, .not(), DESC, LIMIT 1 e maybeSingle', async () => {
    const chain = makeSelectChain({ data: { provider_timestamp: INBOUND_ISO } });
    const svc = makeSvc(chain);

    await loadLastInboundTimestamp(svc, IDS);

    expect(svc.from).toHaveBeenCalledWith('meta_messages');
    expect(svc.from).toHaveBeenCalledTimes(1);
    expect(chain.select).toHaveBeenCalledWith('provider_timestamp');
    expect(chain.select).toHaveBeenCalledTimes(1);
    expect(chain.not).toHaveBeenCalledWith('provider_timestamp', 'is', null);
    expect(chain.order).toHaveBeenCalledWith('provider_timestamp', {
      ascending: false,
      nullsFirst: false,
    });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('L-09: direction deve ser inbound — outbound não entra na consulta', async () => {
    const chain = makeSelectChain({ data: { provider_timestamp: INBOUND_ISO } });
    const svc = makeSvc(chain);

    await loadLastInboundTimestamp(svc, IDS);

    const directionEq = chain.eq.mock.calls.filter(([col]) => col === 'direction');
    expect(directionEq).toEqual([['direction', 'inbound']]);
    expect(chain.eq.mock.calls.some(([, val]) => val === 'outbound')).toBe(false);
  });

  it('cliente inválido → invalid_client, sem query', async () => {
    await expect(loadLastInboundTimestamp(null, IDS))
      .resolves.toEqual({ ok: false, reason: 'invalid_client' });
    await expect(loadLastInboundTimestamp({}, IDS))
      .resolves.toEqual({ ok: false, reason: 'invalid_client' });
    await expect(loadLastInboundTimestamp({ from: 'nope' }, IDS))
      .resolves.toEqual({ ok: false, reason: 'invalid_client' });
  });

  it('exceção síncrona em from() → db_error', async () => {
    const svc = {
      from: vi.fn(() => {
        throw new Error('sync fail');
      }),
    };

    await expect(loadLastInboundTimestamp(svc, IDS))
      .resolves.toEqual({ ok: false, reason: 'db_error' });
  });

  it('Promise rejeitada → db_error', async () => {
    const chain = makeSelectChain({ rejectWith: new Error('rejected') });
    const svc = makeSvc(chain);

    await expect(loadLastInboundTimestamp(svc, IDS))
      .resolves.toEqual({ ok: false, reason: 'db_error' });
  });

  it('provider_timestamp não-string → lastInboundAt null', async () => {
    const chain = makeSelectChain({
      data: { provider_timestamp: 1739321024 },
      error: null,
    });
    const svc = makeSvc(chain);

    await expect(loadLastInboundTimestamp(svc, IDS))
      .resolves.toEqual({ ok: true, lastInboundAt: null });
  });

  it('não acessa tabela diferente de meta_messages', async () => {
    const tables = [];
    const chain = makeSelectChain({ data: { provider_timestamp: INBOUND_ISO } });
    const svc = {
      from: vi.fn((table) => {
        tables.push(table);
        if (table !== 'meta_messages') {
          throw new Error(`unexpected table: ${table}`);
        }
        return chain;
      }),
    };

    await expect(loadLastInboundTimestamp(svc, IDS))
      .resolves.toEqual({ ok: true, lastInboundAt: INBOUND_ISO });
    expect(tables).toEqual(['meta_messages']);
  });

  it('linha encontrada + helper → open com relógio injetado', async () => {
    const chain = makeSelectChain({
      data: { provider_timestamp: inboundAgo(60 * 60 * 1000) },
    });
    const loaded = await loadLastInboundTimestamp(makeSvc(chain), IDS);
    expect(loaded.ok).toBe(true);

    const window = resolveCustomerServiceWindow({
      lastInboundAt: loaded.lastInboundAt,
      now: NOW_ISO,
    });
    expect(window.state).toBe('open');
  });
});
