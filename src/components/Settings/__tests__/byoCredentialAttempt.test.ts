// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { decideByoAttempt, useByoCredentialAttempt, type ByoAttemptResult } from '../useByoCredentialAttempt';

function ok(result: 'applied' | 'idempotent' | 'already_revoked', stale = false): ByoAttemptResult {
  return { kind: 'ok', body: { result, stale } };
}

describe('decideByoAttempt', () => {
  it('preserva a tentativa em rede, 503 e sessão perdida durante o retry', () => {
    expect(decideByoAttempt({ kind: 'network' }, false)).toEqual({ type: 'retry', notice: 'unknown' });
    expect(decideByoAttempt({ kind: 'service_unavailable' }, false)).toEqual({ type: 'retry', notice: 'unknown' });
    expect(decideByoAttempt({ kind: 'unauthorized' }, true)).toEqual({ type: 'retry', notice: 'unknown' });
    expect(decideByoAttempt({ kind: 'session_unavailable' }, true)).toEqual({ type: 'retry', notice: 'unknown' });
  });

  it('encerra o primeiro envio sem sessão e limpa nos conflitos e no sucesso', () => {
    expect(decideByoAttempt({ kind: 'unauthorized' }, false)).toEqual({
      type: 'stop',
      notice: 'unauthorized',
      clearFields: false,
      refresh: false,
    });
    expect(decideByoAttempt({ kind: 'conflict' }, false)).toEqual({
      type: 'stop',
      notice: 'conflict',
      clearFields: true,
      refresh: true,
    });
    expect(decideByoAttempt({ kind: 'request_reused' }, true).refresh).toBe(true);
    expect(decideByoAttempt(ok('applied'), false)).toMatchObject({
      type: 'stop',
      notice: 'applied',
      clearFields: true,
      refresh: true,
    });
    expect(decideByoAttempt(ok('idempotent'), false).notice).toBe('idempotent');
    expect(decideByoAttempt(ok('already_revoked'), false)).toMatchObject({
      type: 'stop',
      notice: 'already_revoked',
      clearFields: true,
      refresh: true,
    });
    expect(decideByoAttempt(ok('already_revoked', true), false).notice).toBe('stale');
    expect(decideByoAttempt(ok('idempotent', true), false).notice).toBe('stale');
    expect(decideByoAttempt({ kind: 'temporary' }, true)).toMatchObject({
      type: 'stop',
      notice: 'rejected',
      clearFields: false,
    });
  });
});

describe('useByoCredentialAttempt', () => {
  it('descarta a tentativa ao trocar de empresa', () => {
    const clear = vi.fn();
    const { result, rerender } = renderHook(
      ({ companyId }: { companyId: string }) => useByoCredentialAttempt({
        companyId,
        onNotice: () => undefined,
        onRefresh: () => undefined,
        onClearFields: clear,
        execute: async () => ({ kind: 'network' }),
      }),
      { initialProps: { companyId: 'aaaaaaaa-0000-4000-8000-000000000001' } },
    );

    act(() => {
      result.current.confirm({ companyId: 'aaaaaaaa-0000-4000-8000-000000000001' });
    });
    expect(result.current.phase).toBe('confirm');
    expect(result.current.attempt?.requestId).toBeTruthy();

    rerender({ companyId: 'bbbbbbbb-0000-4000-8000-000000000002' });
    expect(result.current.phase).toBe('edit');
    expect(result.current.attempt).toBeNull();
    expect(clear).toHaveBeenCalled();
  });
});
