import { describe, expect, it } from 'vitest';
import { decideByoAttempt, type ByoAttemptResult } from '../useByoCredentialAttempt';

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
    expect(decideByoAttempt({ kind: 'conflict' }, false).clearFields).toBe(true);
    expect(decideByoAttempt({ kind: 'request_reused' }, true).refresh).toBe(true);
    expect(decideByoAttempt(ok('applied'), false).notice).toBe('applied');
    expect(decideByoAttempt(ok('idempotent'), false).notice).toBe('idempotent');
    expect(decideByoAttempt(ok('already_revoked'), false).notice).toBe('applied');
    expect(decideByoAttempt(ok('idempotent', true), false).notice).toBe('stale');
    expect(decideByoAttempt({ kind: 'temporary' }, true)).toMatchObject({
      type: 'stop',
      notice: 'rejected',
      clearFields: false,
    });
  });
});
