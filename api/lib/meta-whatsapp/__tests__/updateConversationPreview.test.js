// =============================================================================
// updateConversationPreview.test.js
//
// Testes mockados do helper de prévia da sidebar Meta (MVP5.B1.3).
// Sem Graph, sem Supabase remoto, sem INSERT.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateConversationPreview } from '../updateConversationPreview.js';

const COMPANY_ID      = 'aaaa0000-0000-0000-0000-000000000001';
const INSTANCE_ID     = 'cccc0000-0000-0000-0000-000000000003';
const CONVERSATION_ID = 'dddd0000-0000-0000-0000-000000000004';
const TS_NEW          = '2026-11-11T18:00:00.000Z';
const TS_OLD          = '2026-11-11T17:00:00.000Z';
const PREVIEW         = 'Olá, prévia da sidebar';

function makeUpdateChain({ data = [], error = null } = {}) {
  const calls = [];
  const chain = {};
  chain.update = vi.fn((payload) => {
    calls.push(['update', payload]);
    return chain;
  });
  chain.eq = vi.fn((col, val) => {
    calls.push(['eq', col, val]);
    return chain;
  });
  chain.is = vi.fn((col, val) => {
    calls.push(['is', col, val]);
    return chain;
  });
  chain.lte = vi.fn((col, val) => {
    calls.push(['lte', col, val]);
    return chain;
  });
  chain.or = vi.fn((filter) => {
    calls.push(['or', filter]);
    return chain;
  });
  chain.select = vi.fn((cols) => {
    calls.push(['select', cols]);
    return Promise.resolve({ data, error });
  });
  chain._calls = calls;
  return chain;
}

function makeSvc(chains) {
  const queue = [...chains];
  const from = vi.fn(() => {
    const next = queue.shift();
    if (!next) {
      throw new Error('from() called more times than chains provided');
    }
    return next;
  });
  return { from, _queue: queue };
}

const BASE_ARGS = {
  companyId:          COMPANY_ID,
  instanceId:         INSTANCE_ID,
  conversationId:     CONVERSATION_ID,
  providerTimestamp:  TS_NEW,
  preview:            PREVIEW,
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('updateConversationPreview', () => {
  it('HLP-01: last_message_at NULL → primeiro UPDATE aplicado; segundo não executa', async () => {
    const first = makeUpdateChain({ data: [{ id: CONVERSATION_ID }] });
    const svc = makeSvc([first]);

    const result = await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    expect(result).toEqual({ outcome: 'applied' });
    expect(svc.from).toHaveBeenCalledTimes(1);
    expect(svc.from).toHaveBeenCalledWith('meta_conversations');
    expect(first.is).toHaveBeenCalledWith('last_message_at', null);
    expect(first.lte).not.toHaveBeenCalled();
  });

  it('HLP-02: last_message_at não NULL → primeiro zero linhas; segundo aplicado', async () => {
    const first  = makeUpdateChain({ data: [] });
    const second = makeUpdateChain({ data: [{ id: CONVERSATION_ID }] });
    const svc = makeSvc([first, second]);

    const result = await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    expect(result).toEqual({ outcome: 'applied' });
    expect(svc.from).toHaveBeenCalledTimes(2);
    expect(first.is).toHaveBeenCalledWith('last_message_at', null);
    expect(second.lte).toHaveBeenCalledWith('last_message_at', TS_NEW);
    expect(second.is).not.toHaveBeenCalled();
  });

  it('HLP-03: timestamp antigo → ambos zero linhas → skipped', async () => {
    const first  = makeUpdateChain({ data: [] });
    const second = makeUpdateChain({ data: [] });
    const svc = makeSvc([first, second]);

    const result = await updateConversationPreview({
      ...BASE_ARGS,
      providerTimestamp: TS_OLD,
      supabase: svc,
    });

    expect(result).toEqual({ outcome: 'skipped' });
    expect(svc.from).toHaveBeenCalledTimes(2);
    expect(second.lte).toHaveBeenCalledWith('last_message_at', TS_OLD);
  });

  it('HLP-04: erro no primeiro UPDATE → failed; segundo não executa', async () => {
    const first = makeUpdateChain({ error: { message: 'db boom' } });
    const svc = makeSvc([first]);

    const result = await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    expect(result).toEqual({ outcome: 'failed' });
    expect(svc.from).toHaveBeenCalledTimes(1);
  });

  it('HLP-05: erro no segundo UPDATE → failed', async () => {
    const first  = makeUpdateChain({ data: [] });
    const second = makeUpdateChain({ error: { message: 'db boom 2' } });
    const svc = makeSvc([first, second]);

    const result = await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    expect(result).toEqual({ outcome: 'failed' });
    expect(svc.from).toHaveBeenCalledTimes(2);
  });

  it('HLP-06: filtros obrigatórios company_id, instance_id e id em ambas tentativas', async () => {
    const first  = makeUpdateChain({ data: [] });
    const second = makeUpdateChain({ data: [{ id: CONVERSATION_ID }] });
    const svc = makeSvc([first, second]);

    await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    for (const chain of [first, second]) {
      expect(chain.eq).toHaveBeenCalledWith('id', CONVERSATION_ID);
      expect(chain.eq).toHaveBeenCalledWith('company_id', COMPANY_ID);
      expect(chain.eq).toHaveBeenCalledWith('instance_id', INSTANCE_ID);
    }
  });

  it('HLP-07: payload contém somente last_message_preview e last_message_at', async () => {
    const first = makeUpdateChain({ data: [{ id: CONVERSATION_ID }] });
    const svc = makeSvc([first]);

    await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    expect(first.update).toHaveBeenCalledTimes(1);
    const payload = first.update.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['last_message_at', 'last_message_preview']);
    expect(payload.last_message_preview).toBe(PREVIEW);
    expect(payload.last_message_at).toBe(TS_NEW);
  });

  it('HLP-08: nunca altera unread_count', async () => {
    const first  = makeUpdateChain({ data: [] });
    const second = makeUpdateChain({ data: [{ id: CONVERSATION_ID }] });
    const svc = makeSvc([first, second]);

    await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    const p1 = first.update.mock.calls[0][0];
    const p2 = second.update.mock.calls[0][0];
    expect(p1).not.toHaveProperty('unread_count');
    expect(p2).not.toHaveProperty('unread_count');
    expect(p1).not.toHaveProperty('status');
    expect(p1).not.toHaveProperty('contact_name');
  });

  it('HLP-09: timestamp inválido → nenhuma escrita', async () => {
    const svc = { from: vi.fn() };

    for (const bad of [undefined, null, '', 'not-a-date', 123, {}]) {
      svc.from.mockClear();
      const result = await updateConversationPreview({
        ...BASE_ARGS,
        providerTimestamp: bad,
        supabase: svc,
      });
      expect(result).toEqual({ outcome: 'failed' });
      expect(svc.from).not.toHaveBeenCalled();
    }
  });

  it('HLP-10: não usa .or() nem SELECT prévio', async () => {
    const first  = makeUpdateChain({ data: [] });
    const second = makeUpdateChain({ data: [{ id: CONVERSATION_ID }] });
    const svc = makeSvc([first, second]);

    await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    expect(first.or).not.toHaveBeenCalled();
    expect(second.or).not.toHaveBeenCalled();
    expect(first._calls[0][0]).toBe('update');
    expect(second._calls[0][0]).toBe('update');
    expect(first.select).toHaveBeenCalledWith('id');
    expect(second.select).toHaveBeenCalledWith('id');
    const firstSelectIdx = first._calls.findIndex(([op]) => op === 'select');
    expect(firstSelectIdx).toBeGreaterThan(0);
  });

  it('HLP-11: T1 < T2 já persistido → T1 skipped (não sobrescreve)', async () => {
    const first  = makeUpdateChain({ data: [] });
    const second = makeUpdateChain({ data: [] });
    const svc = makeSvc([first, second]);

    const result = await updateConversationPreview({
      ...BASE_ARGS,
      providerTimestamp: TS_OLD,
      preview: 'mensagem antiga T1',
      supabase: svc,
    });

    expect(result).toEqual({ outcome: 'skipped' });
    expect(second.lte).toHaveBeenCalledWith('last_message_at', TS_OLD);
  });

  it('HLP-12: inbound mais recente → outbound antigo skipped', async () => {
    const first  = makeUpdateChain({ data: [] });
    const second = makeUpdateChain({ data: [] });
    const svc = makeSvc([first, second]);

    const result = await updateConversationPreview({
      ...BASE_ARGS,
      providerTimestamp: TS_OLD,
      preview: 'outbound atrasado',
      supabase: svc,
    });

    expect(result).toEqual({ outcome: 'skipped' });
  });

  it('HLP-13: preview vazia → failed sem escrita', async () => {
    const svc = { from: vi.fn() };
    const result = await updateConversationPreview({
      ...BASE_ARGS,
      preview: '',
      supabase: svc,
    });
    expect(result).toEqual({ outcome: 'failed' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('HLP-14: ids ausentes → failed sem escrita', async () => {
    const svc = { from: vi.fn() };
    const result = await updateConversationPreview({
      ...BASE_ARGS,
      companyId: '',
      supabase: svc,
    });
    expect(result).toEqual({ outcome: 'failed' });
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('HLP-15: logs sanitizados não incluem preview nem ids de telefone', async () => {
    const first = makeUpdateChain({ error: { message: 'secret-db' } });
    const svc = makeSvc([first]);

    await updateConversationPreview({ ...BASE_ARGS, supabase: svc });

    const logged = [
      ...console.error.mock.calls.flat().map(String),
      ...console.log.mock.calls.flat().map(String),
    ].join(' ');
    expect(logged).not.toContain(PREVIEW);
    expect(logged).not.toContain('secret-db');
  });

  it('HLP-16: from() lança → failed (não propaga throw)', async () => {
    const svc = {
      from: vi.fn(() => { throw new Error('chain exploded'); }),
    };
    const result = await updateConversationPreview({ ...BASE_ARGS, supabase: svc });
    expect(result).toEqual({ outcome: 'failed' });
  });
});
