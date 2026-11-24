import { describe, it, expect, vi } from 'vitest';
import {
  OPPORTUNISTIC_WORK_BUDGET,
  allocateOpportunisticSlots,
  applyOutboundStatus,
  applyStoredOutboundStatus,
  clearOutboundNotifyMarker,
  handleLiveOutboundStatus,
  loadCurrentOutboundPendings,
  persistEarlyOutboundStatus,
  reconcileOutboundPendings,
  recoverOutboundStatusBacklog,
} from '../outboundStatusTracking.js';

const COMPANY = 'bbbb0000-0000-0000-0000-000000000002';
const INSTANCE = 'aaaa0000-0000-0000-0000-000000000001';
const OTHER_COMPANY = 'ffff0000-0000-0000-0000-000000000099';
const OTHER_INSTANCE = 'ffff0000-0000-0000-0000-000000000098';
const TRACKING_ID = 'cccc0000-0000-0000-0000-000000000003';
const WAMID = 'wamid.fake';

function instance(overrides = {}) {
  return { id: INSTANCE, company_id: COMPANY, ...overrides };
}

function createDb(seed = {}) {
  const tracking = new Map();
  const pendings = [];
  let nextPendingId = 1;
  let trackingReads = 0;
  const touches = [];
  const calls = [];
  const upserts = [];
  if (seed.tracking) tracking.set(seed.tracking.meta_message_id, { ...seed.tracking });
  for (const row of seed.pendings ?? []) {
    pendings.push({ id: nextPendingId++, received_at: '2026-01-01T00:00:00.000Z', ...row });
  }

  function matches(row, filters) {
    return Object.entries(filters).every(([key, value]) => {
      if (Array.isArray(value)) return value.includes(row[key]);
      return row[key] === value;
    });
  }

  function from(table) {
    calls.push(table);
    const filters = {};
    const state = { op: 'select', payload: null };
    const api = {
      select: () => api,
      eq: (key, value) => { filters[key] = value; return api; },
      in: (key, value) => { filters[key] = value; return api; },
      order: () => api,
      limit: () => execute(false),
      maybeSingle: () => execute(true),
      insert: (payload) => { state.op = 'insert'; state.payload = payload; return api; },
      upsert: (payload, options) => {
        state.op = 'upsert';
        state.payload = payload;
        state.options = options;
        upserts.push({ payload, options });
        return api;
      },
      update: (payload) => { state.op = 'update'; state.payload = payload; return api; },
      delete: () => { state.op = 'delete'; return api; },
      then: (resolve, reject) => execute(false).then(resolve, reject),
    };

    function execute(single) {
      if (table === 'meta_whatsapp_messages' && state.op === 'select') {
        const rows = [...tracking.values()].filter((row) => row && matches(row, filters));
        if (single) {
          trackingReads += 1;
          if (seed.failReadNumber === trackingReads) {
            return Promise.resolve({ data: null, error: { code: 'XX000' } });
          }
          if (seed.appearOnSecondRead && trackingReads === 2 && !tracking.has(filters.meta_message_id)) {
            tracking.set(filters.meta_message_id, {
              id: TRACKING_ID,
              company_id: COMPANY,
              instance_id: INSTANCE,
              meta_message_id: filters.meta_message_id,
              status: 'accepted',
            });
            return Promise.resolve({ data: tracking.get(filters.meta_message_id), error: null });
          }
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        }
        if (seed.markerReadError) return Promise.resolve({ data: null, error: { code: 'XX000' } });
        return Promise.resolve({ data: rows, error: null });
      }
      if (table === 'meta_whatsapp_messages' && state.op === 'update') {
        if (seed.clearError && state.payload?.realtime_notify_pending === false) {
          return Promise.resolve({ data: null, error: { code: 'XX000' } });
        }
        if (seed.failStatus && state.payload?.status === seed.failStatus) {
          return Promise.resolve({ data: null, error: { code: 'XX000' } });
        }
        if (seed.updateError) return Promise.resolve({ data: null, error: seed.updateError });
        const rows = [...tracking.values()].filter((row) => matches(row, filters));
        if (seed.casMisses > 0 && state.payload.status) {
          seed.casMisses -= 1;
          return Promise.resolve({ data: [], error: null });
        }
        for (const row of rows) Object.assign(row, state.payload);
        return Promise.resolve({ data: rows.map((row) => ({ id: row.id })), error: null });
      }
      if (table === 'meta_early_status_pendings' && state.op === 'select') {
        if (seed.pendingReadError) return Promise.resolve({ data: null, error: { code: 'XX000' } });
        const rows = pendings.filter((row) => matches(row, filters));
        return Promise.resolve({ data: rows, error: null });
      }
      if (table === 'meta_early_status_pendings' && (state.op === 'insert' || state.op === 'upsert')) {
        if (seed.insertError) return Promise.resolve({ data: null, error: seed.insertError });
        const duplicate = pendings.find((row) =>
          row.instance_id === state.payload.instance_id
          && row.meta_message_id === state.payload.meta_message_id
          && row.status === state.payload.status);
        if (duplicate) {
          if (seed.conflictMode === 'unidentified') {
            return Promise.resolve({ data: null, error: { code: '23505' } });
          }
          return Promise.resolve({ data: [], error: null });
        }
        const row = {
          id: nextPendingId++,
          received_at: seed.receivedAt ?? '2026-01-02T00:00:00.000Z',
          last_claim_failed_at: null,
          ...state.payload,
        };
        pendings.push(row);
        return Promise.resolve({ data: [{ id: row.id }], error: null });
      }
      if (table === 'meta_early_status_pendings' && state.op === 'update') {
        if (seed.stampError) return Promise.resolve({ error: { code: 'XX000' } });
        for (const row of pendings.filter((item) => matches(item, filters))) {
          row.last_claim_failed_at = state.payload.last_claim_failed_at;
        }
        return Promise.resolve({ error: null });
      }
      if (table === 'meta_early_status_pendings' && state.op === 'delete') {
        if (seed.deleteError) return Promise.resolve({ data: null, error: { code: 'XX000' } });
        const removed = [];
        for (let index = pendings.length - 1; index >= 0; index -= 1) {
          if (matches(pendings[index], filters)) removed.push(...pendings.splice(index, 1));
        }
        return Promise.resolve({ data: removed.map((row) => ({ id: row.id })), error: null });
      }
      if (table === 'meta_messages' && state.op === 'update') {
        if (seed.touchError) return Promise.resolve({ data: null, error: { code: 'XX000' } });
        if (seed.touchMissing) return Promise.resolve({ data: [], error: null });
        touches.push({ filters, payload: state.payload });
        return Promise.resolve({ data: [{ id: 'chat-1' }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    }
    return api;
  }

  return {
    upserts,
    svc: {
      from,
      rpc: vi.fn(async (name, args) => {
        calls.push(name);
        if (name === 'delete_expired_meta_early_status_pendings') {
          if (seed.cleanupError) return { data: null, error: { code: 'XX000' } };
          return { data: 0, error: null };
        }
        if (seed.listError) return { data: null, error: { code: 'XX000' } };
        const rows = (seed.listed ?? pendings).filter((row) =>
          row.company_id === args.p_company_id
          && row.instance_id === args.p_instance_id
          && row.meta_message_id !== args.p_exclude_meta_message_id
          && tracking.has(row.meta_message_id));
        return { data: rows, error: null };
      }),
    },
    tracking,
    pendings,
    touches,
    calls,
  };
}

describe('persistência antecipada', () => {
  it('grava o primeiro evento sem received_at e sem payload sensível', async () => {
    const db = createDb();
    const result = await persistEarlyOutboundStatus(
      db.svc,
      instance(),
      WAMID,
      'sent',
      { timestamp: '1739321024', from: '5511999999999', text: 'segredo' },
    );
    expect(result).toBe('inserted');
    expect(db.upserts[0].options).toEqual({
      onConflict: 'instance_id,meta_message_id,status',
      ignoreDuplicates: true,
    });
    expect(db.upserts[0].payload).not.toHaveProperty('received_at');
    expect(db.upserts[0].payload).not.toHaveProperty('last_claim_failed_at');
    expect(db.pendings[0]).toMatchObject({
      company_id: COMPANY,
      instance_id: INSTANCE,
      meta_message_id: WAMID,
      status: 'sent',
      provider_timestamp: new Date(1739321024 * 1000).toISOString(),
      error_code: null,
      last_claim_failed_at: null,
    });
    expect(db.pendings[0]).not.toHaveProperty('from');
    expect(Object.keys(db.pendings[0])).not.toContain('text');
  });

  it('23505 da unicidade esperada preserva o primeiro evento', async () => {
    const db = createDb();
    await persistEarlyOutboundStatus(db.svc, instance(), WAMID, 'sent', { timestamp: '1739321024' });
    const again = await persistEarlyOutboundStatus(
      db.svc,
      instance(),
      WAMID,
      'sent',
      { timestamp: '1739321999' },
    );
    expect(again).toBe('duplicate');
    expect(db.pendings).toHaveLength(1);
    expect(db.pendings[0].provider_timestamp).toBe(new Date(1739321024 * 1000).toISOString());
  });

  it('erro de insert e conflito de outra constraint não viram duplicata', async () => {
    const broken = createDb({ insertError: { code: '08006' } });
    expect(await persistEarlyOutboundStatus(broken.svc, instance(), WAMID, 'sent', {})).toBe('db_error');

    const other = {
      from: () => ({
        upsert: () => ({
          select: async () => ({
            data: null,
            error: { code: '23505', constraint: 'meta_early_status_pendings_pkey' },
          }),
        }),
      }),
    };
    expect(await persistEarlyOutboundStatus(other, instance(), WAMID, 'sent', {})).toBe('db_error');
    const foreign = {
      from: () => ({
        upsert: () => ({
          select: async () => ({ data: null, error: { code: '23503' } }),
        }),
      }),
    };
    expect(await persistEarlyOutboundStatus(foreign, instance(), WAMID, 'failed', {})).toBe('db_error');

    const unnamed = createDb({ insertError: { code: '23505' } });
    expect(await persistEarlyOutboundStatus(unnamed.svc, instance(), WAMID, 'sent', {})).toBe('db_error');
    expect(unnamed.pendings).toHaveLength(0);

    const namedWithoutRow = createDb({
      insertError: { code: '23505', constraint: 'mesp_instance_message_status_unique' },
    });
    expect(await persistEarlyOutboundStatus(namedWithoutRow.svc, instance(), WAMID, 'sent', {})).toBe('db_error');

    const stored = createDb({
      conflictMode: 'unidentified',
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: '2026-01-01T00:00:00.000Z',
        received_at: '2026-01-01T00:00:00.000Z',
        error_code: 10,
        last_claim_failed_at: '2026-01-03T00:00:00.000Z',
      }],
    });
    expect(await persistEarlyOutboundStatus(
      stored.svc,
      instance(),
      WAMID,
      'sent',
      { timestamp: '1739321999', errors: [{ code: 99 }] },
    )).toBe('duplicate');
    expect(stored.pendings).toHaveLength(1);
    expect(stored.pendings[0].provider_timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(stored.pendings[0].received_at).toBe('2026-01-01T00:00:00.000Z');
    expect(stored.pendings[0].error_code).toBe(10);
    expect(stored.pendings[0].last_claim_failed_at).toBe('2026-01-03T00:00:00.000Z');

    const unconfirmed = createDb({
      conflictMode: 'unidentified',
      pendingReadError: true,
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: '2026-01-01T00:00:00.000Z',
      }],
    });
    expect(await persistEarlyOutboundStatus(unconfirmed.svc, instance(), WAMID, 'sent', {})).toBe('db_error');
    expect(unconfirmed.pendings[0].provider_timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('timestamp inválido fica nulo e failed usa só o error_code inteiro', async () => {
    const db = createDb();
    await persistEarlyOutboundStatus(db.svc, instance(), WAMID, 'failed', {
      timestamp: 1739321024,
      errors: [{ code: 131026, title: 'nao persistir' }],
    });
    expect(db.pendings[0].provider_timestamp).toBeNull();
    expect(db.pendings[0].error_code).toBe(131026);
  });
});

describe('reconciliação e marcador', () => {
  it('erro de leitura de pendência não vira lista vazia nem aplica o evento ao vivo', async () => {
    const db = createDb({
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
      pendingReadError: true,
    });
    const result = await handleLiveOutboundStatus(db.svc, instance(), WAMID, 'delivered', { timestamp: '1739321024' });
    expect(result.transient).toBe(true);
    expect(db.tracking.get(WAMID).status).toBe('accepted');
    expect(db.pendings[0].status).toBe('delivered');
  });

  it('tracking que nasce depois do insert é reconciliado sem segundo apply ao vivo', async () => {
    const db = createDb({ appearOnSecondRead: true });
    const result = await handleLiveOutboundStatus(db.svc, instance(), WAMID, 'sent', { timestamp: '1739321024' });
    expect(result.transient).toBe(false);
    expect(db.tracking.get(WAMID).status).toBe('sent');
    expect(db.tracking.get(WAMID).realtime_notify_pending).toBe(false);
    expect(db.pendings).toHaveLength(0);
    expect(db.touches).toHaveLength(1);
  });

  it('erro na releitura do tracking preserva a pendência', async () => {
    const db = createDb({ failReadNumber: 2 });
    const result = await handleLiveOutboundStatus(db.svc, instance(), WAMID, 'sent', { timestamp: '1739321024' });
    expect(result.transient).toBe(true);
    expect(db.pendings).toHaveLength(1);
    expect(db.touches).toHaveLength(0);
  });

  it('pendências entram antes do evento ao vivo e seguem received_at, id', async () => {
    const db = createDb({
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
      pendings: [
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'read', received_at: '2026-01-03T00:00:00.000Z', provider_timestamp: null, error_code: null, last_claim_failed_at: '2026-01-01T00:00:00.000Z' },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'sent', received_at: '2026-01-01T00:00:00.000Z', provider_timestamp: '2026-01-01T00:00:01.000Z', error_code: null, last_claim_failed_at: null },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'delivered', received_at: '2026-01-02T00:00:00.000Z', provider_timestamp: null, error_code: null },
      ],
    });
    const result = await handleLiveOutboundStatus(db.svc, instance(), WAMID, 'sent', { timestamp: '1739321024' });
    expect(result.transient).toBe(false);
    expect(db.tracking.get(WAMID).status).toBe('read');
    expect(db.tracking.get(WAMID).sent_at).toBe('2026-01-01T00:00:01.000Z');
    expect(db.tracking.get(WAMID).delivered_at).toBe('2026-01-02T00:00:00.000Z');
    expect(db.touches).toHaveLength(1);
    expect(db.pendings).toHaveLength(0);
  });

  it('timestamp armazenado nulo usa received_at e o CAS ao vivo inválido continua com now', async () => {
    const db = createDb({
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: null,
        received_at: '2026-03-01T12:00:00.000Z',
        error_code: null,
      }],
    });
    await reconcileOutboundPendings(db.svc, instance(), db.pendings);
    expect(db.tracking.get(WAMID).sent_at).toBe('2026-03-01T12:00:00.000Z');

    const live = createDb({
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
    });
    await applyOutboundStatus(live.svc, instance(), WAMID, 'sent', { timestamp: 'nao-epoch' });
    expect(live.tracking.get(WAMID).sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(live.tracking.get(WAMID).sent_at).not.toBe('2026-03-01T12:00:00.000Z');
  });

  it('evento fora de ordem não regride e a duplicata não reescreve o tracking', async () => {
    const db = createDb({
      tracking: {
        id: TRACKING_ID,
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'delivered',
        delivered_at: '2026-01-01T00:00:00.000Z',
      },
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: '2026-02-01T00:00:00.000Z',
        received_at: '2026-02-01T00:00:00.000Z',
        error_code: null,
      }],
    });
    await handleLiveOutboundStatus(db.svc, instance(), WAMID, 'delivered', { timestamp: '1739321024' });
    expect(db.tracking.get(WAMID).status).toBe('delivered');
    expect(db.tracking.get(WAMID).delivered_at).toBe('2026-01-01T00:00:00.000Z');
    expect(db.tracking.get(WAMID).realtime_notify_pending).toBeUndefined();
    expect(db.pendings).toHaveLength(0);
    expect(db.touches).toHaveLength(1);
  });

  it('três conflitos de CAS devolvem exhausted e preservam a pendência', async () => {
    const db = createDb({
      casMisses: 3,
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: '2026-01-01T00:00:00.000Z',
        received_at: '2026-01-01T00:00:00.000Z',
        error_code: null,
      }],
    });
    const result = await reconcileOutboundPendings(db.svc, instance(), db.pendings);
    expect(result.transient).toBe(true);
    expect(db.tracking.get(WAMID).status).toBe('accepted');
    expect(db.pendings[0].last_claim_failed_at).toEqual(expect.any(String));
    expect(db.pendings[0].provider_timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('limpeza do marcador distingue linha, zero linhas e erro', async () => {
    const db = createDb({
      tracking: {
        id: TRACKING_ID,
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'read',
        realtime_notify_pending: true,
      },
    });
    expect(await clearOutboundNotifyMarker(db.svc, instance(), TRACKING_ID, 'delivered')).toBe('unchanged');
    expect(db.tracking.get(WAMID).realtime_notify_pending).toBe(true);
    expect(await clearOutboundNotifyMarker(db.svc, instance(), TRACKING_ID, 'read')).toBe('cleared');
    expect(db.tracking.get(WAMID).realtime_notify_pending).toBe(false);

    const broken = createDb({ updateError: { code: 'XX000' } });
    expect(await clearOutboundNotifyMarker(broken.svc, instance(), TRACKING_ID, 'read')).toBe('error');
  });

  it('toque antigo de delivered não apaga o marcador de read', async () => {
    const stored = await applyStoredOutboundStatus(
      createDb({
        tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'delivered' },
      }).svc,
      instance(),
      WAMID,
      'read',
      { timestamp: '2026-04-01T00:00:00.000Z', errorCode: null },
    );
    expect(stored.outcome).toBe('applied');
    expect(stored.statusForNotify).toBe('read');

    const db = createDb({
      tracking: {
        id: TRACKING_ID,
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'read',
        realtime_notify_pending: true,
      },
    });
    expect(await clearOutboundNotifyMarker(db.svc, instance(), TRACKING_ID, 'delivered')).toBe('unchanged');
    expect(db.tracking.get(WAMID).status).toBe('read');
    expect(db.tracking.get(WAMID).realtime_notify_pending).toBe(true);
  });

  it('falha de toque preserva pendência e marcador; missing conclui', async () => {
    const failed = createDb({
      touchError: true,
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: '2026-01-01T00:00:00.000Z',
        received_at: '2026-01-01T00:00:00.000Z',
        error_code: null,
      }],
    });
    const failure = await handleLiveOutboundStatus(failed.svc, instance(), WAMID, 'sent', { timestamp: '10' });
    expect(failure.transient).toBe(true);
    expect(failed.pendings).toHaveLength(1);
    expect(failed.tracking.get(WAMID).realtime_notify_pending).toBe(true);

    const missing = createDb({
      touchMissing: true,
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: '2026-01-01T00:00:00.000Z',
        received_at: '2026-01-01T00:00:00.000Z',
        error_code: null,
      }],
    });
    const ok = await handleLiveOutboundStatus(missing.svc, instance(), WAMID, 'sent', { timestamp: '10' });
    expect(ok.transient).toBe(false);
    expect(missing.pendings).toHaveLength(0);
    expect(missing.tracking.get(WAMID).realtime_notify_pending).toBe(false);
  });

  it('erro na limpeza do marcador preserva a pendência e pede retry', async () => {
    const db = createDb({
      clearError: true,
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: '2026-01-01T00:00:00.000Z',
        received_at: '2026-01-01T00:00:00.000Z',
        error_code: null,
      }],
    });
    const result = await handleLiveOutboundStatus(db.svc, instance(), WAMID, 'sent', { timestamp: '10' });
    expect(result.transient).toBe(true);
    expect(db.pendings).toHaveLength(1);
    expect(db.pendings[0].last_claim_failed_at).toEqual(expect.any(String));
    expect(db.tracking.get(WAMID).status).toBe('sent');
    expect(db.tracking.get(WAMID).realtime_notify_pending).toBe(true);
    expect(db.touches).toHaveLength(1);
  });

  it('zero linhas na limpeza não é erro e não apaga marcador mais novo', async () => {
    const db = createDb({
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
    });
    const result = await handleLiveOutboundStatus(db.svc, instance(), WAMID, 'delivered', { timestamp: '10' });
    expect(result.transient).toBe(false);
    db.tracking.get(WAMID).status = 'read';
    db.tracking.get(WAMID).realtime_notify_pending = true;
    expect(await clearOutboundNotifyMarker(db.svc, instance(), TRACKING_ID, 'delivered')).toBe('unchanged');
    expect(db.tracking.get(WAMID).realtime_notify_pending).toBe(true);
  });

  it('falha operacional interrompe o mesmo wamid e preserva o evento posterior', async () => {
    const cases = [
      ['failed', 'delivered'],
      ['delivered', 'failed'],
      ['read', 'failed'],
    ];
    for (const [earlier, later] of cases) {
      const db = createDb({
        failStatus: earlier,
        tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
        pendings: [
          {
            company_id: COMPANY,
            instance_id: INSTANCE,
            meta_message_id: WAMID,
            status: earlier,
            received_at: '2026-01-01T00:00:00.000Z',
            provider_timestamp: '2026-01-01T00:00:00.000Z',
            error_code: earlier === 'failed' ? 1 : null,
          },
          {
            company_id: COMPANY,
            instance_id: INSTANCE,
            meta_message_id: WAMID,
            status: later,
            received_at: '2026-01-02T00:00:00.000Z',
            provider_timestamp: '2026-01-02T00:00:00.000Z',
            error_code: later === 'failed' ? 2 : null,
          },
        ],
      });
      const reconciled = await reconcileOutboundPendings(db.svc, instance(), db.pendings);
      expect(reconciled.halted).toBe(true);
      expect(db.tracking.get(WAMID).status).toBe('accepted');
      expect(db.pendings.map((row) => row.status)).toEqual([earlier, later]);

      const live = createDb({
        failStatus: earlier,
        tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
        pendings: [{
          company_id: COMPANY,
          instance_id: INSTANCE,
          meta_message_id: WAMID,
          status: earlier,
          received_at: '2026-01-01T00:00:00.000Z',
          provider_timestamp: '2026-01-01T00:00:00.000Z',
          error_code: null,
        }],
      });
      const decision = await handleLiveOutboundStatus(live.svc, instance(), WAMID, later, { timestamp: '10' });
      expect(decision.transient).toBe(true);
      expect(live.tracking.get(WAMID).status).toBe('accepted');
      expect(live.pendings.map((row) => row.status)).toEqual([earlier, later]);
    }
  });

  it('falha ao remover a pendência depois do toque não liga falha transitória', async () => {
    const db = createDb({
      deleteError: true,
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'accepted' },
      pendings: [{
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: WAMID,
        status: 'sent',
        provider_timestamp: '2026-01-01T00:00:00.000Z',
        received_at: '2026-01-01T00:00:00.000Z',
        error_code: null,
      }],
    });
    const result = await handleLiveOutboundStatus(db.svc, instance(), WAMID, 'sent', { timestamp: '10' });
    expect(result.transient).toBe(false);
    expect(db.pendings).toHaveLength(1);
    expect(db.pendings[0].last_claim_failed_at).toEqual(expect.any(String));
    expect(db.touches).toHaveLength(1);
  });

  it('isola empresa e instância na leitura', async () => {
    const db = createDb({
      pendings: [
        { company_id: OTHER_COMPANY, instance_id: INSTANCE, meta_message_id: WAMID, status: 'sent' },
        { company_id: COMPANY, instance_id: OTHER_INSTANCE, meta_message_id: WAMID, status: 'delivered' },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'read' },
      ],
    });
    const loaded = await loadCurrentOutboundPendings(db.svc, instance(), WAMID);
    expect(loaded.error).toBe(false);
    expect(loaded.rows).toEqual([]);
  });
});

describe('recuperação oportunista', () => {
  it('não aplica evento posterior quando o prefixo antigo ainda cabe no orçamento', async () => {
    const db = createDb({
      tracking: { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'accepted' },
      pendings: [
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'sent', received_at: '2026-01-01T00:00:00.000Z', provider_timestamp: '2026-01-01T00:00:00.000Z' },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'delivered', received_at: '2026-01-02T00:00:00.000Z', provider_timestamp: '2026-01-02T00:00:00.000Z' },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'read', received_at: '2026-01-03T00:00:00.000Z', provider_timestamp: '2026-01-03T00:00:00.000Z' },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'failed', received_at: '2026-01-04T00:00:00.000Z', provider_timestamp: '2026-01-04T00:00:00.000Z', error_code: 1 },
      ],
      listed: [
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'failed', received_at: '2026-01-04T00:00:00.000Z' },
      ],
    });
    const result = await recoverOutboundStatusBacklog(db.svc, instance(), new Set([WAMID]));
    expect(result.transient).toBe(false);
    expect(db.tracking.get('wamid.other').status).toBe('read');
    expect(db.pendings).toHaveLength(0);
    expect(db.touches).toHaveLength(1);
    expect(db.svc.rpc).toHaveBeenCalledWith('delete_expired_meta_early_status_pendings', {
      p_company_id: COMPANY,
      p_instance_id: INSTANCE,
    });
  });

  it('divide três vagas de pendência e duas de marcador e redistribui a sobra', () => {
    expect(allocateOpportunisticSlots(4, 4)).toEqual({ pendingSlots: 3, markerSlots: 2 });
    expect(allocateOpportunisticSlots(1, 4)).toEqual({ pendingSlots: 1, markerSlots: 4 });
    expect(allocateOpportunisticSlots(5, 0)).toEqual({ pendingSlots: 5, markerSlots: 0 });
    expect(OPPORTUNISTIC_WORK_BUDGET).toBe(5);
  });

  it('recupera marcador sem pendência e não repete o wamid corrente', async () => {
    const db = createDb({
      tracking: {
        id: TRACKING_ID,
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: 'wamid.marker',
        status: 'delivered',
        realtime_notify_pending: true,
      },
    });
    const result = await recoverOutboundStatusBacklog(db.svc, instance(), new Set(['wamid.marker']));
    expect(result.transient).toBe(false);
    expect(db.touches).toHaveLength(0);
    expect(db.tracking.get('wamid.marker').realtime_notify_pending).toBe(true);

    const open = createDb({
      tracking: {
        id: TRACKING_ID,
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: 'wamid.marker',
        status: 'delivered',
        realtime_notify_pending: true,
      },
    });
    const recovered = await recoverOutboundStatusBacklog(open.svc, instance(), new Set());
    expect(recovered.transient).toBe(false);
    expect(open.touches).toHaveLength(1);
    expect(open.tracking.get('wamid.marker').realtime_notify_pending).toBe(false);
  });

  it('falha da limpeza não liga falha transitória', async () => {
    const db = createDb({ cleanupError: true });
    const result = await recoverOutboundStatusBacklog(db.svc, instance(), new Set());
    expect(result.transient).toBe(false);
    expect(db.svc.rpc).toHaveBeenCalledWith(
      'delete_expired_meta_early_status_pendings',
      { p_company_id: COMPANY, p_instance_id: INSTANCE },
    );
  });

  it('falha de um wamid não cancela o outro', async () => {
    const db = createDb({
      pendings: [
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.a', status: 'sent', received_at: null, provider_timestamp: null },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.b', status: 'sent', received_at: '2026-01-01T00:00:00.000Z', provider_timestamp: '2026-01-01T00:00:00.000Z' },
      ],
    });
    db.tracking.set('wamid.a', { id: 'id-a', company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.a', status: 'accepted' });
    db.tracking.set('wamid.b', { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.b', status: 'accepted' });
    const result = await recoverOutboundStatusBacklog(db.svc, instance(), new Set());
    expect(result.transient).toBe(true);
    expect(db.tracking.get('wamid.a').status).toBe('accepted');
    expect(db.tracking.get('wamid.b').status).toBe('sent');
    expect(db.pendings.map((row) => row.meta_message_id)).toEqual(['wamid.a']);
  });

  it('não aplica mais pendências do que as cinco unidades', async () => {
    const pendings = [1, 2, 3, 4, 5, 6].map((index) => ({
      company_id: COMPANY,
      instance_id: INSTANCE,
      meta_message_id: `wamid.${index}`,
      status: 'sent',
      received_at: `2026-01-0${index}T00:00:00.000Z`,
      provider_timestamp: `2026-01-0${index}T00:00:00.000Z`,
    }));
    const db = createDb({ pendings });
    for (const row of pendings) {
      db.tracking.set(row.meta_message_id, {
        id: row.meta_message_id,
        company_id: COMPANY,
        instance_id: INSTANCE,
        meta_message_id: row.meta_message_id,
        status: 'accepted',
      });
    }
    const result = await recoverOutboundStatusBacklog(db.svc, instance(), new Set());
    expect(result.transient).toBe(false);
    expect(db.touches).toHaveLength(5);
    expect(db.pendings).toHaveLength(1);
    expect(db.tracking.get('wamid.6').status).toBe('accepted');
  });

  it('prefixo completo não consome vaga além do orçamento quando há marcadores', async () => {
    const db = createDb({
      pendings: [
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'sent', received_at: '2026-01-01T00:00:00.000Z', provider_timestamp: '2026-01-01T00:00:00.000Z' },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'delivered', received_at: '2026-01-02T00:00:00.000Z', provider_timestamp: '2026-01-02T00:00:00.000Z' },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'read', received_at: '2026-01-03T00:00:00.000Z', provider_timestamp: '2026-01-03T00:00:00.000Z' },
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'failed', received_at: '2026-01-04T00:00:00.000Z', provider_timestamp: '2026-01-04T00:00:00.000Z', error_code: 1 },
      ],
      listed: [
        { company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'failed' },
      ],
    });
    db.tracking.set('wamid.other', { id: TRACKING_ID, company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.other', status: 'accepted' });
    db.tracking.set('wamid.m1', { id: 'm1', company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.m1', status: 'sent', realtime_notify_pending: true });
    db.tracking.set('wamid.m2', { id: 'm2', company_id: COMPANY, instance_id: INSTANCE, meta_message_id: 'wamid.m2', status: 'sent', realtime_notify_pending: true });
    const result = await recoverOutboundStatusBacklog(db.svc, instance(), new Set());
    expect(result.transient).toBe(false);
    expect(db.tracking.get('wamid.other').status).toBe('read');
    expect(db.pendings.map((row) => row.status)).toEqual(['failed']);
    expect(db.touches.map((touch) => touch.filters.meta_message_id).sort()).toEqual(['wamid.m1', 'wamid.m2', 'wamid.other']);
  });
});
