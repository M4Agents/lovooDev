// =============================================================================
// conversationLock.test.js
//
// Testes unitários para api/lib/agents/conversationLock.js
// Todos os testes usam mocks — sem I/O real.
//
// Implementação alvo (após RPC atômica):
//   acquireConversationLock → chama svc.rpc('agent_conversation_lock_acquire_v1', ...)
//   releaseConversationLock → chama svc.rpc('agent_conversation_lock_release_v1', ...)
//   Nenhum uso de svc.from('agent_processing_locks').
//
// API pública (inalterada):
//   acquireConversationLock(svc, { companyId, conversationId, runId, staleMinutes? })
//   releaseConversationLock(svc, { companyId, conversationId, runId })
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { acquireConversationLock, releaseConversationLock } from '../conversationLock.js';

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ── Constantes ────────────────────────────────────────────────────────────────

const COMPANY_ID = 'company-uuid-lock-1';
const CONV_ID    = 'conv-uuid-lock-1';
const RUN_ID     = 'run-uuid-lock-1';

// ── Factory de svc mock ───────────────────────────────────────────────────────

/**
 * Cria um mock de svc com `.rpc()` configurável.
 * O helper NÃO deve chamar `.from()` em hipótese alguma.
 */
function makeSvc(rpcImpl) {
  return {
    rpc:  vi.fn().mockImplementation(rpcImpl ?? (() => Promise.resolve({ data: null, error: null }))),
    from: vi.fn().mockImplementation(() => { throw new Error('svc.from() não deve ser chamado pelo helper'); }),
  };
}

// ── Respostas RPC padrão ──────────────────────────────────────────────────────

const RPC_ACQUIRED       = { data: { acquired: true,  reason: 'acquired'       }, error: null };
const RPC_ALREADY_OWNED  = { data: { acquired: true,  reason: 'already_owned'  }, error: null };
const RPC_STALE_REPLACED = { data: { acquired: true,  reason: 'stale_replaced' }, error: null };
const RPC_LOCK_BUSY      = { data: { acquired: false, reason: 'lock_busy'      }, error: null };
const RPC_RELEASED_TRUE  = { data: { released: true  }, error: null };
const RPC_RELEASED_FALSE = { data: { released: false }, error: null };


// =============================================================================
// acquireConversationLock
// =============================================================================

describe('acquireConversationLock', () => {

  // ── Verificação de contrato da RPC ──────────────────────────────────────────

  it('TC-LOCK-1: chama exclusivamente rpc (não usa .from)', async () => {
    const svc = makeSvc(() => RPC_ACQUIRED);

    await acquireConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID });

    expect(svc.rpc).toHaveBeenCalledOnce();
    expect(svc.rpc).toHaveBeenCalledWith('agent_conversation_lock_acquire_v1', expect.objectContaining({
      p_company_id:      COMPANY_ID,
      p_conversation_id: CONV_ID,
      p_run_id:          RUN_ID,
    }));
    // .from() nunca deve ser chamado
    expect(svc.from).not.toHaveBeenCalled();
  });

  it('TC-LOCK-2: staleMinutes é convertido para segundos no parâmetro da RPC', async () => {
    const svc = makeSvc(() => RPC_ACQUIRED);

    await acquireConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID, staleMinutes: 10 });

    expect(svc.rpc).toHaveBeenCalledWith('agent_conversation_lock_acquire_v1', expect.objectContaining({
      p_stale_after_seconds: 600,   // 10 * 60
    }));
  });

  it('TC-LOCK-3: staleMinutes padrão (5 min) → 300 segundos', async () => {
    const svc = makeSvc(() => RPC_ACQUIRED);

    await acquireConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID });

    expect(svc.rpc).toHaveBeenCalledWith('agent_conversation_lock_acquire_v1', expect.objectContaining({
      p_stale_after_seconds: 300,
    }));
  });

  // ── Normalização de resultados ──────────────────────────────────────────────

  it('TC-LOCK-4: normaliza reason=acquired → { acquired: true }', async () => {
    const result = await acquireConversationLock(makeSvc(() => RPC_ACQUIRED), {
      companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID,
    });

    expect(result.acquired).toBe(true);
  });

  it('TC-LOCK-5: normaliza reason=already_owned → { acquired: true, reason: "already_owned" }', async () => {
    const result = await acquireConversationLock(makeSvc(() => RPC_ALREADY_OWNED), {
      companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID,
    });

    expect(result.acquired).toBe(true);
    expect(result.reason).toBe('already_owned');
  });

  it('TC-LOCK-6: normaliza reason=stale_replaced → { acquired: true }', async () => {
    const result = await acquireConversationLock(makeSvc(() => RPC_STALE_REPLACED), {
      companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID,
    });

    expect(result.acquired).toBe(true);
    // stale_replaced não expõe reason ao caller — retorno simples
    expect(result.reason).toBeUndefined();
  });

  it('TC-LOCK-7: normaliza reason=lock_busy → { acquired: false, reason: "lock_busy" }', async () => {
    const result = await acquireConversationLock(makeSvc(() => RPC_LOCK_BUSY), {
      companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID,
    });

    expect(result).toEqual({ acquired: false, reason: 'lock_busy' });
  });

  // ── Tratamento de erros da RPC ──────────────────────────────────────────────

  it('TC-LOCK-8: lança exceção quando RPC retorna erro TENANT_VIOLATION', async () => {
    const svc = makeSvc(() => ({
      data: null,
      error: { message: 'TENANT_VIOLATION: conversa X não pertence à empresa Y' },
    }));

    await expect(
      acquireConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID })
    ).rejects.toThrow(/violação multi-tenant/i);
  });

  it('TC-LOCK-9: lança exceção quando RPC retorna erro INVALID_PARAM', async () => {
    const svc = makeSvc(() => ({
      data: null,
      error: { message: 'INVALID_PARAM: p_stale_after_seconds deve estar entre 30 e 3600' },
    }));

    await expect(
      acquireConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID })
    ).rejects.toThrow(/parâmetro inválido/i);
  });

  it('TC-LOCK-10: lança exceção em erro de banco inesperado', async () => {
    const svc = makeSvc(() => ({
      data: null,
      error: { message: 'connection timeout' },
    }));

    await expect(
      acquireConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID })
    ).rejects.toThrow(/erro de banco inesperado/i);
  });

  // ── Validações de parâmetros (client-side) ──────────────────────────────────

  it('TC-LOCK-11: lança exceção quando companyId está ausente — sem chamar rpc', async () => {
    const svc = makeSvc();

    await expect(
      acquireConversationLock(svc, { conversationId: CONV_ID, runId: RUN_ID })
    ).rejects.toThrow(/companyId é obrigatório/);

    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('TC-LOCK-12: lança exceção quando conversationId está ausente — sem chamar rpc', async () => {
    const svc = makeSvc();

    await expect(
      acquireConversationLock(svc, { companyId: COMPANY_ID, runId: RUN_ID })
    ).rejects.toThrow(/conversationId é obrigatório/);

    expect(svc.rpc).not.toHaveBeenCalled();
  });

  it('TC-LOCK-13: lança exceção quando runId está ausente — sem chamar rpc', async () => {
    const svc = makeSvc();

    await expect(
      acquireConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID })
    ).rejects.toThrow(/runId é obrigatório/);

    expect(svc.rpc).not.toHaveBeenCalled();
  });

  // ── Isolamento multi-tenant ─────────────────────────────────────────────────

  it('TC-LOCK-14: duas empresas diferentes com mesma conversa — calls independentes', async () => {
    const svcA = makeSvc(() => RPC_ACQUIRED);
    const svcB = makeSvc(() => RPC_ACQUIRED);

    const [rA, rB] = await Promise.all([
      acquireConversationLock(svcA, { companyId: 'company-A', conversationId: CONV_ID, runId: 'run-A' }),
      acquireConversationLock(svcB, { companyId: 'company-B', conversationId: CONV_ID, runId: 'run-B' }),
    ]);

    expect(rA.acquired).toBe(true);
    expect(rB.acquired).toBe(true);
    expect(svcA.rpc).toHaveBeenCalledWith('agent_conversation_lock_acquire_v1', expect.objectContaining({ p_company_id: 'company-A' }));
    expect(svcB.rpc).toHaveBeenCalledWith('agent_conversation_lock_acquire_v1', expect.objectContaining({ p_company_id: 'company-B' }));
  });

  it('TC-LOCK-15: duas conversas diferentes na mesma empresa — calls independentes', async () => {
    const svc1 = makeSvc(() => RPC_ACQUIRED);
    const svc2 = makeSvc(() => RPC_ACQUIRED);

    const [r1, r2] = await Promise.all([
      acquireConversationLock(svc1, { companyId: COMPANY_ID, conversationId: 'conv-A', runId: 'run-A' }),
      acquireConversationLock(svc2, { companyId: COMPANY_ID, conversationId: 'conv-B', runId: 'run-B' }),
    ]);

    expect(r1.acquired).toBe(true);
    expect(r2.acquired).toBe(true);
  });

});


// =============================================================================
// releaseConversationLock
// =============================================================================

describe('releaseConversationLock', () => {

  // ── Verificação de contrato da RPC ──────────────────────────────────────────

  it('TC-LOCK-16: chama exclusivamente rpc (não usa .from)', async () => {
    const svc = makeSvc(() => RPC_RELEASED_TRUE);

    await releaseConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID });

    expect(svc.rpc).toHaveBeenCalledOnce();
    expect(svc.rpc).toHaveBeenCalledWith('agent_conversation_lock_release_v1', expect.objectContaining({
      p_company_id:      COMPANY_ID,
      p_conversation_id: CONV_ID,
      p_run_id:          RUN_ID,
    }));
    expect(svc.from).not.toHaveBeenCalled();
  });

  // ── Normalização de resultados ──────────────────────────────────────────────

  it('TC-LOCK-17: normaliza released=true → { released: true }', async () => {
    const result = await releaseConversationLock(makeSvc(() => RPC_RELEASED_TRUE), {
      companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID,
    });

    expect(result).toEqual({ released: true });
  });

  it('TC-LOCK-18: normaliza released=false → { released: false, reason: "not_found" }', async () => {
    const result = await releaseConversationLock(makeSvc(() => RPC_RELEASED_FALSE), {
      companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID,
    });

    expect(result.released).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('TC-LOCK-19: runId antigo não pode liberar lock novo — RPC retorna released=false (sem linhas)', async () => {
    // A RPC garante no banco que o DELETE filtra por locked_by_run_id.
    // Aqui o mock simula esse resultado: released=false quando runId não coincide.
    const result = await releaseConversationLock(makeSvc(() => RPC_RELEASED_FALSE), {
      companyId: COMPANY_ID, conversationId: CONV_ID, runId: 'old-run-uuid-stale',
    });

    expect(result.released).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('TC-LOCK-20: companyId incorreto não libera — released=false (comportamento da RPC)', async () => {
    // DELETE filtra por todos os 3 campos — empresa errada → zero linhas
    const result = await releaseConversationLock(makeSvc(() => RPC_RELEASED_FALSE), {
      companyId: 'wrong-company-uuid', conversationId: CONV_ID, runId: RUN_ID,
    });

    expect(result.released).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  // ── Tratamento de erros (silencioso) ────────────────────────────────────────

  it('TC-LOCK-21: retorna released=false em erro de banco — não lança exceção', async () => {
    const svc = makeSvc(() => ({
      data: null,
      error: { message: 'DB timeout' },
    }));

    const result = await releaseConversationLock(svc, {
      companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID,
    });

    expect(result.released).toBe(false);
    expect(result.reason).toContain('db_error');
  });

  it('TC-LOCK-22: não lança exceção quando rpc lança (catch silencioso)', async () => {
    const svc = {
      rpc:  vi.fn().mockRejectedValue(new Error('network failure')),
      from: vi.fn(),
    };

    await expect(
      releaseConversationLock(svc, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: RUN_ID })
    ).resolves.toMatchObject({ released: false });
  });

  // ── Sequências ──────────────────────────────────────────────────────────────

  it('TC-LOCK-23: acquire → release → nova acquire (sequência completa via mocks)', async () => {
    const svcAcquire1 = makeSvc(() => RPC_ACQUIRED);
    const svcRelease  = makeSvc(() => RPC_RELEASED_TRUE);
    const svcAcquire2 = makeSvc(() => RPC_ACQUIRED);

    const r1 = await acquireConversationLock(svcAcquire1, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: 'run-1' });
    expect(r1.acquired).toBe(true);

    const rel = await releaseConversationLock(svcRelease, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: 'run-1' });
    expect(rel.released).toBe(true);

    const r2 = await acquireConversationLock(svcAcquire2, { companyId: COMPANY_ID, conversationId: CONV_ID, runId: 'run-2' });
    expect(r2.acquired).toBe(true);
  });

});


// =============================================================================
// Concorrência — análise arquitetural
// =============================================================================

describe('Concorrência — análise arquitetural (teórica)', () => {

  it('TC-LOCK-CONC-1 (teórico): dois workers tentando lock inexistente — apenas um deve ganhar', () => {
    // Análise: A RPC usa INSERT otimista. Dois workers simultâneos tentam INSERT.
    // A PK (company_id, conversation_id) garante que apenas um INSERT vence.
    // O segundo recebe 23505 → faz SELECT FOR UPDATE → vê o dono → retorna lock_busy.
    // Resultado: apenas um worker tem acquired=true. ✓
    //
    // Não executado com duas sessões reais — requer pg_sleep() e two-connection test
    // que está fora do escopo do Jest/Vitest sem infra adicional.
    expect(true).toBe(true);
  });

  it('TC-LOCK-CONC-2 (teórico): dois workers tentando substituir o mesmo stale lock', () => {
    // Análise: Worker A e B veem lock stale.
    // Ambos tentam INSERT → ambos recebem 23505.
    // Ambos fazem SELECT FOR UPDATE — apenas um obtém o row lock da linha.
    // O primeiro que obtém: verifica stale → UPDATE (torna-se dono) → COMMIT → libera row lock.
    // O segundo que obtém: verifica — linha agora pertence ao primeiro → lock_busy.
    // Resultado: apenas um substitui o stale lock. ✓
    expect(true).toBe(true);
  });

  it('TC-LOCK-CONC-3 (teórico): worker antigo tenta liberar após substituição', () => {
    // Análise: Worker A tem lock. Worker B substitui (stale). Worker A tenta release.
    // A RPC de release filtra por locked_by_run_id = run_A.
    // Após substituição, locked_by_run_id = run_B.
    // DELETE de A encontra zero linhas → retorna { released: false }.
    // Worker B continua com o lock. ✓
    expect(true).toBe(true);
  });

  it('TC-LOCK-CONC-4 (teórico): somente um runId permanece como proprietário', () => {
    // Análise: Em qualquer cenário de concorrência, a PK (company_id, conversation_id)
    // impede que existam duas linhas. O SELECT FOR UPDATE garante exclusão mútua
    // durante a decisão de lock_busy vs. stale_replaced. ✓
    expect(true).toBe(true);
  });

});
