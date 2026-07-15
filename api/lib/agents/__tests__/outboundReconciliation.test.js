// =============================================================================
// outboundReconciliation.test.js
//
// Testes unitários para api/lib/agents/outboundReconciliation.js
// Todos os testes usam mocks — sem I/O real.
// =============================================================================

import { describe, it, expect, vi } from 'vitest';
import { loadExistingOutboundForRun } from '../outboundReconciliation.js';

// ── Helper: svc mock factory ──────────────────────────────────────────────────

function makeSvc(rows = [], error = null) {
  const chain = {
    select:  vi.fn().mockReturnThis(),
    eq:      vi.fn().mockReturnThis(),
    order:   vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

const BASE = {
  svc:            null,
  companyId:      'comp-1',
  conversationId: 'conv-1',
  runId:          'run-1',
};

// ── Testes de validação de parâmetros ─────────────────────────────────────────

describe('loadExistingOutboundForRun — validação', () => {
  it('TC-RECON-1: lança quando svc ausente', async () => {
    await expect(
      loadExistingOutboundForRun({ ...BASE, svc: null })
    ).rejects.toThrow(/svc é obrigatório/);
  });

  it('TC-RECON-2: lança quando companyId ausente', async () => {
    await expect(
      loadExistingOutboundForRun({ ...BASE, svc: makeSvc(), companyId: null })
    ).rejects.toThrow(/companyId é obrigatório/);
  });

  it('TC-RECON-3: lança quando conversationId ausente', async () => {
    await expect(
      loadExistingOutboundForRun({ ...BASE, svc: makeSvc(), conversationId: null })
    ).rejects.toThrow(/conversationId é obrigatório/);
  });

  it('TC-RECON-4: lança quando runId ausente', async () => {
    await expect(
      loadExistingOutboundForRun({ ...BASE, svc: makeSvc(), runId: null })
    ).rejects.toThrow(/runId é obrigatório/);
  });

  it('TC-RECON-5: lança quando query ao banco falha', async () => {
    const svc = makeSvc([], { message: 'DB connection failed' });
    await expect(
      loadExistingOutboundForRun({ ...BASE, svc })
    ).rejects.toThrow(/falha ao consultar chat_messages/);
  });
});

// ── Testes de resultado ───────────────────────────────────────────────────────

describe('loadExistingOutboundForRun — resultado', () => {
  it('TC-RECON-6: nenhuma mensagem → hasExisting=false, status=none', async () => {
    const result = await loadExistingOutboundForRun({ ...BASE, svc: makeSvc([]) });

    expect(result.hasExisting).toBe(false);
    expect(result.status).toBe('none');
    expect(result.messages).toEqual([]);
    expect(result.allConfirmed).toBe(false);
    expect(result.hasPending).toBe(false);
    expect(result.hasFailed).toBe(false);
    expect(result.hasUnknown).toBe(false);
  });

  it('TC-RECON-7: todas as mensagens confirmadas → allConfirmed=true, status=all_confirmed', async () => {
    const rows = [
      { id: 'm1', ai_block_index: 0, status: 'sent' },
      { id: 'm2', ai_block_index: 1, status: 'sent' },
    ];
    const result = await loadExistingOutboundForRun({ ...BASE, svc: makeSvc(rows) });

    expect(result.hasExisting).toBe(true);
    expect(result.allConfirmed).toBe(true);
    expect(result.status).toBe('all_confirmed');
    expect(result.hasFailed).toBe(false);
    expect(result.hasPending).toBe(false);
  });

  it('TC-RECON-8: mensagem com status failed → hasFailed=true, status=has_failed', async () => {
    const rows = [
      { id: 'm1', ai_block_index: 0, status: 'sent' },
      { id: 'm2', ai_block_index: 1, status: 'failed' },
    ];
    const result = await loadExistingOutboundForRun({ ...BASE, svc: makeSvc(rows) });

    expect(result.hasExisting).toBe(true);
    expect(result.hasFailed).toBe(true);
    expect(result.allConfirmed).toBe(false);
    expect(result.status).toBe('has_failed');
  });

  it('TC-RECON-9: mensagem com status pending → hasPending=true, status=has_pending', async () => {
    const rows = [
      { id: 'm1', ai_block_index: 0, status: 'sent' },
      { id: 'm2', ai_block_index: 1, status: 'pending' },
    ];
    const result = await loadExistingOutboundForRun({ ...BASE, svc: makeSvc(rows) });

    expect(result.hasExisting).toBe(true);
    expect(result.hasPending).toBe(true);
    expect(result.allConfirmed).toBe(false);
    expect(result.status).toBe('has_pending');
  });

  it('TC-RECON-10: mensagem com status null → hasPending=true', async () => {
    const rows = [{ id: 'm1', ai_block_index: 0, status: null }];
    const result = await loadExistingOutboundForRun({ ...BASE, svc: makeSvc(rows) });

    expect(result.hasPending).toBe(true);
    expect(result.allConfirmed).toBe(false);
  });

  it('TC-RECON-11: status desconhecido → hasUnknown=true, status=unknown', async () => {
    const rows = [{ id: 'm1', ai_block_index: 0, status: 'delivered' }];
    const result = await loadExistingOutboundForRun({ ...BASE, svc: makeSvc(rows) });

    expect(result.hasUnknown).toBe(true);
    expect(result.allConfirmed).toBe(false);
    expect(result.status).toBe('unknown');
  });

  it('TC-RECON-12: precedência: has_failed antes de has_pending', async () => {
    const rows = [
      { id: 'm1', ai_block_index: 0, status: 'pending' },
      { id: 'm2', ai_block_index: 1, status: 'failed' },
    ];
    const result = await loadExistingOutboundForRun({ ...BASE, svc: makeSvc(rows) });

    expect(result.hasFailed).toBe(true);
    expect(result.hasPending).toBe(true);
    expect(result.status).toBe('has_failed'); // failed tem precedência
  });
});

// ── Testes de query multi-tenant ─────────────────────────────────────────────

describe('loadExistingOutboundForRun — query multi-tenant', () => {
  it('TC-RECON-13: query inclui company_id, conversation_id e ai_run_id', async () => {
    const eqCalls = [];
    const svc = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockImplementation((col, val) => {
          eqCalls.push({ col, val });
          return {
            eq:    vi.fn().mockImplementation((c, v) => {
              eqCalls.push({ col: c, val: v });
              return {
                eq:    vi.fn().mockImplementation((c2, v2) => {
                  eqCalls.push({ col: c2, val: v2 });
                  return {
                    eq:    vi.fn().mockImplementation((c3, v3) => {
                      eqCalls.push({ col: c3, val: v3 });
                      return {
                        eq:    vi.fn().mockImplementation((c4, v4) => {
                          eqCalls.push({ col: c4, val: v4 });
                          return { order: vi.fn().mockResolvedValue({ data: [], error: null }) };
                        }),
                      };
                    }),
                  };
                }),
              };
            }),
          };
        }),
      }),
    };

    await loadExistingOutboundForRun({
      svc,
      companyId:      'my-company',
      conversationId: 'my-conv',
      runId:          'my-run',
    });

    const cols = eqCalls.map((c) => c.col);
    expect(cols).toContain('company_id');
    expect(cols).toContain('conversation_id');
    expect(cols).toContain('ai_run_id');
    expect(cols).toContain('is_ai_generated');
    expect(cols).toContain('direction');

    const values = Object.fromEntries(eqCalls.map((c) => [c.col, c.val]));
    expect(values.company_id).toBe('my-company');
    expect(values.conversation_id).toBe('my-conv');
    expect(values.ai_run_id).toBe('my-run');
    expect(values.is_ai_generated).toBe(true);
    expect(values.direction).toBe('outbound');
  });

  it('TC-RECON-14: conteúdo de mensagens não aparece nos logs', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const rows = [{ id: 'm1', ai_block_index: 0, status: 'sent' }];
    await loadExistingOutboundForRun({ ...BASE, svc: makeSvc(rows) });

    const allLogs = consoleSpy.mock.calls.flat();
    const logStr  = JSON.stringify(allLogs);

    // Nenhum conteúdo de mensagem (ai_block_index values, status values only — ok)
    // Mas IDs e conteúdo não devem vazar além do que logamos
    expect(logStr).not.toContain('content');
    expect(logStr).not.toContain('payload');

    consoleSpy.mockRestore();
  });
});
